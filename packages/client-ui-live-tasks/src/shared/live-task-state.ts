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
  LiveSpan,
  LiveTaskAction,
  LiveEventLike,
  LiveEventSummary,
  LiveTaskObservation,
  LiveTaskState,
  LiveTimelineEntry,
  LiveTurnSummary,
  LiveToolCall,
} from './types.ts'

/** One frozen array reused for every state without open tool calls. */
const NO_EVENTS: readonly LiveEventSummary[] = Object.freeze([])
const NO_ACTIONS: readonly LiveTaskAction[] = Object.freeze([])
const NO_TIMELINE: readonly LiveTimelineEntry[] = Object.freeze([])
const NO_TURNS: readonly LiveTurnSummary[] = Object.freeze([])
const NO_SPANS: readonly LiveSpan[] = Object.freeze([])

/**
 * Record one tool call against its turn's summary, opening the turn if needed.
 * @param turns - existing summaries, oldest first.
 * @param turn - the turn the call belongs to.
 * @param time - when the call started.
 * @param name - the tool name.
 * @returns a new bounded array.
 */
function addCallToTurn(
  turns: readonly LiveTurnSummary[],
  turn: number | null,
  time: number,
  name: string,
  windows: LiveTaskWindows,
): readonly LiveTurnSummary[] {
  if (turn === null) return turns
  const existing = turns.find((summary) => summary.turn === turn)
  if (existing === undefined) {
    return [...turns, {
      turn,
      startedAt: time,
      endedAt: null,
      toolCalls: 1,
      failures: 0,
      tools: [name],
      tokens: 0,
    }].slice(-windows.turns)
  }
  return turns.map((summary) => (summary.turn === turn
    ? {
        ...summary,
        toolCalls: summary.toolCalls + 1,
        tools: summary.tools.includes(name) ? summary.tools : [...summary.tools, name],
      }
    : summary))
}

/** Close a turn's summary and count a failure against it. */
function settleTurn(
  turns: readonly LiveTurnSummary[],
  turn: number | null,
  time: number,
  failed: boolean,
): readonly LiveTurnSummary[] {
  if (turn === null) return turns
  return turns.map((summary) => (summary.turn === turn
    ? { ...summary, endedAt: time, failures: failed ? summary.failures + 1 : summary.failures }
    : summary))
}

/**
 * Append one row, trimming from the front.
 * @param timeline - existing rows, oldest first.
 * @param entry - row to append.
 * @returns a new bounded array.
 */
function pushTimeline(
  timeline: readonly LiveTimelineEntry[],
  entry: LiveTimelineEntry,
  windows: LiveTaskWindows,
): readonly LiveTimelineEntry[] {
  const windowed = [...timeline, entry].slice(-windows.timeline)
  if (windows.fullDetail === null) return windowed
  const keepFrom = windowed.length - Math.min(windows.fullDetail, windowed.length)
  return windowed.map((row, index) => (index < keepFrom ? demoteRow(row) : row))
}

/**
 * Strip a row's heavy payloads as it ages out of the full-detail window.
 * @param row - the row to demote.
 * @returns the same reference when already light.
 */
function demoteRow(row: LiveTimelineEntry): LiveTimelineEntry {
  if (row.argsFull === null && row.resultFull === null) return row
  return { ...row, argsFull: null, resultFull: null }
}

/** Replace one row in place, keeping its position in the narrative. */
function settleTimeline(
  timeline: readonly LiveTimelineEntry[],
  id: string,
  patch: Partial<LiveTimelineEntry>,
): readonly LiveTimelineEntry[] {
  return timeline.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
}

/** First non-empty line of a message's text blocks, clipped. */
function firstLineOfMessage(data: Record<string, unknown> | undefined): string | null {
  const message = recordOf(data?.['message'])
  const blocks = Array.isArray(message?.['content']) ? message['content'] as unknown[] : []
  for (const block of blocks) {
    const record = recordOf(block)
    if (record?.['type'] === 'text' && typeof record['text'] === 'string') {
      const line = record['text'].split('\n').map((value) => value.trim()).find((value) => value !== '')
      if (line !== undefined) return clip(line)
    }
  }
  return null
}

