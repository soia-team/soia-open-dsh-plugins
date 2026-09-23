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
    readonly type: string;
    /** Monotonic sequence number within the session; the fold's ordering key. */
    readonly seq: number;
    /** Unix epoch milliseconds. */
    readonly time: number;
    /** Event payload, narrowed field by field inside the reducer. */
    readonly data: unknown;
}
/** One normalized step of the fold. */
export type LiveTaskObservation = {
    readonly kind: 'event';
    readonly event: LiveEventLike;
    /** Set on the first event of a session this plugin just attached to. */
    readonly agentAttached?: boolean;
    /** Registry size observed while trying to attach, when a lookup ran. */
    readonly registrySize?: number;
}
/** A stream frame arrived; counted for liveness before normalization. */
 | {
    readonly kind: 'stream-frame';
} | {
    readonly kind: 'text-delta';
    readonly turn: number;
    readonly step: number;
    readonly time: number;
    readonly text: string;
};
/** A tool call the session issued, and whether its result has arrived. */
export interface LiveToolCall {
    readonly callId: string;
    readonly name: string;
    /** Null when the event carried no usable turn or step number. */
    readonly turn: number | null;
    readonly step: number | null;
    /** True from `tool/call` until the matching `tool/result` or the turn's end. */
    readonly open: boolean;
    /**
     * One-line summary of what the call was asked to do — the command for a shell
     * call, the path for a file call, the URL for a fetch. Null when the event
     * carried no readable argument: absence is reported, never invented.
     */
    readonly detail: string | null;
    /** Set when the settled result carried `isError`; absent while open or on success. */
    readonly failed?: boolean;
    /** Epoch milliseconds of the `tool/call` that opened this record. */
    readonly startedAt: number;
    /** Epoch milliseconds of the matching `tool/result`; absent while open. */
    readonly endedAt?: number;
    /**
     * First non-empty line of the tool's answer, clipped — a human needs to see
     * whether the call came back with something, not the whole payload. Null while
     * the call is still open or when the answer carried no text.
     */
    readonly result?: string | null;
}
/** Short, display-ready summary of the most recent durable observation. */
export interface LiveEventSummary {
    /** Durable session event type. */
    readonly type: string;
    readonly seq: number;
    readonly time: number;
    /** Tool name for tool events; null when the type alone is the whole story. */
    readonly detail: string | null;
}
/**
 * What the fold itself has been doing.
 *
 * The panel exists to say what a session is doing; these counters say whether
 * the panel can still be believed. They are the difference between "nothing is
 * happening" and "this view stopped receiving data", which look identical on
 * screen otherwise.
 */
export interface LiveTaskHealth {
    /** Durable events folded into the state. */
    readonly folded: number;
    /** Events this build deliberately does not fold (session setup, receipts, …). */
    readonly ignored: number;
    /** Events whose type this build has never seen — a host newer than the plugin. */
    readonly unknown: number;
    /**
     * Stream frames the host delivered to this plugin.
     *
     * Counted at the listener, before any normalization: a frame that arrives and
     * is then discarded for not matching the open attempt is a different problem
     * from a listener that never fires, and the two were indistinguishable while
     * only the post-normalization numbers were recorded.
     */
    readonly frames: number;
    /** Agents this plugin attached a stream listener to. */
    readonly agents: number;
    /** Agents visible in the host registry when the attach was attempted. */
    readonly registry: number;
    /** Transient text deltas accepted as live progress. */
    readonly deltasAccepted: number;
    /** Transient deltas dropped as replays, stragglers or out-of-step frames. */
    readonly deltasDropped: number;
}
/**
 * One row of the session timeline.
 *
 * The panel's main body is a chronological timeline rather than parallel lists:
 * a reader following a long task wants the narrative ("message → model → tool →
 * result → model"), not four views of the same minutes. Kinds mirror what the
 * session log actually contains, and each row carries everything needed to read
 * it in place — when, what, what it was given, how it ended.
 */
