/**
 * The `conversation.view` entry: what this session is doing, in human terms.
 *
 * ## Architecture
 *
 * The panel is four modules under one header, in the order a reader asks the
 * questions — and the module boundaries are the design, not decoration:
 *
 *   概览 (overview)    a card grid of the facts you scan first: state, position,
 *                       call count, failures
 *   正在跑 (running)   one line per in-flight call: tool, what it was given, how
 *                       long it has been running
 *   动作日志 (log)     the table: one row per finished call — when, which tool,
 *                       what it did, how long it took, what came back — with a
 *                       filter to the failures, which is the question a log is
 *                       usually asked
 *   最近动静 (recent)  up to three plain-language phrases about model activity
 *
 * Each module owns its copy keys (`overview.*`, `running.*`, `log.*`,
 * `recent.*`) and its own empty state, so a module can be read, translated or
 * removed without touching the others.
 *
 * Two earlier versions failed a readability test the author should have run
 * first: one showed counts only, the other showed raw session event types
 * (`step/start`, `session-log-*`). Both are the log's vocabulary, not a
 * reader's. Nothing here prints a protocol type name.
 *
 * Visuals come from the official primitives so the view belongs to the same
 * design system as the built-in views.
 *
 * @module soia-dsh-client-ui-live-tasks/client/view
 */
import { StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useState } from 'react'

import { hasLiveActivity } from '../shared/live-task-state.ts'
import type { LiveEventSummary, LiveTaskAction, LiveTaskView } from '../shared/types.ts'
import type { LiveTaskKey } from './locales.ts'
import { styles } from './styles.ts'

/** Props the conversation view slot hands a session-scoped view. */
export interface LiveTasksViewProps {
  /** Host-computed projection value for this session, if the unit has one. */
  useProjection: (key: string) => unknown
  /** Namespace-bound translator for this view's copy. */
  t: (key: LiveTaskKey, params?: Record<string, string | number>) => string
}

/** Translator alias, to keep the component signatures short. */
type T = LiveTasksViewProps['t']

/**
 * Re-render once a second so elapsed and relative times stay true.
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
 * Turn one session event into the phrase a person would use for it.
 *
 * Only the few worth a line are phrased; transport bookkeeping and anything a
 * newer build adds are dropped rather than labelled "other activity", because a
 * line that says nothing is worse than no line.
 * @param summary - the folded observation.
 * @param t - translator.
 * @returns the human phrase, or null when the event is not worth a line.
 */
function phraseOf(summary: LiveEventSummary, t: T): string | null {
  switch (summary.type) {
    case 'turn/start': return t('event.turnStart')
    case 'turn/end': return t('event.turnEnd')
    case 'user/message': return t('event.userMessage')
    case 'assistant/message': return t('event.assistantMessage')
    case 'tool/call': return summary.detail === null ? null : t('event.toolCall', { name: summary.detail })
    case 'tool/result': return summary.detail === null ? null : t('event.toolResult', { name: summary.detail })
    default: return null
  }
}

/** One card in the overview grid. */
function Stat({ label, value, failed }: { label: string; value: string; failed?: boolean }): JSX.Element {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={failed === true ? styles.statValueFailed : styles.statValue}>{value}</span>
    </div>
  )
}

/** One row of the activity log: when, which tool, what it did, how long, result. */
function ActionRow({ action, now, t }: { action: LiveTaskAction; now: number; t: T }): JSX.Element {
  const status = action.status === 'running'
    ? t('status.running')
    : action.status === 'failed'
      ? t('status.failed')
      : t('status.ok')
  return (
    <tr className={action.status === 'failed' ? styles.rowFailed : undefined}>
      <td className={styles.tdTime}>{clockOf(action.startedAt)}</td>
      <td className={styles.tdTool}>
        <StateDot state={action.status === 'running' ? 'ongoing' : action.status === 'failed' ? 'error' : 'done'} size={8} />
        <span className={styles.toolName}>{action.name}</span>
      </td>
      <td className={styles.tdWhat} title={action.detail ?? ''}>{action.detail ?? ''}</td>
      <td className={styles.tdTook}>{t('time.seconds', { s: secondsBetween(action.startedAt, action.endedAt ?? now) })}</td>
      <td className={styles.tdResult}>
        <span className={styles.resultLine} title={action.result ?? ''}>{action.result ?? ''}</span>
        <span className={action.status === 'failed' ? styles.badgeFailed : styles.badgeOk}>{status}</span>
      </td>
    </tr>
  )
}

