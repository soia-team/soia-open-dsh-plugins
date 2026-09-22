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
import { Fragment, useEffect, useState } from 'react'

import { hasLiveActivity } from '../shared/live-task-state.ts'
import type { LiveTaskView, LiveTimelineEntry } from '../shared/types.ts'
import type { LiveTaskKey } from './locales.ts'
import { styles } from './styles.ts'

/** Props the conversation view slot hands a session-scoped view. */
export interface LiveTasksViewProps {
  /** Host-computed projection value for this session, if the unit has one. */
  useProjection: (key: string) => unknown
  /** Namespace-bound translator for this view's copy. */
  t: (key: LiveTaskKey, params?: Record<string, string | number>) => string
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
function LaneChart({ entries, turns, now, selected, range, t, onSelect, onRange }: {
  entries: readonly LiveTimelineEntry[]
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
  // Turn rows are boundaries, not spans: they carry no end time, so plotting one
  // would draw a bar from the turn's start to now across the whole chart.
  const plotted = entries.filter((entry) => entry.turn !== null && entry.kind !== 'turn')
  const starts = plotted.map((entry) => entry.startedAt)
  const ends = plotted.map((entry) => entry.endedAt ?? now)
  const from = starts.length === 0 ? now - 1000 : Math.min(...starts)
  const to = Math.max(now, ...(ends.length === 0 ? [now] : ends))
  const span = Math.max(1000, to - from)
  const at = (time: number): number => ((time - from) / span) * 100
  const laneOf = (kind: LiveTimelineEntry['kind']): number =>
    kind === 'assistant' ? 1 : kind === 'tool' ? 2 : 0

  const minWidth = Math.max(560, plotted.length * 26)
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
          onRange(hi - lo < 1.5 ? null : { from: from + (lo / 100) * span, to: from + (hi / 100) * span })
          setDrag(null)
        }}
      >
        {range !== null && (
          <div
            className={styles.chartSelection}
            style={{ left: `${at(range.from)}%`, width: `${Math.max(0.2, at(range.to) - at(range.from))}%` }}
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
          {plotted.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={styles.span}
              data-kind={entry.kind}
              data-error={entry.status === 'failed'}
              data-selected={selected === null || selected === entry.turn}
              style={{
                top: `${laneOf(entry.kind) * 14}px`,
                left: `${at(entry.startedAt)}%`,
                width: `max(2px, ${Math.max(0.2, at(entry.endedAt ?? now) - at(entry.startedAt))}%)`,
              }}
              title={`${entry.title || entry.kind} · ${clockOf(entry.startedAt)}`}
              aria-label={`${entry.title || entry.kind} · ${clockOf(entry.startedAt)}`}
              onClick={() => entry.turn !== null && onSelect(entry.turn)}
            />
          ))}
        </div>
        <div className={styles.chartBoundaries} aria-hidden="true">
          {turns.map((turn) => (
            <span key={turn.turn} className={styles.chartBoundary} style={{ left: `${at(turn.startedAt)}%` }} />
          ))}
        </div>
      </div>
    </div>
    </div>
  )
}

