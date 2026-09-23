/**
 * The `conversation.view` entry: the session as a timeline.
 *
 * ## Why a timeline
 *
 * Three earlier versions showed counts, then a table, then modules of cards.
 * Each asked the reader to assemble the story from parallel lists, and two of
 * them were rejected on sight for exactly that. A long task is one narrative —
 * your message, the model's reply, a tool call, its result, the next call — and
 * the built-in 轨迹 view already renders a session that way, so this panel
 * borrows the idiom rather than inventing a second one for the same data.
 *
 * ## Architecture
 *
 * It deliberately mirrors the built-in 轨迹 view, because two views over one
 * session should not teach two visual languages:
 *
 *   工具栏        搜索 / 展开全部 / 只看失败 — the same controls over the same data
 *   轮次横轴      one segment per turn, width by duration, in a strip that
 *                 scrolls sideways when a session has more turns than width
 *   轮次明细      per turn: which tools ran, with the payload inline; clicking a
 *                 row opens its full arguments and result, like a 轨迹 row
 *   运行状况      the panel's own counters, so a stale panel is visible as stale
 *
 * @module soia-dsh-client-ui-live-tasks/client/view
 */
import { StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { Fragment, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import {
  CLIENT_WINDOWS,
  hasLiveActivity,
  INITIAL_LIVE_TASK_STATE,
  reduceLiveTask,
  TIMELINE_LIMIT,
} from '../shared/live-task-state.ts'
import type { LiveSpan, LiveTaskState, LiveTaskView, LiveTimelineEntry, LiveTurnSummary } from '../shared/types.ts'
import type { PluginInfoCard } from './index.ts'
import type { LiveTaskKey } from './locales.ts'
import { styles } from './styles.ts'

/** Props the conversation view slot hands a session-scoped view. */
export interface LiveTasksViewProps {
  /** Host-computed projection value for this session, if the unit has one. */
  useProjection: (key: string) => unknown
  /** Namespace-bound translator for this view's copy. */
  t: (key: LiveTaskKey, params?: Record<string, string | number>) => string
  /**
   * Selector hook over the session snapshot (the shell's standard kit).
   *
   * Supplies the paging flags; the offline preview passes a stub, so every read
   * must go through the selector rather than assuming the field exists.
   */
  useSession: <Selected>(selector: (snapshot: SessionSnapshotLike) => Selected) => Selected
  /**
   * Resident event window for the client-side archive fold, injected by the
   * session-scoped registration. Absent in the offline preview, where the view
   * falls back to the host projection alone.
   */
  eventSource?: SessionEventSourceLike
  /** Pull one older history page; injected beside the event source. */
  loadOlder?: () => Promise<void>
  /** Look up the bundle a tool comes from (remote plugin manager); optional. */
  loadPluginInfo?: (toolName: string) => Promise<PluginInfoCard | null>
  /** Tool → package rows for the roster's default filter; optional. */
  listToolBundles?: () => Promise<{ tool: string, pkg: string, entryId: string }[]>
}

/** The window snapshot shape the view consumes — declared structurally so the
 *  browser bundle does not need a type-only import from the host SDK. */
interface SessionWindowLike {
  readonly entries: readonly ({ readonly type: 'event', readonly event: unknown } | { readonly type: 'transient', readonly event: unknown })[]
  readonly hasMore: boolean
  readonly revision: number
  /** How the latest revision arrived — append is the live hot path. */
  readonly change:
    | { readonly kind: 'append' | 'prepend' | 'replace', readonly entries: readonly { readonly type: string, readonly event: unknown }[] }
    | { readonly kind: 'settle-assistant' }
}

/** Observable face of one session's resident event window. */
export interface SessionEventSourceLike {
  subscribe(listener: () => void): () => void
  getSnapshot(): SessionWindowLike
}

/**
 * Per-source archive cache, outside React's render purity rules.
 *
 * A `useRef` cache inside the component is what the hooks rules forbid (refs are
 * not readable during render); a module-level WeakMap keyed by the event source
 * gives the same memoization with an identical result for identical inputs — the
 * cache only decides whether a live `append` folds one event or the whole
 * window, never what the fold computes.
 */
const ARCHIVE_CACHE = new WeakMap<object, { revision: number, packed: { state: LiveTaskState, stream: LiveStreamState | null } }>()

/** Fold one batch of window entries into a live-task state. */
/** Live text for the step being generated, decoded by the host before it ships. */
interface LiveStreamState {
  readonly turn: number
  readonly step: number
  readonly text: string
  readonly reasoning: string
}

/**
 * Fold durable events AND the session's transient live chunks.
 *
 * The transport already carries decoded `text-delta`/`reasoning-delta` chunks as
 * transient window entries — no host change and no new event shape are needed to
 * show text while it generates; the durable `assistant/message` that supersedes
 * the attempt clears it. The returned state feeds the panel exactly as before.
 * @param base - state before this batch.
 * @param baseStream - live text carried from earlier batches (null when idle).
 * @param entries - window entries in order.
 * @returns the folded state plus the current live stream, if any.
 */
function foldWindow(
  base: LiveTaskState,
  entries: readonly { readonly type: string, readonly event: unknown }[],
  baseStream: LiveStreamState | null = null,
): { state: LiveTaskState, stream: LiveStreamState | null } {
  let folded = base
  let stream = baseStream
  for (const entry of entries) {
    if (entry.type !== 'event') {
      // Transient presentation of a live attempt: decoded text, kept until the
      // durable message for the same step lands.
      const event = entry.event as { type: string, data?: Record<string, unknown> }
      if (event.type === 'assistant/live-chunk') {
        const data = event.data
        const chunk = recordOfChunk(data?.['chunk'])
        const turn = numberOfLocal(data?.['turn']) ?? stream?.turn ?? 0
        const step = numberOfLocal(data?.['step']) ?? stream?.step ?? 0
        if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
          const prior = stream !== null && stream.turn === turn && stream.step === step
            ? stream
            : { turn, step, text: '', reasoning: '' }
          stream = chunk.type === 'text-delta'
            ? { ...prior, text: `${prior.text}${chunk.text}` }
            : { ...prior, reasoning: `${prior.reasoning}${chunk.text}` }
        } else if (chunk.type === 'finish') {
          stream = null
        }
      }
      continue
    }
    folded = reduceLiveTask(folded, { kind: 'event', event: entry.event } as never, CLIENT_WINDOWS)
    const durable = entry.event as { type?: string }
    if (durable.type === 'assistant/message') stream = null
  }
  return { state: folded, stream }
}

/** Read one chunk's shape without trusting the transport blindly. */
function recordOfChunk(value: unknown): { type: string, text?: string } {
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return {
      type: typeof record['type'] === 'string' ? record['type'] : '',
      text: typeof record['text'] === 'string' ? record['text'] : undefined,
    }
  }
  return { type: '' }
}

