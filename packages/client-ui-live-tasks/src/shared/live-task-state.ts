/**
 * The live-task derivation: one pure reducer over a session's observation
 * stream. This module imports nothing, reads no clock, and touches no global —
 * `reduceLiveTask(state, observation)` is a function of its arguments alone, so
 * every branch is directly testable and both halves of the plugin can run the
 * identical fold.
 *
 * Why a fold instead of a store: the host sees `session/event` and
 * `agent/assistant-stream` frames, and the browser sees the session event
 * window the Session Controller mirrors into the page. Both are ordered
 * streams with the same durable seq, so one reducer serves both and the two
 * halves cannot drift apart.
 *
 * Ordering contract. Durable events are ordered by `seq`: an event whose seq is
 * not greater than the highest seq already folded is a duplicate or a stale
 * replay and is dropped without touching the state. Text deltas carry no seq,
 * so they are ordered by `time` and are accepted only for the currently open
 * `(turn, step)`.
 */
import type {
  LiveEventLike,
  LiveEventSummary,
  LiveTaskObservation,
  LiveTaskState,
  LiveToolCall,
} from './types.ts'

/** One frozen array reused for every state without open tool calls. */
const NO_TOOLS: readonly LiveToolCall[] = Object.freeze([])

/**
 * The state before any observation. Frozen and exported so callers and tests
 * share one identity instead of rebuilding an equal-looking literal.
 */
export const INITIAL_LIVE_TASK_STATE: LiveTaskState = Object.freeze({
  turn: null,
  step: null,
  running: false,
  seq: 0,
  updatedAt: null,
  lastTool: null,
  openTools: NO_TOOLS,
  toolCallsInTurn: 0,
  streamedTextLength: 0,
  streamedAt: null,
  lastEvent: null,
  endedReason: null,
})

/** Read a JSON object member without trusting the value. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** Read a finite number member without trusting the value. */
function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Read a string member without trusting the value. */
function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Display summary of one durable event. */
function summary(event: LiveEventLike, detail: string | null): LiveEventSummary {
  return { type: event.type, seq: event.seq, time: event.time, detail }
}

/**
 * Read the call identity and error flag out of a `tool/result` payload.
 *
 * The payload nests them: `data.message` is a tool-result message whose single
 * content block carries `toolCallId` and `isError`, and `data.error` is the
 * optional failure identity recorded beside the model-facing content. Either
 * half may be missing on a partially understood event, so each is read on its
 * own and absence is reported as absence.
 * @param data - the event's `data` member, already narrowed to an object.
 * @returns the call id when one was readable, and whether the call failed.
 */
function readToolResult(data: Record<string, unknown> | undefined): {
  callId?: string
  failed?: boolean
} {
  const message = recordOf(data?.['message'])
  const content = message?.['content']
  const block = Array.isArray(content) ? recordOf(content[0]) : undefined
  const callId = stringOf(block?.['toolCallId'])
  const failed = block?.['isError'] === true || data?.['error'] !== undefined
  return {
    ...(callId === undefined ? {} : { callId }),
    ...(failed ? { failed: true } : {}),
  }
}

/**
 * Fold one durable session event.
 *
 * The envelope fields (`seq`, `updatedAt`) advance for every accepted event,
 * including event types this build does not know: an unknown event still marks
 * real progress, and `lastEvent` is the honest place to say so. Only recognized
 * types additionally move turn, step, and tool state.
 * @param state - state before this event.
 * @param event - one durable session event.
 * @returns the next state, or the same state for a duplicate or stale event.
 */
