/**
 * Per-session shell around the pure reducer: one {@link LiveTaskState} per
 * session, updated in arrival order and read back by key.
 *
 * Kept free of DSH imports so the shell is directly testable and so the host
 * half's bookkeeping is separable from its Cordis wiring. The interesting
 * behavior lives in `../shared/live-task-state.ts`; this class only decides
 * which session a state belongs to and when it is forgotten.
 */
import { INITIAL_LIVE_TASK_STATE, reduceLiveTask } from '../shared/live-task-state.ts'
import type { LiveTaskObservation, LiveTaskState } from '../shared/types.ts'

/** Session-keyed live-task states. */
export class LiveTaskTracker {
  private readonly states = new Map<string, LiveTaskState>()

  /**
   * Fold one observation into a session's state.
   * @param sessionId - durable session identity the observation belongs to.
   * @param observation - one durable event or one transient text delta.
   * @returns the state after the observation, which is the previous reference
   *   when the observation changed nothing — the reference is the change signal.
   */
  observe(sessionId: string, observation: LiveTaskObservation): LiveTaskState {
    const previous = this.states.get(sessionId) ?? INITIAL_LIVE_TASK_STATE
    const next = reduceLiveTask(previous, observation)
    if (next !== previous) this.states.set(sessionId, next)
    return next
  }

  /**
   * Read one session's current state.
   * @param sessionId - durable session identity.
   * @returns the folded state, or the shared initial state for a session that
   *   has shown nothing yet. Never undefined, so callers never branch on absence.
   */
  read(sessionId: string): LiveTaskState {
    return this.states.get(sessionId) ?? INITIAL_LIVE_TASK_STATE
  }

  /**
   * Read every tracked session.
   * @returns a detached snapshot; mutating it does not affect the tracker.
   */
  snapshot(): ReadonlyMap<string, LiveTaskState> {
    return new Map(this.states)
  }

  /**
   * Drop one session's state.
   *
   * Called when a session leaves the store, so a long-lived host does not
   * accumulate a state per session it has ever seen.
   * @param sessionId - durable session identity.
   * @returns true when a state was present and removed.
   */
  forget(sessionId: string): boolean {
    return this.states.delete(sessionId)
  }

  /** Number of sessions currently tracked. */
  get size(): number {
    return this.states.size
  }
}