export interface LiveTimelineEntry {
    /** Stable identity: the tool call id, or a per-kind sequence for other rows. */
    readonly id: string;
    /** Conversation turn this row belongs to; null before the first `turn/start`. */
    readonly turn: number | null;
    /**
     * Step inside the turn this row belongs to, or null when the event carried no
     * step number (a message between steps, for instance). The trajectory view
     * groups its rows by step, and the numbers are already in the session events.
     */
    readonly step: number | null;
    /** What produced this row. */
    readonly kind: 'turn' | 'user' | 'assistant' | 'tool' | 'context';
    /** Epoch milliseconds the row opened at. */
    readonly startedAt: number;
    /** Epoch milliseconds it settled at, or null while it is still open. */
    readonly endedAt: number | null;
    /** Headline: the tool name, or a human word for the other kinds. */
    readonly title: string;
    /**
     * Entry id of the plugin that registered this row's tool, or null for rows the
     * session itself produced (`user/message` and the like).
     *
     * Naming a row "工具" told a reader nothing about where it came from; the entry
     * id is what the host lists in its own plugin inventory.
     */
    readonly entryId: string | null;
    /** What it was given: the command, path, URL, or the first line of a message. */
    readonly detail: string | null;
    /** What came back, first line only. Null while open or when nothing came back. */
    readonly result: string | null;
    /**
     * Full arguments for the expanded row, clipped.
     *
     * The collapsed row shows one clipped line; opening it should show what was
     * actually passed. The bound keeps the wire a fixed size however long a turn
     * runs — thirty rows of unbounded JSON would not be a projection any more.
     */
    readonly argsFull: string | null;
    /** Full result text for the expanded row, clipped the same way. */
    readonly resultFull: string | null;
    /** `ok`, `failed`, or `running` while open. */
    readonly status: 'ok' | 'failed' | 'running';
}
/**
 * One conversation turn, summarised for the timeline's horizontal axis.
 *
 * The axis is turn-based rather than clock-based on purpose: turns are the unit
 * a reader thinks in ("what happened in turn 3"), and a long idle gap between
 * turns would otherwise dominate the chart.
 */
export interface LiveTurnSummary {
    readonly turn: number;
    /** Epoch milliseconds of the turn's first observation. */
    readonly startedAt: number;
    /** Epoch milliseconds the turn closed at, or null while it is open. */
    readonly endedAt: number | null;
    /** Tool calls issued in this turn. */
    readonly toolCalls: number;
    /** Of those, how many came back failed. */
    readonly failures: number;
    /** Distinct tool names used in this turn, in first-use order. */
    readonly tools: readonly string[];
    /** Tokens this turn spent, summed from its assistant messages. */
    readonly tokens: number;
}
/**
 * Token usage folded from the session's own assistant messages.
 *
 * The host already records usage per message; nothing carried it to a surface a
 * person watches, so "what has this session cost" had no answer outside the
 * transcript. Absent usage on a message is reported as absence, never as zero.
 */