function foldEvent(state: LiveTaskState, event: LiveEventLike): LiveTaskState {
  const seq = numberOf(event.seq)
  const time = numberOf(event.time)
  if (seq === undefined || time === undefined || seq <= state.seq) return state

  const envelope = {
    seq,
    updatedAt: state.updatedAt === null ? time : Math.max(state.updatedAt, time),
  }
  const data = recordOf(event.data)

  switch (event.type) {
    case 'turn/start': {
      const turn = numberOf(data?.['turn'])
      return {
        ...state,
        ...envelope,
        turn: turn ?? state.turn,
        step: null,
        running: true,
        openTools: NO_TOOLS,
        toolCallsInTurn: 0,
        streamedTextLength: 0,
        streamedAt: null,
        endedReason: null,
        lastEvent: summary(event, null),
      }
    }
    case 'turn/end': {
      const reason = recordOf(data?.['reason'])
      return {
        ...state,
        ...envelope,
        step: null,
        running: false,
        openTools: NO_TOOLS,
        // Nothing can still be in flight once the turn is closed, so the
        // lingering last-tool record stops claiming to be. A `tool/result`
        // that arrives after this still lands, because it matches by call id.
        lastTool: state.lastTool === null || !state.lastTool.open
          ? state.lastTool
          : { ...state.lastTool, open: false },
        // `unknown` distinguishes "the turn ended, the reason was unreadable"
        // from "no turn has ended yet", which stays null.
        endedReason: stringOf(reason?.['kind']) ?? 'unknown',
        lastEvent: summary(event, null),
      }
    }
    case 'step/start': {
      const turn = numberOf(data?.['turn'])
      const step = numberOf(data?.['step'])
      return {
        ...state,
        ...envelope,
        turn: turn ?? state.turn,
        step: step ?? state.step,
        running: true,
        lastEvent: summary(event, null),
      }
    }
    case 'step/end': {
      const turn = numberOf(data?.['turn'])
      const step = numberOf(data?.['step'])
      const closesOpenStep = state.step !== null
        && step === state.step
        && (turn === undefined || turn === state.turn)
      return {
        ...state,
        ...envelope,
        step: closesOpenStep ? null : state.step,
        lastEvent: summary(event, null),
      }
    }
    case 'tool/call': {
      const callId = stringOf(data?.['callId'])
      const name = stringOf(data?.['name'])
      if (callId === undefined || name === undefined) {
        return { ...state, ...envelope, lastEvent: summary(event, null) }
      }
      const call: LiveToolCall = {
        callId,
        name,
        turn: numberOf(data?.['turn']) ?? state.turn,
        step: numberOf(data?.['step']) ?? state.step,
        open: true,
      }
      return {
        ...state,
        ...envelope,
        lastTool: call,
        openTools: [...state.openTools, call],
        toolCallsInTurn: state.toolCallsInTurn + 1,
        lastEvent: summary(event, name),
      }
    }
    case 'tool/result': {
      const { callId, failed } = readToolResult(data)
      const settled = callId === undefined
        ? undefined
        : state.openTools.find((call) => call.callId === callId)
      return {
        ...state,
        ...envelope,
        openTools: callId === undefined
          ? state.openTools
          : state.openTools.filter((call) => call.callId !== callId),
        lastTool: state.lastTool !== null && callId !== undefined
          && state.lastTool.callId === callId
          ? { ...state.lastTool, open: false, ...(failed === true ? { failed: true } : {}) }
          : state.lastTool,
        lastEvent: summary(event, settled?.name ?? null),
      }
    }
    case 'assistant/message':
    case 'assistant/attempt': {
      // The durable message supersedes every transient delta of its attempt, so
      // the streamed counter of that step starts clean for the next one.
      return {
        ...state,
        ...envelope,
        streamedTextLength: 0,
        streamedAt: null,
        lastEvent: summary(event, null),
      }
    }
    default:
      return { ...state, ...envelope, lastEvent: summary(event, null) }
  }
}

/**
 * Fold one transient assistant text delta.
 *
 * Accepted only while the named step is the open one and its time does not run
 * backwards; anything else is a replay or a straggler and is dropped. The
 * counter is a liveness signal, not accounting: two deltas sharing a
 * millisecond both count, and the durable `assistant/message` of the step
 * resets it to zero.
 * @param state - state before this delta.
 * @param delta - normalized text delta.
 * @returns the next state, or the same state when the delta does not apply.
 */
function foldTextDelta(
  state: LiveTaskState,
  delta: Extract<LiveTaskObservation, { kind: 'text-delta' }>,
): LiveTaskState {
  if (!state.running) return state
  if (delta.turn !== state.turn || delta.step !== state.step) return state
  if (!Number.isFinite(delta.time)) return state
  if (state.streamedAt !== null && delta.time < state.streamedAt) return state

  const length = delta.text.length
  const updatedAt = state.updatedAt === null ? delta.time : Math.max(state.updatedAt, delta.time)
  if (length === 0 && state.streamedAt === delta.time && state.updatedAt === updatedAt) return state
  return {
    ...state,
    streamedTextLength: state.streamedTextLength + length,
    streamedAt: delta.time,
    updatedAt,
  }
}

/**
 * Fold one normalized observation into the live-task state.
 * @param state - state before this observation.
 * @param observation - one durable event or one transient text delta.
 * @returns the next state; the same reference when the observation changes nothing.
 */
export function reduceLiveTask(
  state: LiveTaskState,
  observation: LiveTaskObservation,
): LiveTaskState {
  return observation.kind === 'event'
    ? foldEvent(state, observation.event)
    : foldTextDelta(state, observation)
}

/**
 * Fold a whole observation stream from the initial state.
 * @param observations - observations in arrival order.
 * @returns the state after the last one.
 */
export function foldLiveTasks(
  observations: readonly LiveTaskObservation[],
): LiveTaskState {
  let state = INITIAL_LIVE_TASK_STATE
  for (const observation of observations) state = reduceLiveTask(state, observation)
  return state
}

/**
 * Whether the session has shown anything at all.
 *
 * A surface that renders only when there is something to say uses this to stay
 * completely absent for a session that never produced an event.
 * @param state - current state.
 * @returns true once any observation, durable or transient, has been folded.
 */
export function hasLiveActivity(state: Pick<LiveTaskState, 'updatedAt'>): boolean {
  return state.updatedAt !== null
}
