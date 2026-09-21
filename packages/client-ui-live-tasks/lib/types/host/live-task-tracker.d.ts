import type { LiveTaskObservation, LiveTaskState } from '../shared/types.ts';
/** Session-keyed live-task states. */
export declare class LiveTaskTracker {
    private readonly states;
    /**
     * Fold one observation into a session's state.
     * @param sessionId - durable session identity the observation belongs to.
     * @param observation - one durable event or one transient text delta.
     * @returns the state after the observation, which is the previous reference
     *   when the observation changed nothing — the reference is the change signal.
     */
    observe(sessionId: string, observation: LiveTaskObservation): LiveTaskState;
    /**
     * Read one session's current state.
     * @param sessionId - durable session identity.
     * @returns the folded state, or the shared initial state for a session that
     *   has shown nothing yet. Never undefined, so callers never branch on absence.
     */
    read(sessionId: string): LiveTaskState;
    /**
     * Read every tracked session.
     * @returns a detached snapshot; mutating it does not affect the tracker.
     */
    snapshot(): ReadonlyMap<string, LiveTaskState>;
    /**
     * Drop one session's state.
     *
     * Called when a session leaves the store, so a long-lived host does not
     * accumulate a state per session it has ever seen.
     * @param sessionId - durable session identity.
     * @returns true when a state was present and removed.
     */
    forget(sessionId: string): boolean;
    /** Number of sessions currently tracked. */
    get size(): number;
}