/** Narrow an unknown field to a finite number. */
function numberOfLocal(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Selector target for the paging flags, matching the shell's session snapshot. */
interface SessionSnapshotLike {
  readonly hasMore: boolean
  readonly loadingOlder: boolean
  readonly openState?: 'cold' | 'loading' | 'open' | 'error'
}

/** Translator alias, to keep component signatures short. */
type T = LiveTasksViewProps['t']

/**
 * Re-render once a second so elapsed times stay true.
 * @returns the current epoch milliseconds.
 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/**
 * Render a token count compactly: `1234567` → `1.23M`.
 *
 * Six-digit numbers repeated down a column are hard to compare at a glance;
 * the exact value stays available in the tooltip.
 * @param value - token count.
 * @returns the compact form.
 */
function compact(value: number): string {
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`
  return `${(value / 1_000_000).toFixed(2)}M`
}


/**
 * Render a tool's arguments the way the trajectory view does: the first pair as
 * `key: "value"`, muted and monospaced, inside parentheses — not my summarizer's
 * `a @ b` which no other view in the product speaks.
 * @param entry - the row to read.
 * @returns the inline argument text, or null when there is nothing to show.
 */
function argsInline(entry: LiveTimelineEntry): string | null {
  if (entry.kind !== 'tool') return null
  if (entry.argsFull !== null) {
    try {
      const parsed: unknown = JSON.parse(entry.argsFull)
      // The trajectory view prints arguments as compact JSON on the row itself
      // (`bash {"command":…`), cut by the cell's ellipsis — not a first pair.
      if (parsed !== null && typeof parsed === 'object') return JSON.stringify(parsed)
      return String(parsed)
    } catch {
      // Long arguments are stored truncated, so the JSON may not parse; the text
      // is still JSON — minify it rather than falling back to the summariser,
      // because the row must read `bash {"command":…` like the reference.
      if (entry.argsFull.trimStart().startsWith('{') || entry.argsFull.trimStart().startsWith('[')) {
        return entry.argsFull.replace(/\s+/g, ' ').trim()
      }
    }
  }
  return entry.detail
}

/**
 * Hover text for one bar: which tool and what it is for, official or ours —
 * the strip used to say only `tool · 17:59:31`, which names nothing.
 * @param segment - the bar.
 * @param toolSchemas - header schemas keyed by tool name.
 * @param t - translator.
 * @param now - fallback clock for an open bar.
 * @returns the tooltip.
 */
function spanTitleOf(
  segment: LiveSpan,
  toolSchemas: Readonly<Record<string, string>>,
  t: T,
  now: number,
): string {
  const time = `${clockOf(segment.startedAt)} · ${t('time.seconds', { s: secondsBetween(segment.startedAt, segment.endedAt ?? now) })}`
  if (segment.title === null) {
    const kindLabel = segment.kind === 'tool'
      ? t('timeline.tool')
      : segment.kind === 'user'
        ? t('timeline.user')
        : segment.kind === 'context'
          ? t('lane.context')
          : t('timeline.assistant')
    return `${kindLabel} · ${time}`
  }
  const purpose = descriptionOf(toolSchemas[segment.title] ?? null)
  return purpose === null ? `${segment.title} · ${time}` : `${segment.title}（${purpose}） · ${time}`
}

/**
 * Read a tool's one-line purpose out of the schema the header carried.
 * @param schema - JSON text of `{name, description, parameters}`, or null.
 * @returns the trimmed description, or null when there is none.
 */
/**
 * Pretty-print JSON text for the drawer.
 *
 * The fold stores payloads as they arrive — arguments arrive compact, results
 * arrive as the tool printed them. The reference's tabs show indented JSON, so
 * the drawer re-formats: parse when possible, pass through when not (a raw
 * command string is not JSON and must not be mangled).
 * @param text - payload text.
 * @returns indented text, or the input unchanged.
 */
function pretty(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return text
  }
}

/** One token of highlighted JSON: a key, a string, a number, or punctuation. */
interface JsonPart { readonly kind: 'key' | 'str' | 'num' | 'punct' | 'plain', readonly text: string }

/**
 * Split JSON-shaped text into colourable parts for the drawer.
 *
 * The reference colours string values in its 参数 tab; a wall of monochrome JSON
 * reads slower and looks unfinished. This is a single-pass tokenizer, not a
 * renderer — the view maps parts to spans.
 * @param text - payload text (already pretty-printed when it parsed).
 * @returns the parts, in order; plain text yields one part.
 */
function highlightJson(text: string): JsonPart[] {
  const pattern = /("(?:[^"\\]|\\.)*")(:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],:])/g
  const parts: JsonPart[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ kind: 'plain', text: text.slice(last, index) })
    const [whole, quoted, colon, number, punct] = match
    if (quoted !== undefined) parts.push({ kind: colon === ':' ? 'key' : 'str', text: whole })
    else if (number !== undefined) parts.push({ kind: 'num', text: whole })
    else if (punct !== undefined) parts.push({ kind: 'punct', text: whole })
    last = index + whole.length
  }
  if (last < text.length) parts.push({ kind: 'plain', text: text.slice(last) })
  return parts
}

/**
 * Payload as highlighted parts: JSON gets coloured, anything else stays plain.
 * @param text - payload text.
 * @returns parts for rendering.
 */
function payloadParts(text: string): JsonPart[] {
  const formatted = pretty(text)
  const trimmed = formatted.trimStart()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return [{ kind: 'plain', text: formatted }]
  return highlightJson(formatted)
}

function descriptionOf(schema: string | null): string | null {
  if (schema === null) return null
  // Read the description by pattern first: the fold trims long definitions
  // (SCHEMA_TRIM), so a full JSON.parse of a real `bash` schema always fails and
  // every purpose line came out empty — measured live as `调用: bash` with no
  // purpose. The description sits before the parameters blob, so a pattern sees
  // it even in a truncated definition.
  // Terminating quote OR end of string: the fold's SCHEMA_TRIM cut the real bash
  // definition in the middle of its description (measured: indexOf finds no `"`
  // after the value starts), so requiring the closing quote returned null and
  // every long-schema tool lost its purpose line.
  const match = /"description"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/.exec(schema)
  const raw = match?.[1]
  if (raw !== undefined) {
    const text = raw.replace(/\\n/g, ' ').replace(/\\s+/g, ' ').replace(/\\"/g, '"').trim()
    if (text !== '') return text.length > 140 ? `${text.slice(0, 140)}…` : text
  }
  try {
    const parsed: unknown = JSON.parse(schema)
    if (parsed !== null && typeof parsed === 'object') {
      const value = (parsed as Record<string, unknown>)['description']
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
  } catch {
    // Not JSON at all: no description beats a crash.
  }
  return null
}

/**
 * The second line a row carries: a tool's purpose, or the tools an assistant
 * message dispatched in the same step.
 *
 * A row saying only `check_ui_size` tells a reader nothing about what the tool
 * does; a model row quoting only its text hides which tools it reached for. Both
 * answers come from data already on the panel — no new wire field.
 * @param entry - the row.
 * @param siblings - every row of its turn.
 * @param toolSchemas - header schemas keyed by tool name.
 * @param tLabel - locale prefix for the dispatched-tools line.
 * @returns the line, or null when the row needs none.
 */
function secondLineOf(
  entry: LiveTimelineEntry,
  siblings: readonly LiveTimelineEntry[],
  toolSchemas: Readonly<Record<string, string>>,
  tLabel: string,
): string | null {
  if (entry.kind === 'tool') return descriptionOf(toolSchemas[entry.title] ?? null)
  if (entry.kind !== 'assistant') return null
  const called = siblings.filter((row) =>
    row.kind === 'tool'
    && row.turn === entry.turn
    && (row.step === entry.step || row.step === null || entry.step === null))
  if (called.length === 0) return null
  if (called.length === 1) {
    const only = called[0]
    const purpose = only === undefined ? null : descriptionOf(toolSchemas[only.title] ?? null)
    const name = only?.title ?? ''
    return purpose === null ? `${tLabel}${name}` : `${tLabel}${name}（${purpose}）`
  }
  return `${tLabel}${called
    .map((row) => {
      const purpose = descriptionOf(toolSchemas[row.title] ?? null)
      return purpose === null ? row.title : `${row.title}（${purpose}）`
    })
    .join('、')}`
}

/**
 * `YYYY-MM-DD HH:MM:SS.mmm`, local time — the precision the trajectory view's
 * timing panel shows; second resolution hides the very differences timing exists
 * to reveal.
 * @param time - epoch milliseconds.
 * @returns the stamp.
 */
function stampOf(time: number): string {
  const date = new Date(time)
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `.${pad(date.getMilliseconds(), 3)}`
}

/** Elapsed milliseconds as a group-separated integer. */
function millisBetween(from: number, to: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, to - from))
}

/** Wall-clock `HH:MM:SS` in the reader's own timezone. */
function clockOf(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false })
}

/** Whole seconds between two instants, floored at zero. */
function secondsBetween(from: number, to: number): number {
  return Math.max(0, Math.round((to - from) / 1000))
}

/**
 * The session's three lanes over time, drawn the way the built-in 轨迹 view draws
 * them: absolute spans positioned by CSS custom properties inside a track, with
 * 0.5px turn boundaries, and one colour per lane (context gets its own tint, as
 * it does there).
 *
 * The lanes answer a question a list cannot: where the time went. A turn that is
 * all tools, a turn that is all model, and a long context injection are three
 * different shapes at a glance.
 *
 * @param props - the rows to plot, the turns to mark, and the interaction state.
 * @returns the chart.
 */
function LaneChart({ spans, actualDuration, turns, now, selected, range, currentId, toolSchemas, t, onSelect, onRange }: {
  spans: readonly LiveSpan[]
  actualDuration: boolean
  /** The span whose row is open in the drawer — the reference marks it as current. */
  currentId: string | null
  /** Header schemas, so a bar's tooltip can name the tool AND its purpose. */
  toolSchemas: Readonly<Record<string, string>>
  turns: LiveTaskView['turns']
  now: number
  selected: number | null
  range: { from: number, to: number } | null
  t: T
  onSelect: (turn: number) => void
  onRange: (range: { from: number, to: number } | null) => void
}): JSX.Element {
  // Drag selection lives in chart percentages while dragging and in epoch
  // milliseconds once committed, so a re-render during the drag cannot move it.
  const [drag, setDrag] = useState<{ startPct: number, endPct: number } | null>(null)
  // The chart reads the dense segment list, not the twenty-row window: a strip
  // drawn from the retained rows looks empty beside the trajectory view's, which
  // plots every record.
  const plotted = spans
  const starts = plotted.map((segment) => segment.startedAt)
  const ends = plotted.map((segment) => segment.endedAt ?? now)
  const from = starts.length === 0 ? now - 1000 : Math.min(...starts)
  const to = Math.max(now, ...(ends.length === 0 ? [now] : ends))
  const span = Math.max(1000, to - from)
  const at = (time: number): number => ((time - from) / span) * 100
  const laneOf = (kind: LiveTimelineEntry['kind']): number =>
    kind === 'assistant' ? 1 : kind === 'tool' ? 2 : 0

  const minWidth = 560
  // 等宽模式（工具栏 时长 开关）：每轮一个等宽槽，槽内每次调用等宽——这是轨迹另一条轴。
  const turnIndex = new Map(turns.map((turn, index) => [turn.turn, index]))
  const countsPerTurn = new Map<number, number>()
  for (const segment of plotted) countsPerTurn.set(segment.turn, (countsPerTurn.get(segment.turn) ?? 0) + 1)
  const slotCount = Math.max(1, turns.length)
  const pctOfSegment = (segment: LiveSpan): number => {
    if (actualDuration) return at(segment.startedAt)
    const index = turnIndex.get(segment.turn) ?? 0
    const turn = turns[index]
    if (turn === undefined) return 0
    const duration = Math.max(1, (turn.endedAt ?? now) - turn.startedAt)
    const frac = Math.min(1, Math.max(0, (segment.startedAt - turn.startedAt) / duration))
    return ((index + frac) / slotCount) * 100
  }
  const widthOfSegment = (segment: LiveSpan): number => {
    if (actualDuration) return Math.max(0.2, at(segment.endedAt ?? now) - at(segment.startedAt))
    return Math.max(0.2, ((100 / slotCount) / Math.max(1, countsPerTurn.get(segment.turn) ?? 1)) * 0.82)
  }
  const pctOfTime = (time: number): number => {
    if (actualDuration) return at(time)
    let index = 0
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const turn = turns[i]
      if (turn !== undefined && turn.startedAt <= time) { index = i; break }
    }
    const turn = turns[index]
    if (turn === undefined) return 0
    const duration = Math.max(1, (turn.endedAt ?? now) - turn.startedAt)
    const frac = Math.min(1, Math.max(0, (time - turn.startedAt) / duration))
    return ((index + frac) / slotCount) * 100
  }
  const timeOfPct = (pct: number): number => {
    if (actualDuration) return from + (pct / 100) * span
    const index = Math.min(turns.length - 1, Math.max(0, Math.floor((pct / 100) * slotCount)))
    const frac = (pct / 100) * slotCount - index
    const turn = turns[index]
    if (turn === undefined) return from
    const duration = Math.max(1, (turn.endedAt ?? now) - turn.startedAt)
    return turn.startedAt + frac * duration
  }
  return (
    <div className={styles.chartScroll}>
    <div className={styles.chart} style={{ minWidth: `${minWidth}px` }}>
      <div className={styles.chartLabels} aria-hidden="true">
        <span>{t('lane.input')}</span>
        <span>{t('lane.model')}</span>
        <span>{t('lane.tools')}</span>
      </div>
      <div
        className={styles.chartTrack}
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const pct = ((event.clientX - rect.left) / rect.width) * 100
          setDrag({ startPct: pct, endPct: pct })
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (drag === null) return
          const rect = event.currentTarget.getBoundingClientRect()
          const pct = ((event.clientX - rect.left) / rect.width) * 100
          setDrag({ startPct: drag.startPct, endPct: pct })
        }}
        onPointerUp={() => {
          if (drag === null) return
          const lo = Math.min(drag.startPct, drag.endPct)
          const hi = Math.max(drag.startPct, drag.endPct)
          // A click, not a drag: clear the selection instead of selecting a sliver.
          onRange(hi - lo < 1.5 ? null : { from: timeOfPct(lo), to: timeOfPct(hi) })
          setDrag(null)
        }}
      >
        {range !== null && (
          <div
            className={styles.chartSelection}
            style={{ left: `${pctOfTime(range.from)}%`, width: `${Math.max(0.2, pctOfTime(range.to) - pctOfTime(range.from))}%` }}
            aria-hidden="true"
          />
        )}
        {drag !== null && (
          <div
            className={styles.chartSelection}
            data-dragging="true"
            style={{
              left: `${Math.min(drag.startPct, drag.endPct)}%`,
              width: `${Math.max(0.2, Math.abs(drag.endPct - drag.startPct))}%`,
            }}
            aria-hidden="true"
          />
        )}
        <div className={styles.chartLanes}>
          {plotted.map((segment) => (
            <button
              key={segment.id}
              type="button"
              className={styles.span}
              data-kind={segment.kind}
              data-error={segment.status === 'failed'}
              data-selected={selected === null || selected === segment.turn}
              data-current={segment.id === currentId ? 'true' : undefined}
              style={{
                top: `${laneOf(segment.kind) * 14}px`,
                left: `${pctOfSegment(segment)}%`,
                // Equal-width mode draws fixed 8px blocks like the reference's
                // data-equal-duration spans: proportions stop mattering there.
                width: actualDuration ? `max(2px, ${widthOfSegment(segment)}%)` : '8px',
                minWidth: actualDuration ? undefined : '8px',
              }}
              title={spanTitleOf(segment, toolSchemas, t, now)}
              aria-label={spanTitleOf(segment, toolSchemas, t, now)}
              onClick={() => onSelect(segment.turn)}
            />
          ))}
        </div>
        <div className={styles.chartBoundaries} aria-hidden="true">
          {turns.map((turn, index) => (
            <span
              key={turn.turn}
              className={styles.chartBoundary}
              style={{ left: `${actualDuration ? at(turn.startedAt) : (index / slotCount) * 100}%` }}
            />
          ))}
        </div>
      </div>
    </div>
    </div>
  )
}

