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
import { useEffect, useState } from 'react'

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
function LaneChart({ entries, turns, now, selected, t, onSelect }: {
  entries: readonly LiveTimelineEntry[]
  turns: LiveTaskView['turns']
  now: number
  selected: number | null
  t: T
  onSelect: (turn: number) => void
}): JSX.Element {
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
      <div className={styles.chartTrack}>
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
function ToolRow({ entry, now, showClock, turnStart, expanded, onToggle, t }: {
  entry: LiveTimelineEntry
  now: number
  showClock: boolean
  turnStart: number
  expanded: boolean
  onToggle: () => void
  t: T
}): JSX.Element {
  const running = entry.status === 'running'
  const took = secondsBetween(entry.startedAt, entry.endedAt ?? now)
  const kindBadge = entry.kind === 'user'
    ? t('timeline.user')
    : entry.kind === 'assistant'
      ? t('timeline.assistant')
      : null
  return (
    <li className={styles.toolItem}>
      <button type="button" className={styles.toolButton} onClick={onToggle} aria-expanded={expanded}>
        <span className={styles.tlTime}>
          {showClock ? clockOf(entry.startedAt) : `+${secondsBetween(turnStart, entry.startedAt)}s`}
        </span>
        <StateDot state={running ? 'ongoing' : entry.status === 'failed' ? 'error' : 'done'} size={8} />
        {kindBadge === null
          ? <span className={styles.tlTitle}>{entry.title}</span>
          : <span className={styles.tlBadge}>{kindBadge}</span>}
        <span className={styles.tlDetail} title={entry.detail ?? ''}>{entry.detail ?? ''}</span>
        <span className={entry.status === 'failed' ? styles.tlTookFailed : styles.tlTook}>
          {entry.kind !== 'tool'
            ? ''
            : `${running ? t('status.running') : entry.status === 'failed' ? t('status.failed') : t('status.ok')} ${t('time.seconds', { s: took })}`}
        </span>
        <span className={styles.toolHint}>{expanded ? '▾' : t('turn.expand')}</span>
      </button>
      {expanded && (
        <div className={styles.toolDetail}>
          <div className={styles.detailBlock}>
            <span className={styles.detailLabel}>{t('turn.args')}</span>
            <pre className={styles.detailPre}>{entry.argsFull ?? entry.detail ?? t('detail.none')}</pre>
          </div>
          <div className={styles.detailBlock}>
            <span className={styles.detailLabel}>{t('turn.result')}</span>
            <pre className={styles.detailPre}>{entry.resultFull ?? entry.result ?? t('detail.none')}</pre>
          </div>
        </div>
      )}
    </li>
  )
}

/** The rows for one turn: its messages and its tool calls, in order. */
function TurnSection({ turn, entries, selected, now, showClock, open, expandedId, onToggle, t }: {
  turn: LiveTaskView['turns'][number]
  entries: readonly LiveTimelineEntry[]
  selected: boolean
  now: number
  showClock: boolean
  open: boolean
  expandedId: string | null
  onToggle: (id: string) => void
  t: T
}): JSX.Element {
  const started = clockOf(turn.startedAt)
  const took = secondsBetween(turn.startedAt, turn.endedAt ?? now)
  return (
    <section className={selected ? styles.turnSectionActive : styles.turnSection}>
      <header className={styles.turnHead}>
        <StateDot state={turn.endedAt === null ? 'ongoing' : turn.failures > 0 ? 'warning' : 'done'} size={9} />
        <strong className={styles.turnTitle}>{t('timeline.turnN', { n: turn.turn })}</strong>
        <span className={styles.turnMeta}>{started}</span>
        <span className={styles.turnMeta}>{t('time.seconds', { s: took })}</span>
        {turn.toolCalls > 0 && <span className={styles.turnMeta}>{t('turn.tools', { n: turn.toolCalls })}</span>}
        {turn.failures > 0 && <span className={styles.tlTookFailed}>{t('turn.failed', { n: turn.failures })}</span>}
      </header>
      {!open
        ? null
        : entries.length === 0
        ? <p className={styles.none}>{t('turn.empty')}</p>
        : (
          <ul className={styles.toolList}>
            {entries.map((entry) => (
              <ToolRow
                key={entry.id}
                entry={entry}
                now={now}
                showClock={showClock}
                turnStart={turn.startedAt}
                expanded={expandedId === '__all__' || expandedId === entry.id}
                onToggle={() => onToggle(entry.id)}
                t={t}
              />
            ))}
          </ul>
        )}
    </section>
  )
}

/**
 * Render the live task view for the current session.
 * @param props - projection hook and translator from the slot kit.
 * @returns the view body, or an explicit empty state.
 */
export function LiveTasksView({ useProjection, t }: LiveTasksViewProps): JSX.Element {
  const state = useProjection('liveTask') as LiveTaskView | undefined
  const [selected, setSelected] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandAll, setExpandAll] = useState(false)
  const [failedOnly, setFailedOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [showClock, setShowClock] = useState(true)
  const [turnsOpen, setTurnsOpen] = useState(true)
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
          turns: state.turns.length,
          calls: state.toolCallsTotal,
          failures: state.failuresTotal,
          tools: state.toolsAvailable ?? '—',
          used: distinctTools,
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
        <button type="button" className={styles.barButton} onClick={() => setExpandAll(!expandAll)}>
          {expandAll ? t('bar.collapseAll') : t('bar.expandAll')}
        </button>
        <button type="button" className={showClock ? styles.barOn : styles.barButton} onClick={() => setShowClock(!showClock)}>
          {showClock ? t('bar.clock') : t('bar.duration')}
        </button>
        <button type="button" className={styles.barButton} onClick={() => setTurnsOpen(!turnsOpen)}>
          {turnsOpen ? t('bar.collapseTurns') : t('bar.expandTurns')}
        </button>
      </div>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>{t('axis.title')}</h4>
        <LaneChart
          entries={state.timeline}
          turns={state.turns}
          now={now}
          selected={shownTurn}
          t={t}
          onSelect={setSelected}
        />
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>{t('timeline.title')}</h4>
        <div className={styles.turnList}>
          {[...state.turns].reverse().map((turn) => (
            <TurnSection
              key={turn.turn}
              turn={turn}
              entries={entriesOfTurn(turn.turn)}
              selected={turn.turn === shownTurn}
              now={now}
              showClock={showClock}
              open={turnsOpen}
              expandedId={expandAll ? '__all__' : expanded}
              onToggle={(id) => setExpanded(expanded === id ? null : id)}
              t={t}
            />
          ))}
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
