/**
 * The `conversation.view` entry: what this session's task is doing right now.
 *
 * The first version showed counts, which answered "is anything running" but not
 * "what is it doing". This one shows the in-flight calls with the argument line
 * the host folded for each, a trailing window of recent events with relative
 * times, and how long the turn has been running — the three things a reader
 * actually needs to tell a working session from a stuck one.
 *
 * Visuals come from the official primitives (`StateDot`, `Tag`, `Pill`) so the
 * view sits in the same design system as the built-in views; the local
 * stylesheet is only the layout skeleton primitives do not provide.
 *
 * @module soia-dsh-client-ui-live-tasks/client/view
 */
import { Pill, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useState } from 'react'

import { hasLiveActivity } from '../shared/live-task-state.ts'
import type { LiveEventSummary, LiveTaskView } from '../shared/types.ts'
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

/** Render a duration in seconds as "just now" / "Ns ago" / "Nm ago". */
function ago(at: number, now: number, t: LiveTasksViewProps['t']): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 2) return t('time.justNow')
  if (seconds < 60) return t('time.agoSeconds', { s: seconds })
  return t('time.agoMinutes', { m: Math.round(seconds / 60) })
}

/** One event line in the trail. */
function EventRow({ summary, now, t }: {
  summary: LiveEventSummary
  now: number
  t: LiveTasksViewProps['t']
}): JSX.Element {
  return (
    <li className={styles.event}>
      <span className={styles.eventTime}>{ago(summary.time, now, t)}</span>
      <span className={styles.eventType}>{summary.type}</span>
      <span className={styles.eventDetail}>{summary.detail ?? ''}</span>
    </li>
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
  const phase = inFlight
    ? t('phase.tool')
    : state.running
      ? t('phase.running')
      : state.endedReason !== null
        ? t('phase.ended')
        : t('phase.idle')
  const settled = state.endedReason !== null && !state.running
  const elapsedSeconds = state.updatedAt === null ? 0 : Math.round((now - state.updatedAt) / 1000)

  return (
    <div className={styles.view}>
      <header className={styles.head}>
        <StateDot state={inFlight || state.running ? 'ongoing' : settled ? 'done' : 'idle'} />
        <strong className={styles.title}>{t('view.title')}</strong>
        <Tag tone={settled ? 'success' : 'info'}>{phase}</Tag>
        {state.turn !== null && <Pill>{`#${state.turn} · ${t('row.step')} ${state.step ?? '—'}`}</Pill>}
        <span className={styles.elapsed}>
          {state.running ? t('time.runningFor', { s: elapsedSeconds }) : ago(state.updatedAt ?? now, now, t)}
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
                  <span className={styles.callName}>{call.name}</span>
                  <span className={styles.callDetail}>{call.detail ?? ''}</span>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>{t('section.recent')}</h4>
        <ul className={styles.list}>
          {[...state.recent].reverse().map((summary) => (
            <EventRow key={`${summary.seq}-${summary.type}`} summary={summary} now={now} t={t} />
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <div className={styles.rows}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>{t('row.toolCalls')}</span>
            <span className={styles.rowValue}>{String(state.toolCallsInTurn)}</span>
          </div>
          {state.lastTool !== null && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>{t('row.lastTool')}</span>
              <span className={styles.rowValue}>
                {`${state.lastTool.name} · ${state.lastTool.open ? t('tool.open') : state.lastTool.failed === true ? t('tool.failed') : t('tool.done')}`}
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
