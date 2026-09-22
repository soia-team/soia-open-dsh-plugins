/**
 * The `liveTask` session-projection unit — the wire half of the host side.
 *
 * Why a projection instead of an HTTP route or a bespoke RPC: the browser must
 * show host-derived state without asking for it, and `dsh-session-projection`
 * is the official seam for exactly that. The registry drives this unit over
 * every committed `session/event`, validates the whole value at both
 * boundaries, and mirrors changes into every open page. The browser half then
 * reads the value through the projection seat it already has — no route, no
 * request, no polling.
 *
 * The fold itself is `../shared/live-task-state.ts`, the same pure reducer the
 * liveness store and the unit tests run, so this module is only the schemas
 * and the glue.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

import { INITIAL_LIVE_TASK_STATE, reduceLiveTask } from '../shared/live-task-state.ts'
import { LIVE_TASK_PROJECTION_KEY } from '../shared/projection.ts'
import type { LiveTaskState, LiveTaskView } from '../shared/types.ts'

/** One tool call as it crosses the wire. */
const liveToolCallSchema = z.object({
  callId: z.string(),
  name: z.string(),
  turn: z.number().int().nullable(),
  step: z.number().int().nullable(),
  open: z.boolean(),
  failed: z.boolean().optional(),
  detail: z.string().nullable(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  result: z.string().nullable().optional(),
}).strict()

const liveTaskHealthSchema = z.object({
  folded: z.number().int().nonnegative(),
  ignored: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  frames: z.number().int().nonnegative(),
  agents: z.number().int().nonnegative(),
  registry: z.number().int().nonnegative(),
  deltasAccepted: z.number().int().nonnegative(),
  deltasDropped: z.number().int().nonnegative(),
}).strict()

const liveTaskActionSchema = z.object({
  callId: z.string(),
  name: z.string(),
  detail: z.string().nullable(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  status: z.enum(['ok', 'failed', 'running']),
  result: z.string().nullable(),
}).strict()

/** The "last event" line as it crosses the wire. */
const liveEventSummarySchema = z.object({
  type: z.string(),
  seq: z.number(),
  time: z.number(),
  detail: z.string().nullable(),
}).strict()

/**
 * The unit's host-side state schema.
 *
 * `z.ZodType<LiveTaskState>` pins the schema's output to the shared type rather
 * than to zod's inferred literal, so a field added to {@link LiveTaskState}
 * without a matching schema entry is a compile error at this line instead of a
 * silent runtime rejection at the registry boundary.
 */
export const liveTaskStateSchema: z.ZodType<LiveTaskState> = z.object({
  turn: z.number().int().nullable(),
  step: z.number().int().nullable(),
  running: z.boolean(),
  seq: z.number(),
  updatedAt: z.number().nullable(),
  lastTool: liveToolCallSchema.nullable(),
  openTools: z.array(liveToolCallSchema),
  toolCallsInTurn: z.number().int().nonnegative(),
  lastEvent: liveEventSummarySchema.nullable(),
  recent: z.array(liveEventSummarySchema),
  actions: z.array(liveTaskActionSchema),
  health: liveTaskHealthSchema,
  endedReason: z.string().nullable(),
  streamedTextLength: z.number().int().nonnegative(),
  streamedAt: z.number().nullable(),
}).strict()

/**
 * The client-visible view schema.
 *
 * A strict subset of the state schema: the two transient-only fields stay on
 * the host. Validating the view separately means the wire contract is checked
 * against what the browser actually receives, not against the wider host shape.
 */
export const liveTaskViewSchema: z.ZodType<LiveTaskView> = z.object({
  turn: z.number().int().nullable(),
  step: z.number().int().nullable(),
  running: z.boolean(),
  seq: z.number(),
  updatedAt: z.number().nullable(),
  lastTool: liveToolCallSchema.nullable(),
  openTools: z.array(liveToolCallSchema),
  toolCallsInTurn: z.number().int().nonnegative(),
  lastEvent: liveEventSummarySchema.nullable(),
  recent: z.array(liveEventSummarySchema),
  actions: z.array(liveTaskActionSchema),
  health: liveTaskHealthSchema,
  streamedAt: z.number().nullable(),
  endedReason: z.string().nullable(),
}).strict()

/**
 * Reference-stable view cache.
 *
 * The registry compares consecutive raw `view` results with `Object.is` and
 * suppresses publication when the reference is unchanged. Rebuilding the view
 * object on every state change would therefore republish on changes the browser
 * cannot see — and with the transient fields excluded there are none, but the
 * cache keeps that property true by construction rather than by argument.
 */
const VIEWS = new WeakMap<LiveTaskState, LiveTaskView>()

/**
 * Project host state onto the client view, reusing the previous object.
 * @param state - current host state.
 * @returns the view for this exact state reference.
 */
function viewOf(state: LiveTaskState): LiveTaskView {
  const cached = VIEWS.get(state)
  if (cached !== undefined) return cached
  const view: LiveTaskView = {
    turn: state.turn,
    step: state.step,
    running: state.running,
    seq: state.seq,
    updatedAt: state.updatedAt,
    lastTool: state.lastTool,
    openTools: state.openTools,
    toolCallsInTurn: state.toolCallsInTurn,
    lastEvent: state.lastEvent,
    recent: state.recent,
    actions: state.actions,
    health: state.health,
    streamedAt: state.streamedAt,
    endedReason: state.endedReason,
  }
  VIEWS.set(state, view)
  return view
}

/**
 * The `liveTask` unit.
 *
 * Exported as a value so the host half's spec can drive `init`, `apply`, and
 * `wire.view` as the plain functions they are, without booting a registry.
 *
 * `stateVersion` is the persisted-checkpoint invalidation version: bump it
 * whenever a state field or a fold rule changes, so a cached row written by an
 * older unit is discarded instead of being forward-applied into garbage.
 */
export const liveTaskProjectionDefinition = {
  key: LIVE_TASK_PROJECTION_KEY,
  stateVersion: 1,
  stateSchema: liveTaskStateSchema,
  // The initial state is built from constants alone, so both arguments the
  // registry passes — the session header and the fork-inherited prefix length —
  // are ignored on purpose. Declaring them (instead of writing `init: () => …`)
  // keeps the definition's arity equal to the interface's, which is what lets
  // `Parameters<typeof definition.init>` name the header type at all.
  init: (_header: SessionHeader, _inheritedEventCount: number) => INITIAL_LIVE_TASK_STATE,
  apply: (state, event) => reduceLiveTask(state, { kind: 'event', event }),
  wire: {
    viewSchema: liveTaskViewSchema,
    view: viewOf,
  },
  // `satisfies` rather than an annotation: the registry's `register` overload
  // intersects the definition with a *required* `wire`, which an annotated
  // `ProjectionDefinition` (whose `wire` is optional) can no longer satisfy.
  // Checking here keeps the compile-time pin without widening the value.
} satisfies ProjectionDefinition<'liveTask'>

/**
 * Install the unit on the profile's projection registry.
 * @param ctx - host context carrying `sessionProjections`.
 * @returns the registry's disposer, owned by the calling fiber.
 */
export function registerLiveTaskProjection(ctx: Context): () => void {
  return ctx.sessionProjections.register(liveTaskProjectionDefinition)
}