/** Usage before any message reported it. */
const INITIAL_USAGE = Object.freeze({ reported: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0, total: 0 })

/**
 * Read a token count out of a usage record.
 * @param usage - the message's usage payload.
 * @param key - field name.
 * @returns the number, or 0 when the provider did not report it.
 */
/**
 * Fold one row into both the row window and the lane segments.
 *
 * They are bounded separately: rows keep the wire small (twenty), the chart needs
 * density (four hundred) or the strip reads as empty next to the trajectory view.
 * @param state - state before the row.
 * @param entry - the row just folded.
 * @returns the new `timeline` and `spans`.
 */
function foldTimeline(
  state: LiveTaskState,
  entry: LiveTimelineEntry,
  windows: LiveTaskWindows,
): Pick<LiveTaskState, 'timeline' | 'spans'> {
  return {
    timeline: pushTimeline(state.timeline, entry, windows),
    spans: pushSpan(state.spans, entry, windows),
  }
}

/**
 * Record one lane segment alongside a timeline row.
 * @param spans - the current segment list.
 * @param entry - the row just folded.
 * @returns the new list, newest-last and bounded.
 */
function pushSpan(
  spans: readonly LiveSpan[],
  entry: LiveTimelineEntry,
  windows: LiveTaskWindows,
): readonly LiveSpan[] {
  if (entry.kind === 'turn') return spans
  return [
    ...spans,
    {
      id: entry.id,
      turn: entry.turn ?? 0,
      kind: entry.kind,
      status: entry.status,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      title: entry.kind === 'tool' ? entry.title : null,
    },
  ].slice(-windows.spans)
}