/** One tool row inside a turn, expandable to its arguments and result. */
function ToolRow({ entry, now, expanded, selected, dim, secondLine, onToggle, t }: {
  entry: LiveTimelineEntry
  now: number
  expanded: boolean
  selected: boolean
  dim: boolean
  /** Purpose (tool rows) or dispatched tools (model rows), under the row. */
  secondLine: string | null
  onToggle: () => void
  t: T
}): JSX.Element {
  const running = entry.status === 'running'
  const failed = entry.status === 'failed'
  const took = secondsBetween(entry.startedAt, entry.endedAt ?? now)
  const kind = entry.kind === 'tool'
    ? t('timeline.tool')
    : entry.kind === 'user'
      ? t('timeline.user')
      : entry.kind === 'context'
        ? t('lane.context')
        : t('timeline.assistant')
  const clock = clockOf(entry.startedAt)

  return (
    <>
      {/* One table row per record, two columns, exactly like the trajectory view:
          the event cell carries the kind chip (right-aligned in a fixed slot) and
          the content cell carries the payload, arrow and inline result. */}
      <tr
        className={styles.row}
        data-kind={entry.kind}
        data-error={failed || undefined}
        data-selected={selected || undefined}
        data-dim={dim || undefined}
        data-lines={secondLine !== null ? '2' : undefined}
      >
        {/* The chip carries the readable kind; the cell names it for a screen
            reader too, which is also what the a11y rule asks for. */}
        <td className={styles.eventCell} aria-label={kind}>
          <span className={styles.kindSlot}>
            <span className={styles.kindTag} data-kind={entry.kind} data-failed={failed}>
              {kind}
            </span>
          </span>
        </td>
        <td className={styles.contentCell}>
          <button type="button" className={styles.rowButton} onClick={onToggle} aria-expanded={expanded}>
            <span className={styles.tlTime}>{clock}</span>
            <span className={styles.tlTitle}>{entry.kind === 'tool' ? entry.title : ''}</span>
            {(entry.entryId ?? null) !== null && <span className={styles.tlEntryId}>{entry.entryId}</span>}
            {entry.kind === 'tool' && argsInline(entry) !== null && (
              <span className={styles.tlArgs} title={argsInline(entry) ?? ''}>
                {argsInline(entry)}
              </span>
            )}
            {entry.kind !== 'tool' && (
              /* An assistant turn that only made tool calls has no text of its
                 own; saying nothing there reads as a rendering bug. */
              <span className={styles.tlDetail} title={entry.detail ?? ''}>
                {entry.detail === null || entry.detail === ''
                  ? t('timeline.toolCallsOnly')
                  : entry.detail}
              </span>
            )}
            {entry.result !== null && (
              <>
                <span className={styles.tlArrow} aria-hidden="true">→</span>
                <span className={styles.tlResult} title={entry.result}>{entry.result}</span>
              </>
            )}
            <span className={failed ? styles.tlTookFailed : styles.tlTook}>
              {(entry.tokens ?? null) !== null && entry.kind === 'assistant'
                ? `${compact(entry.tokens ?? 0)} tok`
                : `${running ? t('status.running') : failed ? t('status.failed') : t('status.ok')} ${t('time.seconds', { s: took })}`}
            </span>
          </button>
          {secondLine !== null && (
            <div className={styles.tlSecond} title={secondLine}>{secondLine}</div>
          )}
        </td>
      </tr>
    </>
  )
}

