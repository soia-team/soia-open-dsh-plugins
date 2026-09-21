/**
 * Type-only declaration of this package's session projection.
 *
 * The plugin serves one client-visible projection key, `liveTask`, through the
 * official `dsh-session-projection` registry: the host folds committed session
 * events into {@link LiveTaskState} and the registry mirrors whole current
 * values into the page, so the browser half renders host-derived state without
 * issuing an RPC of its own.
 *
 * This module carries no runtime import on purpose. The `declare module` block
 * is erased, and the key constant is a plain string, so the browser bundle
 * pulls in no host code by importing it.
 */
import type { LiveTaskState, LiveTaskView } from './types.ts'

/**
 * Projection key of the live-task unit.
 *
 * A profile-local handle inside the projection table, in the camelCase noun
 * shape the official units use (`sessionStats`, `todos`). Renaming it is a wire
 * change: the browser half reads the same constant, so both halves move
 * together and `tests/host/index.test.ts` pins the pair.
 */
export const LIVE_TASK_PROJECTION_KEY = 'liveTask'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Whole current live-task view of one session, as the panel renders it. */
    liveTask: LiveTaskView
  }
  interface SessionProjectionStateMap {
    /** The full fold on the host side, including the transient-only fields. */
    liveTask: LiveTaskState
  }
}
