/**
 * `ctx.liveTasks` — the host-only liveness surface.
 *
 * This service subscribes to both feeds the package derives from and keeps the
 * current state per session:
 *
 * - `session/event` is the durable log feed. It is also what the `liveTask`
 *   session projection folds for the browser, but the store folds its own copy
 *   so a host consumer can read liveness without reaching into the projection
 *   registry (and so this surface survives a composition that mounts no
 *   registry).
 * - `agent/assistant-stream` is the process-local model stream. It is NOT a
 *   session event and never reaches the durable log, so no projection can carry
 *   it; it is the reason this host-only surface exists at all. It advances
 *   `streamedTextLength` while the model writes, which is the difference
 *   between "a turn is open" and "a turn is open and text is arriving".
 *
 * Nothing in this package consumes `ctx.liveTasks`; it is published for host
 * consumers such as diagnostics. The browser panel reads the projection, which
 * is the only surface that can cross the wire. See the README's
 * `Known Limitations and Deferred Work`.
 */
import { Service, type Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { LiveTaskState } from '../shared/types.ts';
/** Sentinel recorded when the agent registry cannot be reached at all. */
export declare const REGISTRY_UNAVAILABLE = -1;
/** Sentinel recorded when reaching the registry threw. */
export declare const REGISTRY_LOOKUP_FAILED = -2;
/**
 * One session's live-task state was published.
 *
 * `state` is `undefined` exactly once per tracked session, when the session
 * leaves the store: a consumer drops the row instead of interpreting a
 * leftover value as a live session.
 */
export type LiveTaskChangeListener = (sessionId: SessionId, state: LiveTaskState | undefined) => void;
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Host-only live-task liveness surface; the browser reads the projection instead. */
        liveTasks: LiveTaskStore;
    }
}
/** Per-session live-task state, folded from the durable log and the model stream. */
export declare class LiveTaskStore extends Service {
    private readonly tracker;
    private readonly attempts;
    private readonly listeners;
    /**
     * @param ctx - host context owning this service's lifetime.
     */
    /** Sessions whose agent already carries a stream listener. */
    private readonly attached;
    /** The host context, kept for lazy service lookups. */
    private readonly host;
    constructor(ctx: Context);
    /**
     * Attach the stream listener to a session's live agent, once.
     *
     * Looks the agent up through the `agents` registry rather than waiting for
     * `agent/created`, which is dispatched in the agent's scope and therefore
     * never reaches this context.
     * @param sessionId - the session whose agent should be attached.
     */
    private attachToAgent;
    /**
     * Read one session's current state.
     * @param sessionId - durable session identity.
     * @returns the folded state, or the shared initial state for a session that
     *   has shown nothing; never undefined.
     */
    read(sessionId: SessionId): LiveTaskState;
    /**
     * Read every session this store is tracking.
     * @returns a detached snapshot keyed by session identity.
     */
    snapshot(): ReadonlyMap<string, LiveTaskState>;
    /**
     * Subscribe to state changes.
     * @param listener - called after each change with the state it produced.
     * @returns a disposer removing the listener.
     */
    onChanged(listener: LiveTaskChangeListener): () => void;
    /**
     * Fold one model-stream frame.
     *
     * `start` records where the attempt sits, `end` clears it, and a `chunk`
     * folds only when it names the recorded attempt — see {@link OpenAttempt}.
     * @param sessionId - the session whose agent produced the frame.
     * @param frame - one ordered publication from the model stream.
     */
    private foldStreamFrame;
    /**
     * Fold one observation and publish the result when it moved.
     *
     * The reducer returns the previous reference for an observation that changes
     * nothing, so reference inequality is the change signal and an ignored event
     * costs one map lookup.
     * @param sessionId - durable session identity.
     * @param observation - one durable event or one transient text delta.
     */
    private fold;
    /**
     * Notify every listener, containing a failing one.
     *
     * A listener is an unrelated host consumer; its bug must not stop the fold
     * from having already happened, nor starve the listeners registered after it.
     * @param sessionId - durable session identity.
     * @param state - new state, or undefined when the session was released.
     */
    private publish;
}