/**
 * Group a turn's rows by step, the way the trajectory view does.
 *
 * Rows keep their order inside a step; a row without a step number (a message
 * between steps) forms its own group, so nothing is dropped or reordered.
 * @param entries - the turn's rows in order.
 * @returns groups of rows, each labelled with its step or null.
 */
function groupByStep(entries: readonly LiveTimelineEntry[]): { step: number | null, rows: LiveTimelineEntry[] }[] {
  const groups: { step: number | null, rows: LiveTimelineEntry[] }[] = []
  for (const entry of entries) {
    const last = groups.at(-1)
    if (last !== undefined && last.step === entry.step) last.rows.push(entry)
    else groups.push({ step: entry.step, rows: [entry] })
  }
  return groups
}

/**
 * One turn as a table body: a header row, then one row per record.
 *
 * Multiple `tbody` elements in one table are valid HTML, and this keeps the turn
 * boundaries — and the rail that marks them — inside the table, the way the
 * trajectory view draws them.
 */
function TurnSection({ turn, entries, picked, now, open, expandedId, dimmed, toolSchemas, generating, liveText, onToggle, t }: {
  turn: LiveTaskView['turns'][number]
  entries: readonly LiveTimelineEntry[]
  /** True only when the reader picked this turn; the newest turn is not "picked". */
  picked: boolean
  now: number
  open: boolean
  expandedId: string | null
  dimmed: boolean
  toolSchemas: Readonly<Record<string, string>>
  /** The model is mid-generation for this turn's open step (client-derived). */
  generating: boolean
  /** Decoded live text for this turn's open step, when the transport carries it. */
  liveText: string | null
  onToggle: (id: string) => void
  t: T
}): JSX.Element {
  const started = clockOf(turn.startedAt)
  const took = secondsBetween(turn.startedAt, turn.endedAt ?? now)
  return (
    <tbody className={styles.turnBody} data-turn={turn.turn}>
      <tr className={styles.turnRow} data-turn-start="true" data-picked={picked || undefined}>
        <td className={styles.eventCell}>
          <span className={styles.turnRail} aria-hidden="true" />
          <strong className={styles.turnLabel}>{t('timeline.turnN', { n: turn.turn })}</strong>
        </td>
        <td className={styles.contentCell}>
          <span className={styles.turnMeta}>{started}</span>
          <span className={styles.turnMeta}>{t('time.seconds', { s: took })}</span>
          {turn.toolCalls > 0 && <span className={styles.turnMeta}>{t('turn.tools', { n: turn.toolCalls })}</span>}
          {(turn.tokens ?? 0) > 0 && (
            <span className={styles.turnMeta}>{t('usage.turn', { t: compact(turn.tokens ?? 0) })}</span>
          )}
          {turn.failures > 0 && <span className={styles.tlTookFailed}>{t('turn.failed', { n: turn.failures })}</span>}
        </td>
      </tr>

      {generating && (
        <tr className={styles.generatingRow}>
          <td className={styles.eventCell} aria-label={t('level.assistant')}>
            <span className={styles.kindSlot}>
              <span className={styles.kindTag} data-kind="assistant">{t('timeline.assistant')}</span>
            </span>
          </td>
          <td className={styles.contentCell}>
            <span className={styles.tlGen} title={liveText ?? undefined}>
              {liveText ?? t('gen.running')}
            </span>
          </td>
        </tr>
      )}
      {!open
        ? null
        : entries.length === 0
        ? (
            <tr>
              <td className={styles.eventCell} aria-hidden="true" />
              <td className={styles.contentCell}>
                {/* A turn can have calls that the bounded timeline no longer
                    carries: saying "no tool calls" there would be false (a turn
                    with 103 calls once read as empty). The counter decides which
                    sentence is true. */}
                <span className={styles.none}>
                  {turn.toolCalls > 0 ? t('turn.windowOnly', { n: TIMELINE_LIMIT }) : t('turn.empty')}
                </span>
              </td>
            </tr>
          )
        : groupByStep(entries).map((group, index) => (
          <Fragment key={`${group.step ?? 'none'}-${index}`}>
            {group.step !== null && (
              <tr className={styles.stepRow}>
                <td className={styles.eventCell} aria-hidden="true" />
                <td className={styles.contentCell}>
                  <span className={styles.stepLabel}>{t('turn.stepN', { n: group.step })}</span>
                </td>
              </tr>
            )}
            {group.rows.map((entry) => (
              <ToolRow
                key={entry.id}
                entry={entry}
                secondLine={secondLineOf(entry, group.rows, toolSchemas, t('row.called'))}
                now={now}
                expanded={expandedId === entry.id}
                selected={expandedId === entry.id}
                dim={dimmed}
                onToggle={() => onToggle(entry.id)}
                t={t}
              />
            ))}
          </Fragment>
        ))}
    </tbody>
  )
}