/**
 * Render the live task view for the current session.
 * @param props - projection hook and translator from the slot kit.
 * @returns the view body, or an explicit empty state.
 */
export function LiveTasksView({ useProjection, t }: LiveTasksViewProps): JSX.Element {
  const state = useProjection('liveTask') as LiveTaskView | undefined
  const [failuresOnly, setFailuresOnly] = useState(false)
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
  const actions = [...state.actions].reverse()
  const failed = actions.filter((action) => action.status === 'failed')
  const shown = failuresOnly ? failed : actions
  const phrases = [...state.recent]
    .reverse()
    .map((summary) => phraseOf(summary, t))
    .filter((phrase): phrase is string => phrase !== null)
    .slice(0, 3)

  return (
    <div className={styles.view}>
      <header className={styles.head}>
        <StateDot state={inFlight || state.running ? 'ongoing' : settled ? 'done' : 'idle'} />
        <Tag tone={settled ? 'success' : 'info'}>{phase}</Tag>
        <span className={styles.elapsed}>
          {state.running ? t('time.seconds', { s: secondsBetween(state.updatedAt ?? now, now) }) : ''}
        </span>
      </header>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>{t('overview.title')}</h4>
        <div className={styles.stats}>
          <Stat label={t('overview.status')} value={phase} />
          <Stat
            label={t('overview.at')}
            value={state.turn === null
              ? '—'
              : state.step === null
                ? t('overview.turnOnly', { turn: state.turn })
                : t('overview.atValue', { turn: state.turn, step: state.step })}
          />
          <Stat label={t('overview.calls')} value={String(state.actions.length)} />
          <Stat label={t('overview.failures')} value={String(failed.length)} {...(failed.length > 0 ? { failed: true } : {})} />
        </div>
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>{t('running.title')}</h4>
        {state.openTools.length === 0
          ? <p className={styles.none}>{t('running.empty')}</p>
          : (
            <ul className={styles.list}>
              {state.openTools.map((call) => (
                <li key={call.callId} className={styles.call}>
                  <StateDot state="ongoing" size={8} />
                  <span className={styles.toolName}>{call.name}</span>
                  <span className={styles.callDetail} title={call.detail ?? ''}>{call.detail ?? ''}</span>
                  <span className={styles.callTook}>
                    {t('running.started', { s: secondsBetween(call.startedAt, now) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h4 className={styles.sectionTitle}>{t('log.title')}</h4>
          <div className={styles.filters}>
            <button
              type="button"
              className={failuresOnly ? styles.filter : styles.filterActive}
              onClick={() => setFailuresOnly(false)}
            >
              {t('log.filterAll', { n: actions.length })}
            </button>
            <button
              type="button"
              className={failuresOnly ? styles.filterActive : styles.filter}
              onClick={() => setFailuresOnly(true)}
            >
              {t('log.filterFailed', { n: failed.length })}
            </button>
          </div>
        </div>
        {shown.length === 0
          ? <p className={styles.none}>{t('log.filterEmpty')}</p>
          : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>{t('log.time')}</th>
                  <th className={styles.th}>{t('log.tool')}</th>
                  <th className={styles.th}>{t('log.did')}</th>
                  <th className={styles.th}>{t('log.took')}</th>
                  <th className={styles.th}>{t('log.result')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((action) => <ActionRow key={action.callId} action={action} now={now} t={t} />)}
              </tbody>
            </table>
          )}
      </section>

      {phrases.length > 0 && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>{t('recent.title')}</h4>
          <p className={styles.none}>{phrases.join(' · ')}</p>
        </section>
      )}
    </div>
  )
}
