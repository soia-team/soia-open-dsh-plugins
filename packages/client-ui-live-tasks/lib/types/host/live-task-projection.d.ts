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
import type { Context } from '@deepseek-ai/cordis';
import type { SessionHeader } from '@deepseek-ai/dsh-session';
import { z } from 'zod';
import type { LiveTaskState, LiveTaskView } from '../shared/types.ts';
/**
 * The unit's host-side state schema.
 *
 * `z.ZodType<LiveTaskState>` pins the schema's output to the shared type rather
 * than to zod's inferred literal, so a field added to {@link LiveTaskState}
 * without a matching schema entry is a compile error at this line instead of a
 * silent runtime rejection at the registry boundary.
 */
export declare const liveTaskStateSchema: z.ZodType<LiveTaskState>;
/**
 * The client-visible view schema.
 *
 * A strict subset of the state schema: the two transient-only fields stay on
 * the host. Validating the view separately means the wire contract is checked
 * against what the browser actually receives, not against the wider host shape.
 */
export declare const liveTaskViewSchema: z.ZodType<LiveTaskView>;
/**
 * Project host state onto the client view, reusing the previous object.
 * @param state - current host state.
 * @returns the view for this exact state reference.
 */
declare function viewOf(state: LiveTaskState): LiveTaskView;
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
export declare const liveTaskProjectionDefinition: {
    key: "liveTask";
    stateVersion: number;
    stateSchema: z.ZodType<LiveTaskState, unknown, z.core.$ZodTypeInternals<LiveTaskState, unknown>>;
    init: (_header: SessionHeader, _inheritedEventCount: number) => LiveTaskState;
    apply: (state: NoInfer<LiveTaskState>, event: import("@deepseek-ai/dsh-session").SessionEvent) => LiveTaskState;
    wire: {
        viewSchema: z.ZodType<LiveTaskView, unknown, z.core.$ZodTypeInternals<LiveTaskView, unknown>>;
        view: typeof viewOf;
    };
};
/**
 * Install the unit on the profile's projection registry.
 * @param ctx - host context carrying `sessionProjections`.
 * @returns the registry's disposer, owned by the calling fiber.
 */
export declare function registerLiveTaskProjection(ctx: Context): () => void;
export {};