/**
 * The row detail as a right-hand drawer, the way the trajectory view shows one.
 *
 * Tabs, a 42px header and a scrolling body — an inline block under the row pushed
 * every later row down and could not be compared side by side with the row it
 * described.
 */
function DetailDrawer({ entry, now, schema, model, provider, loadPluginInfo, onClose, t }: {
  entry: LiveTimelineEntry
  now: number
  /** The definition this tool was registered with, from the request header. */
  schema: string | null
  /**
   * Look up which bundle registers a tool, via the same remote the built-in
   * plugin manager page calls. Absent in the offline preview.
   */
  loadPluginInfo?: (toolName: string) => Promise<PluginInfoCard | null>
  /** Model/provider of the request that drove this row (the caller identity). */
  model: string | null
  provider: string | null
  onClose: () => void
  t: T
}): JSX.Element {
  const [tab, setTab] = useState<'overview' | 'args' | 'result' | 'schema' | 'timing'>('overview')
  // The reference's 概览 tab stacks four collapsible sections under 层级/状态;
  // closed by default, exactly as it opens.
  const [open, setOpen] = useState<{ args: boolean, result: boolean, schema: boolean, timing: boolean }>({ args: false, result: false, schema: false, timing: false })
  // 插件信息：点 插件 ID 才去远端取（内置插件页同一 remote），按需加载。
  const [pluginCard, setPluginCard] = useState<PluginInfoCard | null>(null)
  const [pluginOpen, setPluginOpen] = useState(false)
  const [pluginLoading, setPluginLoading] = useState(false)
  const running = entry.status === 'running'
  const failed = entry.status === 'failed'
  const kind = entry.kind === 'tool'
    ? t('timeline.tool')
    : entry.kind === 'user'
      ? t('timeline.user')
      : entry.kind === 'context'
        ? t('lane.context')
        : t('timeline.assistant')
  const timingBody = (
        <dl className={styles.detailGrid}>
          <dt>{t('timing.started')}</dt><dd className={styles.detailMono}>{stampOf(entry.startedAt)}</dd>
          <dt>{t('timing.duration')}</dt>
          <dd>{millisBetween(entry.startedAt, entry.endedAt ?? now)} {t('timing.ms')}</dd>
          <dt>{t('timing.ended')}</dt>
          <dd className={styles.detailMono}>
            {entry.endedAt === null ? t('status.running') : stampOf(entry.endedAt)}
          </dd>
          <dt>{t('timing.source')}</dt><dd>{t('timing.sourceSession')}</dd>
        </dl>
      )
  /**
   * Render payload text: JSON is pretty-printed and colour-tokenised the way the
   * reference's 参数 tab does; anything else passes through as plain monospace.
   * @param text - the payload.
   * @param key - React key prefix.
   * @returns the formatted block.
   */
  const payloadEl = (text: string, key: string): JSX.Element => (
    <pre className={styles.detailPre}>
      {payloadParts(text).map((part, index) => (
        <span key={`${key}-${index}`} className={styles[part.kind === 'plain' ? 'jPlain' : part.kind === 'key' ? 'jKey' : part.kind === 'str' ? 'jStr' : part.kind === 'num' ? 'jNum' : 'jPunct']}>
          {part.text}
        </span>
      ))}
    </pre>
  )
  const argsBody = payloadEl(entry.argsFull ?? entry.detail ?? t('detail.none'), 'args')
  const resultBody = entry.status === 'running'
    ? <p className={styles.none}>{t('detail.pending')}</p>
    : payloadEl(entry.resultFull ?? entry.result ?? t('detail.none'), 'res')
  const schemaBody = schema === null
    ? <p className={styles.none}>{t('detail.schemaUnavailable')}</p>
    : payloadEl(schema, 'schema')
  /** One collapsible row of the 概览 tab, closed the way the reference opens it. */
  const section = (id: 'args' | 'result' | 'schema' | 'timing', label: string, body: JSX.Element): JSX.Element => (
    <div className={styles.sectionBlock}>
      <button
        type="button"
        className={styles.sectionToggle}
        aria-expanded={open[id]}
        onClick={() => setOpen((state) => ({ ...state, [id]: !state[id] }))}
      >
        <span className={open[id] ? styles.sectionChevronDown : styles.sectionChevron} aria-hidden="true">›</span>
        {label}
      </button>
      {open[id] && <div className={styles.sectionPanel}>{body}</div>}
    </div>
  )
  const levelText = entry.kind === 'tool'
    ? t('level.tool')
    : entry.kind === 'user'
      ? t('level.user')
      : entry.kind === 'context'
        ? t('lane.context')
        : t('level.assistant')
  const tabs: readonly { id: typeof tab, label: string, body: JSX.Element }[] = [
    {
      id: 'overview',
      label: t('detail.overview'),
      body: (
        <>
          <dl className={styles.detailGrid}>
            <dt>{t('detail.hierarchy')}</dt>
            <dd>{levelText} ›</dd>
            <dt>{entry.kind === 'tool' ? t('overview.callee') : t('detail.name')}</dt>
            <dd>{entry.kind === 'tool'
              ? entry.title
              : entry.kind === 'assistant' && (entry.model ?? null) !== null
                ? `${entry.model}${provider !== null ? ` · ${provider}` : ''}`
                : kind}</dd>
            {entry.kind === 'tool' && (model ?? null) !== null && (
              <>
                <dt>{t('overview.caller')}</dt>
                <dd className={styles.detailMono}>
                  {`${model}${provider !== null ? ` · ${provider}` : ''}`}
                </dd>
              </>
            )}
            {(entry.tokens ?? null) !== null && entry.kind === 'assistant' && (
              <>
                <dt>{t('overview.tokens')}</dt>
                <dd>{`${compact(entry.tokens ?? 0)} tok`}</dd>
              </>
            )}
            {(entry.entryId ?? null) !== null && (
              <>
                <dt>{t('detail.entryId')}</dt>
                <dd>
                  <button
                    type="button"
                    className={styles.pluginLink}
                    onClick={() => {
                      setPluginOpen((value) => !value)
                      if (entry.kind !== 'tool' || loadPluginInfo === undefined) return
                      if (pluginCard !== null || pluginLoading) return
                      setPluginLoading(true)
                      void loadPluginInfo(entry.title).then((card) => {
                        setPluginCard(card)
                        setPluginLoading(false)
                      })
                    }}
                  >
                    {entry.entryId}
                  </button>
                </dd>
              </>
            )}
            {descriptionOf(schema) !== null && (
              <>
                <dt>{t('detail.purpose')}</dt>
                <dd>{descriptionOf(schema)}</dd>
              </>
            )}
            {entry.kind === 'tool' && (
              <>
                <dt>{t('overview.status')}</dt>
                <dd>{running ? t('status.running') : failed ? t('status.failed') : t('status.ok')}</dd>
              </>
            )}
            {entry.turn !== null && (
              <>
                <dt>{t('overview.at')}</dt>
                <dd>{entry.step === null
                  ? `#${entry.turn}`
                  : t('overview.atValue', { turn: entry.turn, step: entry.step })}</dd>
              </>
            )}
          </dl>
          {pluginOpen && (
            <div className={styles.pluginCard}>
              <dl className={styles.detailGrid}>
                <dt>{t('detail.package')}</dt>
                <dd className={styles.detailMono}>
                  {pluginLoading ? t('detail.loading') : (pluginCard?.pkg ?? t('detail.unavailable'))}
                </dd>
                {pluginCard !== null && pluginCard.version !== null && (
                  <>
                    <dt>{t('detail.version')}</dt>
                    <dd className={styles.detailMono}>{pluginCard.version}</dd>
                  </>
                )}
                {pluginCard !== null && (
                  <>
                    <dt>{t('detail.entry')}</dt>
                    <dd className={styles.detailMono}>{pluginCard.entryId}</dd>
                    <dt>{t('overview.status')}</dt>
                    <dd>{pluginCard.enabled ? t('detail.enabled') : t('detail.disabled')}</dd>
                    {pluginCard.description !== null && (
                      <>
                        <dt>{t('detail.purpose')}</dt>
                        <dd>{pluginCard.description}</dd>
                      </>
                    )}
                  </>
                )}
              </dl>
            </div>
          )}
          {section('args', t('turn.args'), argsBody)}
          {section('result', t('turn.result'), resultBody)}
          {section('schema', t('detail.schema'), schemaBody)}
          {section('timing', t('detail.timing'), timingBody)}
        </>
      ),
    },
    { id: 'args', label: t('turn.args'), body: argsBody },
    { id: 'result', label: t('turn.result'), body: resultBody },
    { id: 'schema', label: t('detail.schema'), body: schemaBody },
    { id: 'timing', label: t('detail.timing'), body: timingBody },
  ]
  const active = tabs.find((item) => item.id === tab) ?? tabs[0]

  return (
    <aside className={styles.details}>
      <header className={styles.detailsHeader}>
        <span className={styles.detailsTitle}>
          <span className={styles.kindTag} data-kind={entry.kind} data-failed={failed}>{kind}</span>
          <strong className={styles.detailsName}>{entry.kind === 'tool' ? entry.title : kind}</strong>
        </span>
        <span className={styles.detailsLocation}>{entry.entryId ?? ''}</span>
        <button type="button" className={styles.detailsClose} onClick={onClose} aria-label={t('detail.close')}>
          ×
        </button>
      </header>
      <div className={styles.detailTabs} role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === tab}
            className={item.id === tab ? styles.detailTabActive : styles.detailTab}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className={styles.detailBody}>{active?.body}</div>
    </aside>
  )
}

