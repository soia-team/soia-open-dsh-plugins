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
import { Service, type Context } from '@deepseek-ai/cordis'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'

import type { LiveTaskObservation, LiveTaskState } from '../shared/types.ts'
import { LiveTaskTracker } from './live-task-tracker.ts'

/**
 * One session's live-task state was published.
 *
 * `state` is `undefined` exactly once per tracked session, when the session
 * leaves the store: a consumer drops the row instead of interpreting a
 * leftover value as a live session.
 */
export type LiveTaskChangeListener = (
  sessionId: SessionId,
  state: LiveTaskState | undefined,
) => void

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-only live-task liveness surface; the browser reads the projection instead. */
    liveTasks: LiveTaskStore
  }
}

/**
 * The attempt whose chunks this store can currently place.
 *
 * `agent/assistant-stream` labels turn and step only on the `start` frame; a
 * `chunk` frame carries the attempt id, a dense index, a time, and the chunk.
 * The store therefore remembers where each session's open attempt sits, and a
 * chunk that names an attempt no `start` announced is dropped — a reconnecting
 * listener loses transient progress, never durable state.
 */
interface OpenAttempt {
  readonly attemptId: string
  readonly turn: number
  readonly step: number
}

/** Per-session live-task state, folded from the durable log and the model stream. */
export class LiveTaskStore extends Service {
  private readonly tracker = new LiveTaskTracker()
  private readonly attempts = new Map<string, OpenAttempt>()
  private readonly listeners = new Set<LiveTaskChangeListener>()

  /**
   * @param ctx - host context owning this service's lifetime.
   */
  constructor(ctx: Context) {
    super(ctx, 'liveTasks')

    // All three listeners are effects of this fiber: cordis removes them when
    // the plugin unloads, so no explicit teardown is needed here.
    ctx.on('session/event', (session, event) => {
      this.fold(session.id, { kind: 'event', event })
    })
    ctx.on('session/disposed', (session) => {
      this.attempts.delete(session.id)
      if (this.tracker.forget(session.id)) this.publish(session.id, undefined)
    })
    ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      this.foldStreamFrame(agent.session.id, frame)
    })
  }

  /**
   * Read one session's current state.
   * @param sessionId - durable session identity.
   * @returns the folded state, or the shared initial state for a session that
   *   has shown nothing; never undefined.
   */
  read(sessionId: SessionId): LiveTaskState {
    return this.tracker.read(sessionId)
  }

  /**
   * Read every session this store is tracking.
   * @returns a detached snapshot keyed by session identity.
   */
  snapshot(): ReadonlyMap<string, LiveTaskState> {
    return this.tracker.snapshot()
  }

  /**
   * Subscribe to state changes.
   * @param listener - called after each change with the state it produced.
   * @returns a disposer removing the listener.
   */
  onChanged(listener: LiveTaskChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Fold one model-stream frame.
   *
   * `start` records where the attempt sits, `end` clears it, and a `chunk`
   * folds only when it names the recorded attempt — see {@link OpenAttempt}.
   * @param sessionId - the session whose agent produced the frame.
   * @param frame - one ordered publication from the model stream.
   */
  private foldStreamFrame(sessionId: SessionId, frame: AssistantStreamFrame): void {
    if (frame.type === 'start') {
      this.attempts.set(sessionId, {
        attemptId: frame.attemptId,
        turn: frame.turn,
        step: frame.step,
      })
      return
    }
    if (frame.type === 'end') {
      if (this.attempts.get(sessionId)?.attemptId === frame.attemptId) {
        this.attempts.delete(sessionId)
      }
      return
    }
    const attempt = this.attempts.get(sessionId)
    if (attempt === undefined || attempt.attemptId !== frame.attemptId) return
    if (frame.chunk.type !== 'text-delta') return
    this.fold(sessionId, {
      kind: 'text-delta',
      turn: attempt.turn,
      step: attempt.step,
      time: frame.time,
      text: frame.chunk.text,
    })
  }

  /**
   * Fold one observation and publish the result when it moved.
   *
   * The reducer returns the previous reference for an observation that changes
   * nothing, so reference inequality is the change signal and an ignored event
   * costs one map lookup.
   * @param sessionId - durable session identity.
   * @param observation - one durable event or one transient text delta.
   */
  private fold(sessionId: SessionId, observation: LiveTaskObservation): void {
    const before = this.tracker.read(sessionId)
    const after = this.tracker.observe(sessionId, observation)
    if (after !== before) this.publish(sessionId, after)
  }

  /**
   * Notify every listener, containing a failing one.
   *
   * A listener is an unrelated host consumer; its bug must not stop the fold
   * from having already happened, nor starve the listeners registered after it.
   * @param sessionId - durable session identity.
   * @param state - new state, or undefined when the session was released.
   */
  private publish(sessionId: SessionId, state: LiveTaskState | undefined): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(sessionId, state)
      } catch (error) {
        this.ctx.logger('ui-live-tasks').warn('live-task listener failed: %o', error)
      }
    }
  }
}
