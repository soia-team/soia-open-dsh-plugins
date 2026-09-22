/**
 * The `conversation.view` entry: what this session is doing, in human terms.
 *
 * Two earlier versions failed a readability test the author should have run
 * first: the first showed counts, which answer "is anything happening" but not
 * "what is it doing"; the second showed raw session event types (`step/start`,
 * `session-log-*` delivery receipts), which are the log's vocabulary rather
 * than a reader's. This version answers the four questions a person asks about a
 * running agent, in this order:
 *
 *   what is it doing right now — tool name and the command/path it was given
 *   what has it done — one row per finished call
 *   when — wall-clock time of each call
 *   with what result — outcome word, duration, and the first line that came back
 *
 * Visuals come from the official primitives so the view belongs to the same
 * design system as the built-in views.
 *
 * @module soia-dsh-client-ui-live-tasks/client/view
 */
import { Pill, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
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

/**
 * Re-render once a second so "running for" and durations stay true.
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
 * Protocol event names are the session log's vocabulary, not a reader's. Only
 * the few worth a line are phrased; transport bookkeeping is dropped and
 * anything unrecognized is reported as generic activity rather than leaking a
 * type name into the panel.
 * @param summary - the folded observation.
 * @param t - translator.
 * @returns the human phrase, or null when the event is not worth a line.
 */
function phraseOf(summary: LiveEventSummary, t: LiveTasksViewProps['t']): string | null {
  switch (summary.type) {
    case 'turn/start': return t('event.turnStart')
    case 'turn/end': return t('event.turnEnd')
    case 'user/message': return t('event.userMessage')
    case 'assistant/message': return t('event.assistantMessage')
    case 'tool/call': return summary.detail === null ? null : t('event.toolCall', { name: summary.detail })
    case 'tool/result': return summary.detail === null ? null : t('event.toolResult', { name: summary.detail })
    // Everything else — transport receipts, bookkeeping types, anything a
    // newer build adds — is left out rather than labelled "other activity":
    // a line that says nothing is worse than no line.
    default: return null
  }
}

/** One row of the activity log: when, which tool, what it did, how it ended. */
function ActionRow({ action, now, t }: {
  action: LiveTaskAction
  now: number
  t: LiveTasksViewProps['t']
}): JSX.Element {
  const status = action.status === 'running'
    ? t('status.running')
    : action.status === 'failed'
      ? t('status.failed')
      : t('status.ok')
  const took = secondsBetween(action.startedAt, action.endedAt ?? now)
  return (
    <tr>
      <td className={styles.tdTime}>{clockOf(action.startedAt)}</td>
      <td className={styles.tdTool}>
        <StateDot state={action.status === 'running' ? 'ongoing' : action.status === 'failed' ? 'error' : 'done'} size={8} />
        <span className={styles.toolName}>{action.name}</span>
      </td>
      <td className={styles.tdWhat}>{action.detail ?? ''}</td>
      <td className={styles.tdResult}>
        <span className={styles.resultLine}>{action.result ?? ''}</span>
        <span className={action.status === 'failed' ? styles.badgeFailed : styles.badgeOk}>
          {`${status} · ${t('time.durationSeconds', { s: took })}`}
        </span>
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
  const headline = inFlight
    ? `${t('phase.tool')} — ${state.openTools.map((call) => call.name).join(', ')}`
    : state.running
      ? t('phase.running')
      : state.endedReason !== null
        ? t('phase.ended')
        : t('phase.idle')
  const settled = state.endedReason !== null && !state.running
  const recentPhrases = [...state.recent]
    .reverse()
    .map((summary) => phraseOf(summary, t))
    .filter((phrase): phrase is string => phrase !== null)
    .slice(0, 3)

  return (
    <div className={styles.view}>
      <header className={styles.head}>
        <StateDot state={inFlight || state.running ? 'ongoing' : settled ? 'done' : 'idle'} />
        <strong className={styles.title}>{t('view.title')}</strong>
        <Tag tone={settled ? 'success' : 'info'}>{headline}</Tag>
        {state.turn !== null && (
          <Pill>{state.step === null ? `#${state.turn}` : `#${state.turn} · ${t('event.stepStart', { n: state.step })}`}</Pill>
        )}
        <span className={styles.elapsed}>
          {state.running ? t('time.runningFor', { s: secondsBetween(state.updatedAt ?? now, now) }) : ''}
        </span>
      </header>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>{t('section.running')}</h4>
        {state.openTools.length === 0
          ? <p className={styles.none}>{t('tool.none')}</p>
          : (
            <ul className={styles.list}>
              {state.openTools.map((call) => (
                <li key={call.callId} className={styles.call}>
                  <StateDot state="ongoing" size={8} />
                  <span className={styles.toolName}>{call.name}</span>
                  <span className={styles.callDetail}>{call.detail ?? ''}</span>
                  <span className={styles.callTook}>
                    {t('time.durationSeconds', { s: secondsBetween(call.startedAt, now) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </section>

      {state.actions.length > 0 && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>{t('section.actions')}</h4>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>{t('time.at')}</th>
                <th className={styles.th}>{t('col.tool')}</th>
                <th className={styles.th}>{t('col.did')}</th>
                <th className={styles.th}>{t('col.result')}</th>
              </tr>
            </thead>
            <tbody>
              {[...state.actions].reverse().map((action) => (
                <ActionRow key={action.callId} action={action} now={now} t={t} />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {recentPhrases.length > 0 && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>{t('section.recent')}</h4>
          <p className={styles.none}>{recentPhrases.join(' · ')}</p>
        </section>
      )}
    </div>
  )
}