/**
 * Render the live task view for the current session.
 * @param props - projection hook and translator from the slot kit.
 * @returns the view body, or an explicit empty state.
 */
/**
 * Union two turn-summary lists by turn number.
 *
 * The host folds the whole log, so its summaries are complete; the archive's
 * window may hold turns the host window slid away (and vice versa on sessions
 * past the host's turn cap). Paging must not make headers vanish: taking the
 * archive wholesale once it wins on rows dropped the panel from 85 headers to 9
 * live, because only the turns whose events are resident had summaries.
 * @param host - the host projection's summaries, when present.
 * @param archive - the client archive's summaries.
 * @returns one list, host entries winning on conflict.
 */
function mergeTurns(
  host: readonly LiveTurnSummary[] | undefined,
  archive: readonly LiveTurnSummary[],
): readonly LiveTurnSummary[] {
  if (host === undefined || host.length === 0) return archive
  const byTurn = new Map<number, LiveTurnSummary>()
  for (const summary of host) byTurn.set(summary.turn, summary)
  for (const summary of archive) if (!byTurn.has(summary.turn)) byTurn.set(summary.turn, summary)
  return [...byTurn.values()].sort((left, right) => left.turn - right.turn)
}

/**
 * The shared display state behind both registered views: the host projection,
 * the client-side archive fold, the paging flags, the live stream, and the
 * session's tool roster. Extracted so 活动 and the 运行状况 tab read the same
 * numbers instead of drifting a second copy.
 * @param props - the projection/session/list sources both views already receive.
 * @returns the display state plus the roster the status tab reports.
 */
function useLiveTaskDisplay({
  useProjection,
  useSession,
  eventSource,
  listToolBundles,
}: Pick<LiveTasksViewProps, 'useProjection' | 'useSession' | 'eventSource' | 'listToolBundles'>) {
  const projected = useProjection('liveTask') as LiveTaskView | undefined
  /**
   * The client-side archive: the whole session folded from the resident event
   * window in browser memory.
   *
   * This is the paging path the reference view takes through `session.loadOlder()`:
   * the window prepends older pages, and the same reducer that drives the host
   * projection runs here unbounded (`CLIENT_WINDOWS`) — every row, turn and span
   * the window holds, with no wire cost. The host projection stays as the
   * fallback (preview fixture, or a session whose window has not opened yet).
   */
  const subscribe = useMemo(
    () => (eventSource === undefined ? () => () => {} : (listener: () => void) => eventSource.subscribe(listener)),
    [eventSource],
  )
  const readWindow = useMemo(() => () => eventSource?.getSnapshot() ?? null, [eventSource])
  const windowSnapshot = useSyncExternalStore(subscribe, readWindow, readWindow)
  const hasOlder = useSession((snapshot) => snapshot.hasMore)
  const loadingOlder = useSession((snapshot) => snapshot.loadingOlder)
  const archive = useMemo(() => {
    if (windowSnapshot === null) return null
    const cached = eventSource === undefined ? undefined : ARCHIVE_CACHE.get(eventSource)
    const cache = cached?.packed ?? null
    // Live appends fold incrementally — one event, not a whole-window replay —
    // because a full refold inside render scales with the session (Codex review
    // P2). Prepends (paging), replaces and settlements refold whole: older events
    // cannot be folded after newer ones.
    if (eventSource !== undefined
      && cached !== undefined
      && cache !== null
      && cached.revision + 1 === windowSnapshot.revision
      && windowSnapshot.change.kind === 'append') {
      const next = foldWindow(cache.state, windowSnapshot.change.entries, cache.stream)
      ARCHIVE_CACHE.set(eventSource, { revision: windowSnapshot.revision, packed: next })
      return next
    }
    const fresh = foldWindow(INITIAL_LIVE_TASK_STATE, windowSnapshot.entries, null)
    if (eventSource !== undefined) {
      ARCHIVE_CACHE.set(eventSource, { revision: windowSnapshot.revision, packed: fresh })
    }
    return fresh
  }, [windowSnapshot, eventSource])
  /**
   * Tolerate a host running an older build than this bundle.
   *
   * The browser half and the host half are versioned separately: a page refresh
   * can pair a newer client with the host that is still running, and reading a
   * field the host does not send threw — React then unmounted the view and the
   * panel went blank. Missing fields fall back here, so the worst case is a
   * missing line instead of an empty page. `--stale-host` in
   * `scripts/panel-preview.mjs` renders exactly that pairing.
   */
  const hostState = projected === undefined
    ? undefined
    : {
        ...projected,
        turnsTotal: projected.turnsTotal ?? projected.turns.length,
        usage: projected.usage
          ?? { reported: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0, total: 0 },
        spans: projected.spans ?? [],
        // An older host (and the preview fixture) has no schema map; without this
        // default the drawer threw `undefined[…]` on the first row click and React
        // unmounted the whole view — the panel collapsed to a zero-height box.
        toolSchemas: projected.toolSchemas ?? {},
        model: projected.model ?? null,
        provider: projected.provider ?? null,
      }
  /**
   * Display state: the archive (whole session, browser-side) when it has rows,
   * otherwise the normalized host projection.
   *
   * Scalars prefer whichever side actually carries them: a freshly paged window
   * may predate this session's `request/header` (no tool count), while an older
   * host may lack fields this bundle knows. Neither gap is allowed to blank the
   * panel — both sides already degrade per field.
   */
  // The archive takes over only once it carries at least as many rows as the
  // host window it replaces: a fresh window can be *shorter* than the projection's
  // 384-row cap, and switching then would look like history disappearing. After
  // one page-back it always wins — and grows without bound as pages load.
  // Codex review P1: session-wide counters prefer the host while pages are still
  // loading. The host replays the whole log; a partial window has not seen the
  // old failures and usage yet, and counters dropping mid-paging read as data
  // loss. Rows still come from the archive — that is what paging is for — and
  // once `hasMore` clears both sides describe the same events.
  const fullyPaged = windowSnapshot !== null && !windowSnapshot.hasMore
  const liveStream = archive === null ? null : archive.stream
  const archiveState = archive === null ? null : archive.state
  const withCounters = archiveState === null
    ? null
    : hostState === undefined || fullyPaged
      ? archiveState
      : {
          ...archiveState,
          turnsTotal: hostState.turnsTotal,
          failuresTotal: hostState.failuresTotal,
          toolCallsTotal: hostState.toolCallsTotal,
          toolsAvailable: archiveState.toolsAvailable ?? hostState.toolsAvailable,
          usage: hostState.usage.reported > 0 ? hostState.usage : archiveState.usage,
          health: hostState.health.folded >= archiveState.health.folded ? hostState.health : archiveState.health,
        }
  const state = withCounters !== null
    && withCounters.timeline.length > 0
    && withCounters.timeline.length >= (hostState?.timeline.length ?? 0)
    ? {
        ...withCounters,
        turns: mergeTurns(hostState?.turns, withCounters.turns),
        toolsAvailable: withCounters.toolsAvailable ?? hostState?.toolsAvailable ?? null,
        usage: withCounters.usage.reported > 0
          ? withCounters.usage
          : hostState?.usage ?? withCounters.usage,
        // No empty-object fallback: CI flags `?? {}` inside a spread as
        // unnecessary — seed from whichever side exists, archive still wins.
        toolSchemas: { ...(hostState?.toolSchemas ?? withCounters.toolSchemas), ...withCounters.toolSchemas },
      }
    : hostState
  // 全会话（含已分页）用过的工具名单，不再只数最近动作：回答"这次会话到底触发过哪些"。
  const usedToolNames = [...new Set([
    ...(state?.turns ?? []).flatMap((turn) => turn.tools),
    ...(state?.openTools ?? []).map((tool) => tool.name),
    ...(state?.lastTool == null ? [] : [state.lastTool.name]),
    ...(state?.actions ?? []).map((action) => action.name),
  ])]
  const distinctTools = usedToolNames.length
  // 咱们自己的工具名单（包名 soia- 开头的 bundle 注册的工具）；拿不到就退回全量。
  const [ourToolNames, setOurToolNames] = useState<ReadonlySet<string> | null>(null)
  useEffect(() => {
    if (listToolBundles === undefined) return
    let alive = true
    void listToolBundles().then((rows) => {
      if (!alive) return
      const ours = new Set(rows.filter((row) => row.pkg.startsWith('soia-')).map((row) => row.tool))
      setOurToolNames(ours)
    }).catch(() => undefined)
    return () => { alive = false }
  }, [listToolBundles])
  return { state, hasOlder, loadingOlder, liveStream, usedToolNames, distinctTools, ourToolNames }
}

