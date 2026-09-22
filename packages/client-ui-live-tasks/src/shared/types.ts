/**
 * Shared types of the live-task derivation. This module imports nothing — not
 * even a DSH type — so the derivation is fully exercisable by unit tests and is
 * safe to run in both halves: the host (Node) and the browser bundle.
 *
 * The host and the browser hand structurally identical observations to the same
 * reducer. They differ only in how they obtain them: the host subscribes to the
 * `session/event` and `agent/assistant-stream` buses, while the browser reads
 * the session event window the Session Controller already mirrors into the
 * page. Neither half re-invents the derivation.
 */

/**
 * Minimal structural view of one durable session event.
 *
 * Deliberately not `SessionEvent` from `@deepseek-ai/dsh-session`: the shared
 * core stays dependency-free, and `data` stays `unknown` so the reducer narrows
 * every field it reads instead of trusting the wire shape. A malformed or
 * future-unknown event therefore degrades to "recognized envelope, ignored
 * payload" rather than throwing.
 */
export interface LiveEventLike {
  /** `SessionEventType`, or any newer type this build does not know. */
  readonly type: string
  /** Monotonic sequence number within the session; the fold's ordering key. */
  readonly seq: number
  /** Unix epoch milliseconds. */
  readonly time: number
  /** Event payload, narrowed field by field inside the reducer. */
  readonly data: unknown
}

/** One normalized step of the fold. */
export type LiveTaskObservation =
  | { readonly kind: 'event'; readonly event: LiveEventLike }
  | {
      readonly kind: 'text-delta'
      readonly turn: number
      readonly step: number
      readonly time: number
      readonly text: string
    }

/** A tool call the session issued, and whether its result has arrived. */
export interface LiveToolCall {
  readonly callId: string
  readonly name: string
  /** Null when the event carried no usable turn or step number. */
  readonly turn: number | null
  readonly step: number | null
  /** True from `tool/call` until the matching `tool/result` or the turn's end. */
  readonly open: boolean
  /**
   * One-line summary of what the call was asked to do — the command for a shell
   * call, the path for a file call, the URL for a fetch. Null when the event
   * carried no readable argument: absence is reported, never invented.
   */
  readonly detail: string | null
  /** Set when the settled result carried `isError`; absent while open or on success. */
  readonly failed?: boolean
  /** Epoch milliseconds of the `tool/call` that opened this record. */
  readonly startedAt: number
  /** Epoch milliseconds of the matching `tool/result`; absent while open. */
  readonly endedAt?: number
  /**
   * First non-empty line of the tool's answer, clipped — a human needs to see
   * whether the call came back with something, not the whole payload. Null while
   * the call is still open or when the answer carried no text.
   */
  readonly result?: string | null
}

/** Short, display-ready summary of the most recent durable observation. */
export interface LiveEventSummary {
  /** Durable session event type. */
  readonly type: string
  readonly seq: number
  readonly time: number
  /** Tool name for tool events; null when the type alone is the whole story. */
  readonly detail: string | null
}

/** One finished (or running) tool call as a human-readable line. */
export interface LiveTaskAction {
  readonly callId: string
  readonly name: string
  /** Argument summary: the command, path or URL the call was given. */
  readonly detail: string | null
  readonly startedAt: number
  readonly endedAt: number | null
  /** `ok`, `failed`, or `running` while the result has not arrived. */
  readonly status: 'ok' | 'failed' | 'running'
  /** First line of the answer, clipped; null while running or when empty. */
  readonly result: string | null
}

/**
 * The client-visible subset of the fold — what the `liveTask` projection
 * mirrors into the page.
 *
 * It excludes {@link LiveTaskState.streamedTextLength} and
 * {@link LiveTaskState.streamedAt} on purpose. Those two move only on
 * `agent/assistant-stream` frames, which are process-local and never reach the
 * durable log, so a projection driven by committed session events can never
 * advance them. Serving fields that are constant zero would invite a panel to
 * render them as if they meant something; the wire simply does not carry them.
 *
 * Everything else is state the durable log alone determines, which is exactly
 * what makes it safe to serve through the projection registry.
 */
export interface LiveTaskView {
  /** Open turn number, or null when no turn is open. */
  readonly turn: number | null
  /** Open step number inside `turn`, or null between steps. */
  readonly step: number | null
  /** True while a turn is open: the agent still owes work on this session. */
  readonly running: boolean
  /** Highest durable seq folded in; 0 before the first event. */
  readonly seq: number
  /** Unix epoch milliseconds of the last folded observation; null before any. */
  readonly updatedAt: number | null
  /** Most recent tool call at any age, or null when the session never ran one. */
  readonly lastTool: LiveToolCall | null
  /** Tool calls of the open turn still awaiting a result, in issue order. */
  readonly openTools: readonly LiveToolCall[]
  /** Tool calls folded for the open turn; reset by the next `turn/start`. */
  readonly toolCallsInTurn: number
  /** Most recent durable observation, for the "last event" line. */
  readonly lastEvent: LiveEventSummary | null
  /** Newest-last window of recent observations, so the view can show a trail. */
  readonly recent: readonly LiveEventSummary[]
  /** Called tool names with their outcome summary, newest last. */
  readonly actions: readonly LiveTaskAction[]
  /** `TurnEndReason.kind` of the most recent `turn/end`; null before one. */
  readonly endedReason: string | null
}

/**
 * The stable small object both halves agree on. Every field is data — no class
 * instances, no functions, no `Date` — so it can be compared, serialized, and
 * rendered without further interpretation.
 *
 * Only durable session events move the envelope fields (`seq`, `lastEvent`,
 * `turn`, `step`, `running`, `endedReason`). Transient assistant text is
 * progress, not an event: it advances `streamedTextLength`, `streamedAt`, and
 * `updatedAt` and leaves `lastEvent` pointing at the last durable thing that
 * happened, which is what a reader actually wants on the "last event" line.
 */
export interface LiveTaskState extends LiveTaskView {
  /** Characters of assistant text streamed for the open step. */
  readonly streamedTextLength: number
  /** Time of the last folded text delta for the open step; null before one. */
  readonly streamedAt: number | null
}