/** One tool row inside a turn, expandable to its arguments and result. */
function ToolRow({ entry, now, showClock, turnStart, expanded, selected, dim, onToggle, t }: {
  entry: LiveTimelineEntry
  now: number
  showClock: boolean
  turnStart: number
  expanded: boolean
  selected: boolean
  dim: boolean
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
  const clock = showClock ? clockOf(entry.startedAt) : `+${secondsBetween(turnStart, entry.startedAt)}s`

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
            {entry.entryId !== null && <span className={styles.tlEntryId}>{entry.entryId}</span>}
            {entry.detail !== null && (
              <span className={styles.tlDetail} title={entry.detail ?? ''}>{entry.detail}</span>
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
        </td>
      </tr>
      {expanded && (
        <tr className={styles.detailRow}>
          <td className={styles.eventCell} aria-hidden="true" />
          <td className={styles.detailCell}>
            <div className={styles.toolDetail}>
              <div className={styles.detailBlock}>
                <span className={styles.detailLabel}>{t('detail.overview')}</span>
                <dl className={styles.detailGrid}>
                  <dt>{t('detail.name')}</dt>
                  <dd>{entry.kind === 'tool' ? entry.title : kind}</dd>
                  {entry.entryId !== null && (
                    <>
                      <dt>{t('detail.entryId')}</dt>
                      <dd className={styles.detailMono}>{entry.entryId}</dd>
                    </>
                  )}
                  {entry.kind === 'tool' && (
                    <>
                      <dt>{t('overview.status')}</dt>
                      <dd>{running ? t('status.running') : failed ? t('status.failed') : t('status.ok')}</dd>
                      <dt>{t('timing.duration')}</dt><dd>{t('time.seconds', { s: took })}</dd>
                    </>
                  )}
                  <dt>{t('timing.started')}</dt><dd>{clockOf(entry.startedAt)}</dd>
                  {entry.turn !== null && (
                    <>
                      <dt>{t('overview.at')}</dt>
                      <dd>{entry.step === null
                        ? `#${entry.turn}`
                        : t('overview.atValue', { turn: entry.turn, step: entry.step })}</dd>
                    </>
                  )}
                </dl>
              </div>
              {entry.kind === 'tool'
                ? (
                    <>
                      <div className={styles.detailBlock}>
                        <span className={styles.detailLabel}>{t('turn.args')}</span>
                        <pre className={styles.detailPre}>{entry.argsFull ?? entry.detail ?? t('detail.none')}</pre>
                      </div>
                      <div className={styles.detailBlock}>
                        <span className={styles.detailLabel}>{t('turn.result')}</span>
                        <pre className={styles.detailPre}>{entry.resultFull ?? entry.result ?? t('detail.none')}</pre>
                      </div>
                    </>
                  )
                : (
                    /* A message row has one body, not an argument and a result. */
                    <div className={styles.detailBlock}>
                      <span className={styles.detailLabel}>{t('detail.content')}</span>
                      <pre className={styles.detailPre}>{entry.detail ?? t('detail.none')}</pre>
                    </div>
                  )}
            </div>
          </td>
        </tr>
      )}
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
function TurnSection({ turn, entries, picked, now, showClock, open, expandedId, dimmed, onToggle, t }: {
  turn: LiveTaskView['turns'][number]
  entries: readonly LiveTimelineEntry[]
  /** True only when the reader picked this turn; the newest turn is not "picked". */
  picked: boolean
  now: number
  showClock: boolean
  open: boolean
  expandedId: string | null
  dimmed: boolean
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
      {!open
        ? null
        : entries.length === 0
        ? (
            <tr>
              <td className={styles.eventCell} aria-hidden="true" />
              <td className={styles.contentCell}><span className={styles.none}>{t('turn.empty')}</span></td>
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
                now={now}
                showClock={showClock}
                turnStart={turn.startedAt}
                expanded={expandedId === '__all__' || expandedId === entry.id}
                selected={picked}
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
 * Render the live task view for the current session.
 * @param props - projection hook and translator from the slot kit.
 * @returns the view body, or an explicit empty state.
 */
export function LiveTasksView({ useProjection, t }: LiveTasksViewProps): JSX.Element {
  const projected = useProjection('liveTask') as LiveTaskView | undefined
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
  const state = projected === undefined
    ? undefined
    : {
        ...projected,
        turnsTotal: projected.turnsTotal ?? projected.turns.length,
        usage: projected.usage
          ?? { reported: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0, total: 0 },
      }
  const [selected, setSelected] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandAll, setExpandAll] = useState(false)
  const [failedOnly, setFailedOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [showClock, setShowClock] = useState(true)
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
      .filter((entry) => !failedOnly || entry.status === 'failed')
      .filter((entry) => needle === ''
        || entry.title.toLowerCase().includes(needle)
        || (entry.detail ?? '').toLowerCase().includes(needle)
        || (entry.result ?? '').toLowerCase().includes(needle))
      // A dragged range is a filter, exactly as in the trajectory view.
      .filter((entry) => range === null
        || ((entry.endedAt ?? entry.startedAt) >= range.from && entry.startedAt <= range.to))

  return (
    <div className={styles.view}>
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
              pct: state.usage.input === 0
                ? 0
                : Math.round((state.usage.cacheRead / state.usage.input) * 100),
            })}
      </p>

      <div className={styles.bar}>
        <input
          className={styles.search}
          type="search"
          value={query}
          placeholder={t('bar.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className={failedOnly ? styles.barOn : styles.barButton} onClick={() => setFailedOnly(!failedOnly)}>
          {t('bar.failedOnly')}
        </button>
        <button
          type="button"
          className={styles.barButton}
          onClick={() => {
            // Leaving the single-row selection behind avoids the state where
            // clicking a row changes nothing visible.
            setExpanded(null)
            setExpandAll(!expandAll)
          }}
        >
          {expandAll ? t('bar.collapseAll') : t('bar.expandAll')}
        </button>
        <button type="button" className={showClock ? styles.barOn : styles.barButton} onClick={() => setShowClock(!showClock)}>
          {showClock ? t('bar.clock') : t('bar.duration')}
        </button>
        <button type="button" className={styles.barButton} onClick={() => setTurnsOpen(!turnsOpen)}>
          {turnsOpen ? t('bar.collapseTurns') : t('bar.expandTurns')}
        </button>
        {range !== null && (
          <button type="button" className={styles.barOn} onClick={() => setRange(null)}>
            {t('bar.clearRange')}
          </button>
        )}
      </div>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>
          {state.turnsTotal > state.turns.length
            ? t('axis.titleWindow', { total: state.turnsTotal, shown: state.turns.length })
            : t('axis.title')}
        </h4>
        <LaneChart
          entries={state.timeline}
          turns={state.turns}
          now={now}
          selected={shownTurn}
          range={range}
          t={t}
          onSelect={setSelected}
          onRange={setRange}
        />
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>{t('timeline.title')}</h4>
        {/* Two columns and a scrolling pane, copied from the trajectory view: the
            event column holds the kind chip, the content column the record. The
            pane scrolls both ways so a narrow window keeps the row intact. */}
        <div className={styles.tablePane}>
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
                showClock={showClock}
                open={turnsOpen}
                expandedId={expandAll ? '__all__' : expanded}
                dimmed={pickedTurn !== null && turn.turn !== pickedTurn}
                onToggle={(id) => {
                  // A row click always leaves "expand all": otherwise, with every
                  // row expanded, clicking one looks like nothing happened.
                  setExpandAll(false)
                  setExpanded(expanded === id ? null : id)
                }}
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
  )
}