/**
 * The 运行状况 tab: the panel's own telemetry gets its own seat, so the timeline
 * stays a timeline. Everything the old bottom block reported lives here in full
 * — session totals, the tool roster (our packages first), usage, freshness, and
 * the fold's internal counters — without competing for the activity view's space.
 * @param props - the same standard kit and injected sources as the activity view.
 * @returns the telemetry panel, or the shared empty state.
 */
export function LiveStatusView({ useProjection, t, useSession, eventSource, listToolBundles }: LiveTasksViewProps): JSX.Element {
  const { state, usedToolNames, distinctTools, ourToolNames } = useLiveTaskDisplay(
    { useProjection, useSession, eventSource, listToolBundles },
  )
  const now = useNow()
  if (state === undefined || !hasLiveActivity(state)) {
    return (
      <div className={styles.empty}>
        <StateDot state="idle" />
        <span>{t('view.empty')}</span>
      </div>
    )
  }
  const lastDataAt = Math.max(state.updatedAt ?? 0, state.streamedAt ?? 0)
  const silentSeconds = lastDataAt === 0 ? 0 : secondsBetween(lastDataAt, now)
  const oursOnly = ourToolNames !== null && usedToolNames.some((name) => ourToolNames.has(name))
  const rosterShown = oursOnly
    ? usedToolNames.filter((name) => ourToolNames?.has(name) ?? false)
    : usedToolNames
  return (
    <div className={styles.view}>
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>{t('health.title')}</h4>
        <div className={styles.health}>
              <span>{`${t('health.folded')} ${state.health.folded}`}</span>
          <span>{`${t('health.ignored')} ${state.health.ignored}`}</span>
          <span className={state.health.unknown > 0 ? styles.healthStale : undefined}>
            {`${t('health.unknown')} ${state.health.unknown}`}
          </span>
          <span>{`${t('health.frames')} ${state.health.frames}`}</span>
          <span className={state.health.registry < 0 ? styles.healthStale : undefined}>
            {`${t('health.agents')} ${state.health.agents} / ${t('health.registry')} ${
              state.health.registry < 0 ? t('health.unreachable') : state.health.registry}`}
          </span>
              <span>{t('health.deltasValue', { ok: state.health.deltasAccepted, dropped: state.health.deltasDropped })}</span>
          {/* The header lines moved here: the drawer names tools and rows carry
              per-call tokens, so the redundant header went — but the session
              telemetry the operator asked for stays, now beside the other
              counters where a stale panel is judged. */}
          <span title={usedToolNames.join('、')}>{t('axis.summary', {
            turns: state.turnsTotal,
            calls: state.toolCallsTotal,
            failures: state.failuresTotal,
            tools: state.toolsAvailable ?? '—',
            used: distinctTools,
          })}</span>
          {rosterShown.length > 0 && (
            <span title={usedToolNames.join('、')}>
              {t('health.tools', {
                list: rosterShown.slice(0, 4).join('、')
                  + (rosterShown.length > 4 ? '…' : ''),
              })}
            </span>
          )}
          <span>{state.usage.reported === 0
            ? t('usage.unknown')
            : t('usage.line', {
                total: compact(state.usage.total),
                input: compact(state.usage.input),
                output: compact(state.usage.output),
                cache: compact(state.usage.cacheRead),
                pct: state.usage.cacheRead + state.usage.input === 0
                  ? 0
                  : Math.round((state.usage.cacheRead / (state.usage.cacheRead + state.usage.input)) * 100),
              })}</span>
          <span className={silentSeconds > 60 && state.running ? styles.healthStale : undefined}>
            {silentSeconds > 60 && state.running
              ? t('health.stale', { s: silentSeconds })
              : `${t('health.lastData')} ${t('health.silence', { s: silentSeconds })}`}
          </span>
        </div>
      </section>
    </div>
  )
}

