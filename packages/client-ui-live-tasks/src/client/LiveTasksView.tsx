/**
 * The `conversation.view` entry: a live view of what this session's task is
 * doing, rendered from the host-folded `liveTask` projection.
 *
 * Visuals come from the official primitives (`StateDot`, `Pill`, `Tag`) rather
 * than hand-rolled CSS, so the view sits in the same visual system as the
 * built-in views. The only local stylesheet is the layout skeleton that
 * primitives deliberately do not provide (row grid, spacing).
 *
 * @module soia-dsh-client-ui-live-tasks/client/view
 */
import { Pill, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'

import { hasLiveActivity } from '../shared/live-task-state.ts'
import type { LiveTaskView } from '../shared/types.ts'
import type { LiveTaskKey } from './locales.ts'
import { styles } from './styles.ts'

/** Props the conversation view slot hands a session-scoped view. */
export interface LiveTasksViewProps {
  /** Host-computed projection value for this session, if the unit has one. */
  useProjection: (key: string) => unknown
  /** Namespace-bound translator for this view's copy. */
  t: (key: LiveTaskKey) => string
}

/** One labelled fact row. */
function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
    </div>
  )
}

/**
 * Map the folded state onto the primitive's semantic dot.
 * @param running - whether the session is mid-turn.
 * @param openTools - tool calls still in flight.
 * @param ended - whether the last turn ended.
 * @returns the dot state.
 */
function dotState(running: boolean, openTools: number, ended: boolean): 'ongoing' | 'done' | 'idle' {
  if (openTools > 0 || running) return 'ongoing'
  return ended ? 'done' : 'idle'
}

/**
 * Render the live task view for the current session.
 * @param props - projection hook and translator from the slot kit.
 * @returns the view body, or an explicit empty state.
 */
export function LiveTasksView({ useProjection, t }: LiveTasksViewProps): JSX.Element {
  const state = useProjection('liveTask') as LiveTaskView | undefined

  if (state === undefined || !hasLiveActivity(state)) {
    return (
      <div className={styles.empty}>
        <StateDot state="idle" />
        <span>{t('view.empty')}</span>
      </div>
    )
  }

  const phase = state.openTools.length > 0
    ? t('phase.tool')
    : state.running
      ? t('phase.running')
      : state.endedReason !== null
        ? t('phase.ended')
        : t('phase.idle')
  const settled = state.endedReason !== null && !state.running

  return (
    <div className={styles.view}>
      <header className={styles.head}>
        <StateDot state={dotState(state.running, state.openTools.length, settled)} />
        <strong className={styles.title}>{t('view.title')}</strong>
        <Tag tone={settled ? 'success' : 'info'}>{phase}</Tag>
        <Pill>{`#${state.turn} · ${t('row.step')} ${state.step}`}</Pill>
      </header>
      <div className={styles.rows}>
        <Row label={t('row.toolCalls')} value={String(state.toolCallsInTurn)} />
        <Row
          label={t('row.lastTool')}
          value={state.lastTool === null
            ? '—'
            : `${state.lastTool.name} · ${state.lastTool.open ? t('tool.open') : t('tool.done')}`}
        />
        <Row
          label={t('row.lastEvent')}
          value={state.lastEvent === null
            ? '—'
            : state.lastEvent.detail === null
            ? state.lastEvent.type
            : `${state.lastEvent.type} · ${state.lastEvent.detail}`}
        />
      </div>
    </div>
  )
}