function usageField(usage: Record<string, unknown> | undefined, key: string): number {
  if (usage === undefined) return 0
  const value = usage[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Counters start at zero; nothing has been folded yet. */
const INITIAL_HEALTH = Object.freeze({ folded: 0, ignored: 0, unknown: 0, frames: 0, deltasAccepted: 0, deltasDropped: 0, agents: 0, registry: 0 })

/** One frozen array reused for every state without open tool calls. */
const NO_TOOLS: readonly LiveToolCall[] = Object.freeze([])

/**
 * Event types this build recognizes and deliberately leaves out of the fold.
 *
 * Session setup, request headers, policy records and receipts are real events
 * that say nothing about what a task is doing. Naming them is what keeps the
 * `unknown` counter meaningful: a host that adds a type shows up as a number,
 * instead of every ordinary session start looking like a surprise.
 */
const IGNORED_TYPES = new Set([
  'session', 'session/title', 'session/title-llm-request', 'system/message',
  'request/context', 'permission/preset', 'approval/policy',
  'sandbox/mode', 'subagent/model-selection-policy', 'agent/inbox/spliced',
])

/**
 * Event types this build folds deliberately.
 *
 * Anything outside both sets is counted as unknown rather than silently
 * dropped: a host that starts emitting a new type should show up as a number
 * the panel can display, not as behaviour that quietly stops updating.
 */
const KNOWN_TYPES = new Set([
  'turn/start', 'turn/end', 'step/start', 'step/end', 'tool/call', 'tool/result',
  'assistant/message', 'assistant/attempt', 'user/message', 'agent/assistant-stream',
  // Folded for one derived number (how many tools the model was offered), not
  // for a task fact: the header is the only place that list exists.
  'request/header',
])

/**
 * Schema trim: a per-tool definition is capped before it can reach the wire.
 * The drawer shows a schema as text; a definition past this cap is cut with an
 * ellipsis rather than ballooning every projection publish.
 */
const SCHEMA_TRIM = 1800

/**
 * Fold a request header's tool list into a name → schema map, reusing entries
 * whose definition is unchanged.
 * @param tools - the header's tool array (or anything that is not one).
 * @param previous - the map from the last header.
 * @returns the new map (same reference when nothing changed).
 */
/**
 * Publish one tool's schema into the view (once per tool, only for tools a row
 * actually called).
 * @param state - current state.
 * @param name - the tool that was just called.
 * @returns `toolSchemas` updates, or an empty object when already present.
 */
function ensureToolSchema(
  state: LiveTaskState,
  name: string,
): Partial<LiveTaskState> {
  const known = state.toolSchemas[name]
  const schema = state.headerSchemas[name]
  if (known !== undefined || schema === undefined) return {}
  return { toolSchemas: { ...state.toolSchemas, [name]: schema } }
}

function collectToolSchemas(
  tools: unknown,
  previous: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (!Array.isArray(tools)) return previous
  const next: Record<string, string> = {}
  for (const entry of tools) {
    const record = recordOf(entry)
    const name = record?.['name']
    if (typeof name !== 'string' || name === '') continue
    const body = JSON.stringify(entry)
    next[name] = body.length > SCHEMA_TRIM ? `${body.slice(0, SCHEMA_TRIM)}…` : body
  }
  return Object.keys(next).length === 0 ? previous : next
}

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
  toolCallsTotal: 0,
  failuresTotal: 0,
  toolsAvailable: null,
  streamedTextLength: 0,
  streamedAt: null,
  usage: INITIAL_USAGE,
  health: INITIAL_HEALTH,
  lastEvent: null,
  recent: NO_EVENTS,
  timeline: NO_TIMELINE,
  spans: NO_SPANS,
  toolSchemas: Object.freeze({}),
  headerSchemas: Object.freeze({}),
  turns: NO_TURNS,
  turnsTotal: 0,
  actions: NO_ACTIONS,
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
/** How many recent observations the view keeps for its trail. */
export const RECENT_EVENT_LIMIT = 6

/**
 * The entry id a tool name belongs to, by the ecosystem's naming law.
 *
 * `check_ui_size` is registered by the bundle whose entry id is
 * `tool-check-ui-size` (ids keep dashes, tool names use underscores), and the
 * official tools follow the same law (`bash` → `tool-bash`). Showing it tells a
 * reader which plugin a row came from instead of the generic word "tool".
 * @param toolName - the registered tool name.
 * @returns the entry id, or null when the name carries nothing to derive from.
 */
export function entryIdOfTool(toolName: string): string | null {
  const trimmed = toolName.trim()
  if (trimmed === '') return null
  return `tool-${trimmed.replaceAll('_', '-')}`
}

/** Bounded windows: the host projection's wire shape. */
export interface LiveTaskWindows {
  /** Rows retained in the published timeline. */
  readonly timeline: number
  /** Turn summaries retained. */
  readonly turns: number
  /** Lane segments retained. */
  readonly spans: number
  /** Newest rows keeping full payloads, or null to demote nothing. */
  readonly fullDetail: number | null
}

/** How many lane segments the view keeps (the chart wants density, not rows). */
const SPAN_LIMIT = 1600

/** How many timeline rows the view keeps. */
export const TIMELINE_LIMIT = 384

/**
 * How many of the newest rows keep their full argument/result payloads.
 *
 * The trajectory view pages the whole session through the conversation carrier;
 * this panel reads a bounded projection, so coverage is bought with bytes. Rows
 * beyond this window keep their identity, times, text summary and result but
 * drop the large payloads — 64 full rows plus hundreds of summary rows fit in
 * roughly a third of a megabyte per publish, measured live after install, where
 * every payload-bearing row would have cost well over a megabyte.
 */
export const FULL_DETAIL_WINDOW = 64

/** Longest detail payload carried for an expanded row. */
const DETAIL_PAYLOAD_LIMIT = 600
/**
 * Payload ceilings for the drawer's tabs.
 *
 * One 600-character cap served the row's inline summary but also the drawer, so
 * the 参数 and 结果 tabs showed cut-off JSON — the operator's complaint. The row
 * keeps the small cap; the drawer gets real payloads, bounded so a session of
 * huge results cannot multiply the projection by megabytes: arguments fit any
 * command worth reading (4KB), results up to 8KB with an ellipsis beyond.
 */
const EXPAND_ARGS_LIMIT = 4096
const EXPAND_RESULT_LIMIT = 8192

/** How many turns the axis keeps. */
export const TURN_LIMIT = 96

/** Longest argument summary carried to the client; longer values are clipped. */
const DETAIL_LIMIT = 80

/** How many finished calls the activity log keeps. */
export const ACTION_LIMIT = 8

/**
 * The host projection's windows: bounded so the wire stays a fixed size.
 */
export const HOST_WINDOWS: LiveTaskWindows = {
  timeline: TIMELINE_LIMIT,
  turns: TURN_LIMIT,
  spans: SPAN_LIMIT,
  fullDetail: FULL_DETAIL_WINDOW,
}

/**
 * Windows for the client-side archive fold over the resident event window.
 *
 * The client keeps records in browser memory — no wire, no checkpoint — so the
 * caps that exist purely to bound bytes are lifted and the whole session folds:
 * every row, every turn, every span. This is the paging path the reference view
 * takes through `session.loadOlder()`; here the same reducer just runs unbounded
 * over whatever the window holds.
 */
export const CLIENT_WINDOWS: LiveTaskWindows = {
  timeline: Number.POSITIVE_INFINITY,
  turns: Number.POSITIVE_INFINITY,
  spans: Number.POSITIVE_INFINITY,
  fullDetail: null,
}

/** Longest result line carried to the client. */
const RESULT_LIMIT = 60

/** Argument keys worth showing, in the order a reader wants them. */
const DETAIL_KEYS = ['command', 'file_path', 'path', 'selector', 'url', 'pattern', 'query', 'task', 'prompt']

/**
 * Turn a tool call's arguments into one display line.
 *
 * The session records `data.arguments` as a JSON **string** (occasionally as an
 * already-parsed object), and the useful part differs per tool: a shell call is
 * its command, a file call its path, a fetch its URL. Unknown shapes fall back
 * to the first string value, and an unreadable payload reports `null` rather
 * than a guess — a wrong line here would be worse than no line.
 * @param data - the `tool/call` event payload, already narrowed to an object.
 * @returns one clipped line, or null when nothing readable was carried.
 */
export function summarizeToolArguments(data: Record<string, unknown> | undefined): string | null {
  const raw = data?.['arguments']
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return clip(raw)
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const args = parsed as Record<string, unknown>
  // Up to two fields: "what" plus "where". A measuring call reads best as
  // `#card @ http://…`, where either half alone leaves the reader guessing.
  const parts: string[] = []
  for (const key of DETAIL_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') parts.push(value)
    if (parts.length === 2) break
  }
  if (parts.length > 0) return clip(parts.join(' @ '))
  const firstString = Object.values(args).find((value) => typeof value === 'string' && value.trim() !== '')
  return typeof firstString === 'string' ? clip(firstString) : null
}

/**
 * Turn a call and its result into one activity-log line.
 * @param call - the call record as it was opened.
 * @param endedAt - epoch milliseconds of the matching result.
 * @param data - the `tool/result` payload.
 * @returns the human-readable action record.
 */
function actionOf(
  call: LiveToolCall,
  endedAt: number,
  data: Record<string, unknown> | undefined,
  failed: boolean,
): LiveTaskAction {
  return {
    callId: call.callId,
    name: call.name,
    detail: call.detail,
    startedAt: call.startedAt,
    endedAt,
    status: failed ? 'failed' : 'ok',
    result: summarizeToolResult(data),
  }
}

/** Status values a tool uses in its own payload to report a failed operation. */
const FAILURE_STATUSES = new Set(['error', 'failed', 'failure', 'not_found', 'unavailable', 'denied', 'timeout', 'invalid'])

/**
 * Decide whether a tool call failed, from both places a failure can be written.
 *
 * A tool can fail the way the harness notices (`isError` on the result block) or
 * the way this ecosystem's tools usually report it: a successful tool call whose
 * payload says `{"status":"error","code":…}`. The panel is for a person, and "the
 * call worked but the operation failed" must not read as 完成 — measured live,
 * where a failed page load and a missing file both showed as completed.
 * @param data - the `tool/result` payload.
 * @param harnessError - the harness-level error flag, if the caller read one.
 * @returns true when either layer reports a failure.
 */
export function toolResultFailed(data: Record<string, unknown> | undefined, harnessError?: boolean): boolean {
  if (harnessError === true) return true
  if (data !== undefined && data['error'] !== undefined && data['error'] !== null) return true
  const message = recordOf(data?.['message'])
  const blocks = Array.isArray(message?.['content']) ? message['content'] as unknown[] : []
  for (const block of blocks) {
    const record = recordOf(block)
    if (record?.['isError'] === true) return true
    const inner = Array.isArray(record?.['content']) ? record['content'] as unknown[] : []
    for (const part of inner) {
      const candidate = recordOf(part)
      if (candidate?.['type'] !== 'text' || typeof candidate['text'] !== 'string') continue
      const firstLine = candidate['text'].split('\n').map((line) => line.trim()).find((line) => line !== '')
      if (firstLine === undefined || !firstLine.startsWith('{')) continue
      try {
        const parsed: unknown = JSON.parse(firstLine)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue
        const status = (parsed as Record<string, unknown>)['status']
        if (typeof status === 'string' && FAILURE_STATUSES.has(status)) return true
      } catch {
        // Not JSON after all; the first line stays prose and carries no verdict.
      }
    }
  }
  return false
}

/**
 * Make one result line readable.
 *
 * Tools answer with JSON far more often than with prose, and a raw object reads
 * as noise in a log. Scalar fields are shown as `key=value` pairs instead; a
 * payload whose interesting field is nested keeps its first line, because a
 * half-rendered object would be worse than an honest one.
 * @param line - the first non-empty line of the result.
 * @returns a compact human-readable form of that line.
 */
function summarizeResultLine(line: string): string {
  if (!line.startsWith('{')) return line
  try {
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return line
    const pairs: string[] = []
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        pairs.push(`${key}=${String(value)}`)
      }
      if (pairs.length === 4) break
    }
    return pairs.length === 0 ? line : pairs.join(', ')
  } catch {
    return line
  }
}