export function LiveTasksView({ useProjection, t, useSession, eventSource, loadOlder, loadPluginInfo, listToolBundles }: LiveTasksViewProps): JSX.Element {
  const { state, hasOlder, loadingOlder, liveStream } = useLiveTaskDisplay(
    { useProjection, useSession, eventSource, listToolBundles },
  )
  const [selected, setSelected] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  // 轨迹工具栏的 调用 按钮：收起消息行，只留轮次/步骤/调用（对应它的折叠助手块）。
  const [messagesHidden, setMessagesHidden] = useState(false)
  // 轨迹的 时长 开关：等宽槽位 vs 实际时长（其隐藏的 实际时间 开关这里保持可见语义：行始终挂钟）。
  const [actualDuration, setActualDuration] = useState(true)
  const [failedOnly, setFailedOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [turnsOpen, setTurnsOpen] = useState(true)
  const [range, setRange] = useState<{ from: number, to: number } | null>(null)
  const now = useNow()

  if (state === undefined || !hasLiveActivity(state)) {
    return (
      <div className={styles.empty}>
        <StateDot state="idle" />
        <span>{t('view.empty')}</span>
      </div>
    )
  }

  const inFlight = state.openTools.length > 0
  const settled = state.endedReason !== null && !state.running
  const phase = inFlight
    ? t('phase.tool')
    : state.running
      ? t('phase.running')
      : settled
        ? t('phase.ended')
        : t('phase.idle')
  const selectedTurn = state.turns.at(-1)?.turn ?? null
  const shownTurn = selected ?? selectedTurn
  // `selected` is the reader's choice; `shownTurn` falls back to the newest turn so
  // the chart always shows something. Only the choice highlights rows — tinting a
  // row just because it is the latest is an invention the trajectory view does not
  // have, and it made the table look permanently selected.
  const pickedTurn = selected
  const needle = query.trim().toLowerCase()
  // Every row of the turn, not only its tool calls: a turn reads as one story —
  // your message, the model's reply, the calls in between — which is exactly how
  // the built-in 轨迹 view presents it.
  const entriesOfTurn = (turn: number): readonly LiveTimelineEntry[] =>
    state.timeline.filter((entry) => entry.turn === turn && entry.kind !== 'turn')
      // 调用 按钮收起消息行，只留轮次/步骤/调用（对应轨迹折叠助手块的效果）。
      .filter((entry) => !messagesHidden || entry.kind === 'tool')
      .filter((entry) => !failedOnly || entry.status === 'failed')
      .filter((entry) => needle === ''
        || entry.title.toLowerCase().includes(needle)
        // 插件 ID 也能搜：`tool-check` 直接命中我们的行。
        || (entry.entryId ?? '').toLowerCase().includes(needle)
        || (entry.detail ?? '').toLowerCase().includes(needle)
        || (entry.result ?? '').toLowerCase().includes(needle))
      // A dragged range is a filter, exactly as in the trajectory view.
      .filter((entry) => range === null
        || ((entry.endedAt ?? entry.startedAt) >= range.from && entry.startedAt <= range.to))

  const detailEntry = state.timeline.find((entry) => entry.id === expanded) ?? null

  return (
    <div className={styles.view}>
      <div className={styles.panes}>
        <div className={styles.paneMain}>
      <header className={styles.head}>
        <StateDot state={inFlight || state.running ? 'ongoing' : settled ? 'done' : 'idle'} />
        <Tag tone={settled ? 'success' : 'info'}>{phase}</Tag>
        <span className={styles.elapsed}>
          {state.running ? t('time.seconds', { s: secondsBetween(state.updatedAt ?? now, now) }) : ''}
        </span>
      </header>

      {/* Toolbar copied from the trajectory view: a duration switch, the turns and
          calls actions with their icons, and the search pinned to the right. */}
      <div className={styles.bar} role="toolbar" aria-label={t('bar.aria')}>
        <button
          type="button"
          role="switch"
          aria-checked={actualDuration}
          aria-label={t('bar.durationMode')}
          className={styles.control}
          title={actualDuration ? t('bar.useActual') : t('bar.useEqual')}
          onClick={() => setActualDuration(!actualDuration)}
        >
          <svg className={styles.toggleIcon} viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="5.25" />
            <path d="M8 4.75V8l2.25 1.5" />
          </svg>
          {t('bar.durationMode')}
        </button>
        <button
          type="button"
          className={styles.action}
          aria-pressed={!turnsOpen}
          aria-label={!turnsOpen ? t('bar.expandTurns') : t('bar.collapseTurns')}
          title={!turnsOpen ? t('bar.expandTurns') : t('bar.collapseTurns')}
          onClick={() => setTurnsOpen(!turnsOpen)}
        >
          <span className={styles.actionIcon} aria-hidden="true">{!turnsOpen ? '⊞' : '⊟'}</span>
          {t('bar.turnsMode')}
        </button>
        <button
          type="button"
          className={styles.action}
          aria-pressed={messagesHidden}
          aria-label={messagesHidden ? t('bar.expandCalls') : t('bar.collapseCalls')}
          title={messagesHidden ? t('bar.expandCalls') : t('bar.collapseCalls')}
          onClick={() => setMessagesHidden(!messagesHidden)}
        >
          <span className={styles.actionIcon} aria-hidden="true">{messagesHidden ? '⊞' : '⊟'}</span>
          {t('bar.callsMode')}
        </button>
        <button
          type="button"
          className={failedOnly ? styles.actionOn : styles.action}
          aria-pressed={failedOnly}
          onClick={() => setFailedOnly(!failedOnly)}
        >
          {t('bar.failedOnly')}
        </button>
        {range !== null && (
          <button type="button" className={styles.action} onClick={() => setRange(null)}>
            {t('bar.clearRange')}
          </button>
        )}
        <div className={styles.search}>
          <input
            className={styles.searchInput}
            type="search"
            aria-label={t('bar.search')}
            placeholder={t('bar.searchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {/* The strip lives INSIDE the scrolling pane, pinned on top: one horizontal
          scroll box now moves the chart and the rows together (they used to be two
          scroll contexts, so a narrow window slid them apart), and the strip stays
          visible while the rows scroll vertically. */}
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>
          {state.turnsTotal > state.turns.length
            ? t('axis.titleWindow', { total: state.turnsTotal, shown: state.turns.length })
            : t('axis.title')}
        </h4>
        <div className={styles.tablePane}>
          <div className={styles.chartSticky}>
            <LaneChart
          spans={state.spans}
          actualDuration={actualDuration}
          turns={state.turns}
          now={now}
          selected={shownTurn}
          range={range}
          t={t}
          onSelect={setSelected}
          onRange={setRange}
              currentId={detailEntry?.id ?? null}
              toolSchemas={state.toolSchemas}
            />
          </div>

          <h4 className={styles.sectionTitle}>{t('timeline.title')}</h4>
          {(hasOlder || loadingOlder) && (
            <div className={styles.historyRow}>
              <button
                type="button"
                className={styles.historyButton}
                disabled={loadingOlder}
                onClick={() => { void loadOlder?.() }}
              >
                {loadingOlder ? t('history.loadingEarlier') : t('history.loadEarlier')}
              </button>
            </div>
          )}
          <table className={styles.table}>
            <colgroup>
              <col className={styles.eventColumn} />
              <col className={styles.contentColumn} />
            </colgroup>
            {[...state.turns].reverse().map((turn) => (
              <TurnSection
                key={turn.turn}
                turn={turn}
                entries={entriesOfTurn(turn.turn)}
                picked={pickedTurn !== null && turn.turn === pickedTurn}
                now={now}
                open={turnsOpen}
                expandedId={expanded}
                dimmed={pickedTurn !== null && turn.turn !== pickedTurn}
                toolSchemas={state.toolSchemas}
                liveText={liveStream !== null && liveStream.turn === turn.turn
                  ? (liveStream.text !== ''
                    ? liveStream.text
                    : liveStream.reasoning !== '' ? t('gen.reasoning') : null)
                  : null}
                generating={
                  state.running
                  && state.openTools.length === 0
                  && turn.turn === state.turn
                  && state.step !== null
                  && !state.timeline.some((row) =>
                    row.kind === 'assistant' && row.turn === turn.turn && row.step === state.step)
                }
                onToggle={(id) => setExpanded(expanded === id ? null : id)}
                t={t}
              />
            ))}
          </table>
        </div>
      </section>

        </div>
        {detailEntry !== null && (
          <DetailDrawer
            entry={detailEntry}
            now={now}
            schema={detailEntry.kind === 'tool'
              ? state.toolSchemas[detailEntry.title] ?? null
              : null}
            model={state.model ?? null}
            provider={state.provider ?? null}
            loadPluginInfo={loadPluginInfo}
            onClose={() => setExpanded(null)}
            t={t}
          />
        )}
      </div>
    </div>
  )
}