export interface LiveTaskUsage {
    /** Assistant messages that carried a usage report. */
    readonly reported: number;
    /** Prompt tokens billed, summed over those messages. */
    readonly input: number;
    /** Completion tokens billed. */
    readonly output: number;
    /** Tokens served from cache, which are cheaper and the point of the ratio. */
    readonly cacheRead: number;
    /** Reasoning tokens, when the provider separates them. */
    readonly reasoning: number;
    /** Total tokens the provider reported. */
    readonly total: number;
}
/** One lane-chart segment: the shape the trajectory view draws as a dense bar. */
export interface LiveSpan {
    /** Same id as the timeline row it belongs to. */
    readonly id: string;
    /** Turn it happened in. */
    readonly turn: number;
    /** Which lane: `user`, `assistant`, `tool`, `context`. */
    readonly kind: 'user' | 'assistant' | 'tool' | 'context';
    /** `ok`, `failed` or `running`. */
    readonly status: 'ok' | 'failed' | 'running';
    /** Epoch milliseconds it started. */
    readonly startedAt: number;
    /** Epoch milliseconds it settled at, or null while open. */
    readonly endedAt: number | null;
    /**
     * Tool name for a tool span, null otherwise.
     *
     * Hovering a bar used to say only `tool · 17:59:31` — nothing about *which*
     * tool, official or ours. The name rides on the span so the strip can answer
     * that even for bars whose row has scrolled out of the retained window.
     */
    readonly title: string | null;
}
/** One finished (or running) tool call as a human-readable line. */
export interface LiveTaskAction {
    readonly callId: string;
    readonly name: string;
    /** Argument summary: the command, path or URL the call was given. */
    readonly detail: string | null;
    readonly startedAt: number;
    readonly endedAt: number | null;
    /** `ok`, `failed`, or `running` while the result has not arrived. */
    readonly status: 'ok' | 'failed' | 'running';
    /** First line of the answer, clipped; null while running or when empty. */
    readonly result: string | null;
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
    readonly turn: number | null;
    /** Open step number inside `turn`, or null between steps. */
    readonly step: number | null;
    /** True while a turn is open: the agent still owes work on this session. */
    readonly running: boolean;
    /** Highest durable seq folded in; 0 before the first event. */
    readonly seq: number;
    /** Unix epoch milliseconds of the last folded observation; null before any. */
    readonly updatedAt: number | null;
    /** Most recent tool call at any age, or null when the session never ran one. */
    readonly lastTool: LiveToolCall | null;
    /** Tool calls of the open turn still awaiting a result, in issue order. */
    readonly openTools: readonly LiveToolCall[];
    /**
     * Tool calls folded for the open turn; reset by the next `turn/start`.
     *
     * Turn scope. Contrast with {@link toolCallsTotal}, which spans the session.
     * Every count in this view names its scope, because "5 calls" means something
     * different per turn and per session and the panel used to leave that implicit.
     */
    readonly toolCallsInTurn: number;
    /** Tool calls folded since this session was first seen. Never reset. */
    readonly toolCallsTotal: number;
    /** Calls that came back failed, over the whole session. Never reset. */
    readonly failuresTotal: number;
    /** Most recent durable observation, for the "last event" line. */
    readonly lastEvent: LiveEventSummary | null;
    /** Newest-last window of recent observations, so the view can show a trail. */
    readonly recent: readonly LiveEventSummary[];
    /** Called tool names with their outcome summary, newest last. */
    readonly actions: readonly LiveTaskAction[];
    /** Newest-last session timeline; bounded, so the wire stays a fixed size. */
    readonly timeline: readonly LiveTimelineEntry[];
    /**
     * Lane segments, kept apart from the row window.
     *
     * The rows are bounded to keep the wire small, but the lane chart needs every
     * segment to read as the dense bar the trajectory view draws — a chart of the
     * twenty retained rows looks empty next to it.
     */
    readonly spans: readonly LiveSpan[];
    /** Newest-last turn summaries, for the timeline's horizontal axis. */
    readonly turns: readonly LiveTurnSummary[];
    /**
     * Turns this session has opened, never trimmed.
     *
     * The axis keeps the last twenty; reporting that window's length as the session
     * total told a 64-turn session it had 20 — a number a reader would act on.
     */
    readonly turnsTotal: number;
    /** Token usage for the whole session, folded from assistant messages. */
    readonly usage: LiveTaskUsage;
    /** Schemas of the tools rows actually called — name → trimmed definition. */
    readonly toolSchemas: Readonly<Record<string, string>>;
    /** Fold counters, so the panel can report its own freshness. */
    readonly health: LiveTaskHealth;
    /**
     * Tools the host offered the model in this session, or null when the request
     * header has not been folded yet.
     *
     * Read from the session's own request header, so it covers every tool the
     * model could call — official ones included — not only the tools this
     * repository ships.
     */
    readonly toolsAvailable: number | null;
    /** Unix epoch milliseconds of the newest transient delta, or null if none. */
    readonly streamedAt: number | null;
    /** `TurnEndReason.kind` of the most recent `turn/end`; null before one. */
    readonly endedReason: string | null;
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
    /**
     * Every tool the request header offered, keyed by name — host-only.
     *
     * The header carries sixty definitions a session; publishing them all would
     * dwarf the view. Only what a row actually called is copied out to
     * `toolSchemas` and put on the wire.
     */
    readonly headerSchemas: Readonly<Record<string, string>>;
    /** Characters of assistant text streamed for the open step. */
    readonly streamedTextLength: number;
    /** Time of the last folded text delta for the open step; null before one. */
    readonly streamedAt: number | null;
    /** Fold counters, so the host can report its own freshness. */
    readonly health: LiveTaskHealth;
}