/**
 * First non-empty line of a tool result, clipped.
 *
 * A tool's answer can be kilobytes; the activity log needs only enough to say
 * "it came back with something" — a failing call is reported by its error line.
 * @param data - the `tool/result` payload.
 * @returns one clipped line, or null when the result carried no text.
 */
/**
 * The whole text of a tool result, for the expanded row.
 * @param data - the `tool/result` payload.
 * @returns concatenated text blocks, or null when the result carried none.
 */
function fullToolResult(data: Record<string, unknown> | undefined): string | null {
  const message = recordOf(data?.['message'])
  const blocks = Array.isArray(message?.['content']) ? message['content'] as unknown[] : []
  let text = ''
  for (const block of blocks) {
    const record = recordOf(block)
    const inner = Array.isArray(record?.['content']) ? record['content'] as unknown[] : []
    for (const part of inner) {
      const candidate = recordOf(part)
      if (candidate?.['type'] === 'text' && typeof candidate['text'] === 'string') text += candidate['text']
    }
  }
  return text === '' ? null : text
}

export function summarizeToolResult(data: Record<string, unknown> | undefined): string | null {
  const message = recordOf(data?.['message'])
  const blocks = Array.isArray(message?.['content']) ? message['content'] as unknown[] : []
  let text = ''
  for (const block of blocks) {
    const record = recordOf(block)
    const inner = Array.isArray(record?.['content']) ? record['content'] as unknown[] : []
    for (const part of inner) {
      const candidate = recordOf(part)
      if (candidate?.['type'] === 'text' && typeof candidate['text'] === 'string') text += candidate['text']
    }
  }
  const line = text.split('\n').map((value) => value.trim()).find((value) => value !== '')
  if (line === undefined) return null
  return clip(summarizeResultLine(line)).slice(0, RESULT_LIMIT)
}

