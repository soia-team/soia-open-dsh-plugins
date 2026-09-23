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
import type { LiveSpan, LiveTaskView, LiveTimelineEntry } from '../shared/types.ts'
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
}

/** The window snapshot shape the view consumes — declared structurally so the
 *  browser bundle does not need a type-only import from the host SDK. */
interface SessionWindowLike {
  readonly entries: readonly ({ readonly type: 'event', readonly event: unknown } | { readonly type: 'transient', readonly event: unknown })[]
  readonly hasMore: boolean
  readonly revision: number
}

/** Observable face of one session's resident event window. */
export interface SessionEventSourceLike {
  subscribe(listener: () => void): () => void
  getSnapshot(): SessionWindowLike
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
              {entry.kind !== 'tool'
                ? ''
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
function TurnSection({ turn, entries, picked, now, open, expandedId, dimmed, toolSchemas, generating, onToggle, t }: {
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
            <span className={styles.tlGen}>{t('gen.running')}</span>
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
function DetailDrawer({ entry, now, schema, onClose, t }: {
  entry: LiveTimelineEntry
  now: number
  /** The definition this tool was registered with, from the request header. */
  schema: string | null
  onClose: () => void
  t: T
}): JSX.Element {
  const [tab, setTab] = useState<'overview' | 'args' | 'result' | 'schema' | 'timing'>('overview')
  // The reference's 概览 tab stacks four collapsible sections under 层级/状态;
  // closed by default, exactly as it opens.
  const [open, setOpen] = useState<{ args: boolean, result: boolean, schema: boolean, timing: boolean }>({ args: false, result: false, schema: false, timing: false })
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
            <dt>{t('detail.name')}</dt>
            <dd>{entry.kind === 'tool' ? entry.title : kind}</dd>
            {(entry.entryId ?? null) !== null && (
              <>
                <dt>{t('detail.entryId')}</dt>
                <dd className={styles.detailMono}>{entry.entryId}</dd>
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
export function LiveTasksView({ useProjection, t, useSession, eventSource, loadOlder }: LiveTasksViewProps): JSX.Element {
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
    let folded = INITIAL_LIVE_TASK_STATE
    for (const entry of windowSnapshot.entries) {
      if (entry.type !== 'event') continue
      folded = reduceLiveTask(folded, { kind: 'event', event: entry.event } as never, CLIENT_WINDOWS)
    }
    return folded
  }, [windowSnapshot])
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
  const state = archive !== null
    && archive.timeline.length > 0
    && archive.timeline.length >= (hostState?.timeline.length ?? 0)
    ? {
        ...archive,
        toolsAvailable: archive.toolsAvailable ?? hostState?.toolsAvailable ?? null,
        usage: archive.usage.reported > 0
          ? archive.usage
          : hostState?.usage ?? archive.usage,
        toolSchemas: { ...(hostState?.toolSchemas ?? {}), ...archive.toolSchemas },
      }
    : hostState
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
  const distinctTools = new Set(state.actions.map((action) => action.name)).size
  const lastDataAt = Math.max(state.updatedAt ?? 0, state.streamedAt ?? 0)
  const silentSeconds = lastDataAt === 0 ? 0 : secondsBetween(lastDataAt, now)
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

      {/* Which tool is in use, readable without scanning the timeline. */}
      <p className={styles.toolLine}>
        <span className={styles.toolLineLabel}>
          {inFlight ? t('head.toolRunning') : t('head.toolLast')}
        </span>
        <span className={styles.toolLineValue}>
          {inFlight
            ? state.openTools.map((call) => call.name).join(', ')
            : state.actions.at(-1)?.name ?? t('head.toolNone')}
        </span>
      </p>

      <p className={styles.summaryLine}>
        {t('axis.summary', {
          turns: state.turnsTotal,
          calls: state.toolCallsTotal,
          failures: state.failuresTotal,
          tools: state.toolsAvailable ?? '—',
          used: distinctTools,
        })}
      </p>

      {/* Token telemetry: the host records usage per assistant message, and this
          is the only surface where a reader can see what the session has cost. */}
      <p className={styles.usageLine}>
        {state.usage.reported === 0
          ? t('usage.unknown')
          : t('usage.line', {
              total: compact(state.usage.total),
              input: compact(state.usage.input),
              output: compact(state.usage.output),
              cache: compact(state.usage.cacheRead),
              // The footer's 缓存命中 rate: cache reads over *all* input reads
              // (billed input + cache reads). Using cache/billed alone reported
              // 15531% on a real session, because billed input excludes cache.
              pct: state.usage.cacheRead + state.usage.input === 0
                ? 0
                : Math.round(
                    (state.usage.cacheRead / (state.usage.cacheRead + state.usage.input)) * 100,
                  ),
            })}
      </p>

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
          <span className={silentSeconds > 60 && state.running ? styles.healthStale : undefined}>
            {silentSeconds > 60 && state.running
              ? t('health.stale', { s: silentSeconds })
              : `${t('health.lastData')} ${t('health.silence', { s: silentSeconds })}`}
          </span>
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
            onClose={() => setExpanded(null)}
            t={t}
          />
        )}
      </div>
    </div>
  )
}
