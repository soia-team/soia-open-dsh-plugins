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
 *   顶部          state, the tool in use, elapsed
 *   轮次横轴      one segment per conversation turn, width by duration: time runs
 *                 left to right, and a turn is the unit a reader thinks in
 *   轮次明细      per turn: which tools ran, what each was given, how it ended;
 *                 clicking a row opens its arguments and result in full
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
 * The horizontal axis: one segment per conversation turn.
 *
 * Width is proportional to the turn's duration, so a turn that took ten minutes
 * is visibly heavier than one that took two seconds. Segments are buttons: the
 * axis doubles as the turn selector.
 * @param props - turn summaries, the selected turn, and the handlers.
 * @returns the axis strip.
 */
function TurnAxis({ turns, selected, now, t, onSelect }: {
  turns: LiveTaskView['turns']
  selected: number | null
  now: number
  t: T
  onSelect: (turn: number) => void
}): JSX.Element {
  const durations = turns.map((turn) => Math.max(1, secondsBetween(turn.startedAt, turn.endedAt ?? now)))
  const total = durations.reduce((sum, value) => sum + value, 0)
  return (
    // A plain container with a heading above it: the section title already names
    // this group, so a redundant ARIA role would only add noise.
    <div className={styles.axis}>
      {turns.map((turn, index) => (
        <button
          key={turn.turn}
          type="button"
          className={turn.turn === selected ? styles.axisSegmentActive : styles.axisSegment}
          style={{ flexGrow: Math.max(1, Math.round((durations[index] ?? 1) / total * 100)) }}
          title={`${t('axis.turn', { n: turn.turn })} · ${t('turn.tools', { n: turn.toolCalls })} · ${t('time.seconds', { s: durations[index] ?? 0 })}`}
          onClick={() => onSelect(turn.turn)}
        >
          <span className={styles.axisLabel}>{turn.turn}</span>
          {turn.failures > 0 && <span className={styles.axisFailures}>{turn.failures}</span>}
        </button>
      ))}
    </div>
  )
}

/** One tool row inside a turn, expandable to its arguments and result. */
function ToolRow({ entry, now, expanded, onToggle, t }: {
  entry: LiveTimelineEntry
  now: number
  expanded: boolean
  onToggle: () => void
  t: T
}): JSX.Element {
  const running = entry.status === 'running'
  const took = secondsBetween(entry.startedAt, entry.endedAt ?? now)
  return (
    <li className={styles.toolItem}>
      <button type="button" className={styles.toolButton} onClick={onToggle} aria-expanded={expanded}>
        <span className={styles.tlTime}>{clockOf(entry.startedAt)}</span>
        <StateDot state={running ? 'ongoing' : entry.status === 'failed' ? 'error' : 'done'} size={8} />
        <span className={styles.tlTitle}>{entry.title}</span>
        <span className={styles.tlDetail} title={entry.detail ?? ''}>{entry.detail ?? ''}</span>
        <span className={entry.status === 'failed' ? styles.tlTookFailed : styles.tlTook}>
          {running ? t('status.running') : entry.status === 'failed' ? t('status.failed') : t('status.ok')}
          {` ${t('time.seconds', { s: took })}`}
        </span>
        <span className={styles.toolHint}>{expanded ? '▾' : t('turn.expand')}</span>
      </button>
      {expanded && (
        <dl className={styles.toolDetail}>
          <dt>{t('turn.args')}</dt>
          <dd>{entry.detail ?? '—'}</dd>
          <dt>{t('turn.result')}</dt>
          <dd>{entry.result ?? '—'}</dd>
        </dl>
      )}
    </li>
  )
}

/** The rows for one turn: its messages and its tool calls, in order. */
function TurnSection({ turn, entries, selected, now, expandedId, onToggle, t }: {
  turn: LiveTaskView['turns'][number]
  entries: readonly LiveTimelineEntry[]
  selected: boolean
  now: number
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
      {entries.length === 0
        ? <p className={styles.none}>{t('turn.empty')}</p>
        : (
          <ul className={styles.toolList}>
            {entries.map((entry) => (
              <ToolRow
                key={entry.id}
                entry={entry}
                now={now}
                expanded={expandedId === entry.id}
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
  const entriesOfTurn = (turn: number): readonly LiveTimelineEntry[] =>
    state.timeline.filter((entry) => entry.turn === turn && entry.kind === 'tool')

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

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>{t('axis.title')}</h4>
        <TurnAxis turns={state.turns} selected={shownTurn} now={now} t={t} onSelect={setSelected} />
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
              expandedId={expanded}
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