/**
 * Prepare a payload for the expanded row: pretty-print JSON when it parses,
 * otherwise pass the text through, clipped.
 * @param value - raw text or JSON string.
 * @returns the expandable form, or null when there is nothing to show.
 */
function expandable(value: string | null, limit: number = DETAIL_PAYLOAD_LIMIT): string | null {
  if (value === null || value.trim() === '') return null
  const text = value.trim().startsWith('{') || value.trim().startsWith('[')
    ? (() => {
        try {
          return JSON.stringify(JSON.parse(value), null, 2)
        } catch {
          return value
        }
      })()
    : value
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

/** Collapse whitespace and clip to the wire budget. */
function clip(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length <= DETAIL_LIMIT ? flat : `${flat.slice(0, DETAIL_LIMIT - 1)}…`
}

function summary(event: LiveEventLike, detail: string | null): LiveEventSummary {
  return { type: event.type, seq: event.seq, time: event.time, detail }
}

/**
 * Record one observation: the "last event" line plus the bounded trail.
 *
 * The trail is what makes the view readable — a single last-event line says
 * what just happened, not what the session has been doing. It is capped so the
 * wire payload stays a fixed size no matter how long a turn runs.
 * @param state - state before this observation.
 * @param event - the event being folded.
 * @param detail - display detail for this observation, or null.
 * @returns the two fields every fold branch writes.
 */
function observed(
  state: LiveTaskState,
  event: LiveEventLike,
  detail: string | null,
): Pick<LiveTaskState, 'lastEvent' | 'recent'> {
  const entry = summary(event, detail)
  // Transport bookkeeping (`session-log-*` delivery receipts and the like) is
  // real but unreadable in a task trail: it would push the events a reader
  // cares about out of the window without saying anything about the task.
  if (event.type.startsWith('session-log-')) return { lastEvent: entry, recent: state.recent }
  return { lastEvent: entry, recent: [...state.recent, entry].slice(-RECENT_EVENT_LIMIT) }
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
function foldEvent(
  state: LiveTaskState,
  event: LiveEventLike,
  agentAttached = false,
  registrySize?: number,
  windows: LiveTaskWindows = HOST_WINDOWS,
): LiveTaskState {
  const seq = numberOf(event.seq)
  const time = numberOf(event.time)
  if (seq === undefined || time === undefined || seq <= state.seq) return state

  const envelope = {
    seq,
    updatedAt: state.updatedAt === null ? time : Math.max(state.updatedAt, time),
    health: {
      ...state.health,
      folded: state.health.folded + 1,
      ...(agentAttached ? { agents: state.health.agents + 1 } : {}),
      // Negative values are sentinels (unreachable / threw), so they overwrite
      // rather than lose a `Math.max` against the initial zero.
      ...(registrySize === undefined
        ? {}
        : { registry: registrySize < 0 ? registrySize : Math.max(state.health.registry, registrySize) }),
      ...(KNOWN_TYPES.has(event.type)
        ? {}
        : IGNORED_TYPES.has(event.type) || event.type.startsWith('session-log-')
          ? { ignored: state.health.ignored + 1 }
          : { unknown: state.health.unknown + 1 }),
    },
  }
  const data = recordOf(event.data)

  // The request header carries the tool list the model was offered. Reading it
  // here is what lets the panel say "available tools", which spans official and
  // third-party tools alike rather than only the ones this repository ships.
  if (event.type === 'request/header') {
    // The tools list lives at `header.tools` in current sessions; older headers
    // kept it under `header.config`. Reading only the config path left
    // `toolsAvailable` null — the panel displayed `可用工具 —` for every live
    // session — and no schema for the drawer to show.
    const header = recordOf(data?.['header'])
    const tools = header?.['tools'] ?? recordOf(header?.['config'])?.['tools']
    const count = Array.isArray(tools) ? tools.length : undefined
    return {
      ...state,
      ...envelope,
      ...(count === undefined ? {} : { toolsAvailable: count }),
      // Keep the schema the drawer's Schema tab needs, keyed by tool name. The
      // request header carries every tool the model was offered; only what a row
      // actually calls is published to the wire, so a 60-tool header costs a few
      // kilobytes instead of sixty.
      headerSchemas: collectToolSchemas(tools, state.headerSchemas),
      ...observed(state, event, null),
    }
  }

  switch (event.type) {
    case 'turn/start': {
      const turn = numberOf(data?.['turn']) ?? null
      return {
        ...state,
        ...envelope,
        turn: turn ?? state.turn,
        step: null,
        running: true,
        openTools: NO_TOOLS,
        turnsTotal: turn === null || state.turns.some((summary) => summary.turn === turn)
          ? state.turnsTotal
          : state.turnsTotal + 1,
        turns: turn === null || state.turns.some((summary) => summary.turn === turn)
          ? state.turns
          : [...state.turns, { turn, startedAt: time, endedAt: null, toolCalls: 0, failures: 0, tools: [], tokens: 0 }].slice(-windows.turns),
        timeline: turn === null
          ? state.timeline
          : pushTimeline(state.timeline, {
              id: `turn-${turn}`,
              kind: 'turn',
              turn,
              step: null,
              startedAt: time,
              endedAt: null,
              title: '',
              entryId: null,
              detail: null,
              argsFull: null,
              resultFull: null,
              result: null,
              status: 'ok',
            }, windows),
        toolCallsInTurn: 0,
        // Session-scope counters deliberately survive a new turn: only what
        // belongs to the turn resets here.
        streamedTextLength: 0,
        streamedAt: null,
        endedReason: null,
        ...observed(state, event, null),
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
        ...observed(state, event, null),
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
        ...observed(state, event, null),
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
        ...observed(state, event, null),
      }
    }
    case 'tool/call': {
      const callId = stringOf(data?.['callId'])
      const name = stringOf(data?.['name'])
      if (callId === undefined || name === undefined) {
        return { ...state, ...envelope, ...observed(state, event, null) }
      }
      const call: LiveToolCall = {
        callId,
        name,
        turn: numberOf(data?.['turn']) ?? state.turn,
        step: numberOf(data?.['step']) ?? state.step,
        open: true,
        detail: summarizeToolArguments(data),
        startedAt: time,
      }
      return {
        ...state,
        ...envelope,
        // Publish the schema of this call's tool once, so the drawer's Schema tab
        // shows the real definition the model was given.
        ...ensureToolSchema(state, name),
        lastTool: call,
        openTools: [...state.openTools, call],
        toolCallsInTurn: state.toolCallsInTurn + 1,
        toolCallsTotal: state.toolCallsTotal + 1,
        turns: addCallToTurn(state.turns, call.turn, time, name, windows),
        ...foldTimeline(state, {
          id: callId,
          kind: 'tool',
          turn: call.turn,
          step: call.step,
          startedAt: time,
          endedAt: null,
          title: name,
          entryId: entryIdOfTool(name),
          detail: call.detail,
          result: null,
          argsFull: expandable(typeof data?.['arguments'] === 'string' ? data['arguments'] as string : null, EXPAND_ARGS_LIMIT),
          resultFull: null,
          status: 'running',
        }, windows),
        ...observed(state, event, name),
      }
    }
    case 'tool/result': {
      const { callId, failed } = readToolResult(data)
      const resultFailed = toolResultFailed(data, failed)
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
          ? {
              ...state.lastTool,
              open: false,
              endedAt: time,
              result: summarizeToolResult(data),
              ...(resultFailed ? { failed: true } : {}),
            }
          : state.lastTool,
        failuresTotal: resultFailed ? state.failuresTotal + 1 : state.failuresTotal,
        turns: settleTurn(state.turns, settled?.turn ?? null, time, resultFailed),
        timeline: callId === undefined
          ? state.timeline
          : settleTimeline(state.timeline, callId, {
              endedAt: time,
              result: summarizeToolResult(data),
              resultFull: expandable(fullToolResult(data), EXPAND_RESULT_LIMIT),
              status: resultFailed ? 'failed' : 'ok',
            }),
        actions: settled === undefined
          ? state.actions
          : [
              ...state.actions.filter((action) => action.callId !== settled.callId),
              actionOf(settled, time, data, resultFailed),
            ].slice(-ACTION_LIMIT),
        ...observed(state, event, settled?.name ?? null),
      }
    }
    case 'user/message': {
      const detail = firstLineOfMessage(data)
      // Injected context arrives as a user message whose source is a plugin or a
      // snapshot; only a message without such a source is the reader's own.
      const source = recordOf(recordOf(data?.['message'])?.['source'])
      const injected = source !== undefined && stringOf(source['kind']) !== undefined
        && source['kind'] !== 'user'
      return {
        ...state,
        ...envelope,
        ...foldTimeline(state, {
          id: `user-${seq}`,
          kind: injected ? 'context' : 'user',
          turn: numberOf(data?.['turn']) ?? state.turn,
          step: numberOf(data?.['step']) ?? null,
          startedAt: time,
          endedAt: time,
          title: '',
          entryId: null,
          detail,
          result: null,
          argsFull: null,
          resultFull: expandable(fullToolResult(data), EXPAND_RESULT_LIMIT),
          status: 'ok',
        }, windows),
        ...observed(state, event, null),
      }
    }
    case 'assistant/message':
    case 'assistant/attempt': {
      const usage = recordOf(data?.['usage'])
      const reported = usage !== undefined && typeof usage['totalTokens'] === 'number'
      const spent = reported ? usageField(usage, 'totalTokens') : 0
      const turn = numberOf(data?.['turn']) ?? state.turn
      // The durable message supersedes every transient delta of its attempt, so
      // the streamed counter of that step starts clean for the next one.
      return {
        ...state,
        ...envelope,
        streamedTextLength: 0,
        streamedAt: null,
        usage: reported
          ? {
              reported: state.usage.reported + 1,
              input: state.usage.input + usageField(usage, 'inputTokens'),
              output: state.usage.output + usageField(usage, 'outputTokens'),
              cacheRead: state.usage.cacheRead + usageField(usage, 'cacheReadTokens'),
              reasoning: state.usage.reasoning + usageField(usage, 'reasoningTokens'),
              total: state.usage.total + spent,
            }
          : state.usage,
        turns: reported && turn !== null
          ? state.turns.map((summary) => (summary.turn === turn
              ? { ...summary, tokens: summary.tokens + spent }
              : summary))
          : state.turns,
        ...(event.type === 'assistant/message'
          ? foldTimeline(state, {
              id: `assistant-${seq}`,
              kind: 'assistant',
              turn: numberOf(data?.['turn']) ?? state.turn,
              step: numberOf(data?.['step']) ?? null,
              startedAt: time,
              endedAt: time,
              title: '',
              entryId: null,
              detail: firstLineOfMessage(data),
              result: null,
              argsFull: null,
              resultFull: expandable(fullToolResult(data), EXPAND_RESULT_LIMIT),
              status: 'ok',
            }, windows)
          : { timeline: state.timeline, spans: state.spans }),
        ...observed(state, event, null),
      }
    }
    default:
      return { ...state, ...envelope, ...observed(state, event, null) }
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
  // Every delta is accounted for: `deltasAccepted` is liveness, `deltasDropped`
  // is the replay/straggler rate. A plugin that silently discards frames cannot
  // tell you whether the model went quiet or its own filter ate the stream.
  const dropped = (): LiveTaskState => ({ ...state, health: { ...state.health, deltasDropped: state.health.deltasDropped + 1 } })
  if (!state.running) return dropped()
  if (delta.turn !== state.turn || delta.step !== state.step) return dropped()
  if (!Number.isFinite(delta.time)) return dropped()
  if (state.streamedAt !== null && delta.time < state.streamedAt) return dropped()

  const length = delta.text.length
  const updatedAt = state.updatedAt === null ? delta.time : Math.max(state.updatedAt, delta.time)
  if (length === 0 && state.streamedAt === delta.time && state.updatedAt === updatedAt) return dropped()
  return {
    ...state,
    streamedTextLength: state.streamedTextLength + length,
    streamedAt: delta.time,
    updatedAt,
    health: { ...state.health, deltasAccepted: state.health.deltasAccepted + 1 },
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
  windows: LiveTaskWindows = HOST_WINDOWS,
): LiveTaskState {
  if (observation.kind === 'stream-frame') {
    // Liveness only: the frame is recorded as received, then normalization
    // decides whether it carries text this fold can use.
    return { ...state, health: { ...state.health, frames: state.health.frames + 1 } }
  }
  return observation.kind === 'event'
    ? foldEvent(state, observation.event, observation.agentAttached === true, observation.registrySize, windows)
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
