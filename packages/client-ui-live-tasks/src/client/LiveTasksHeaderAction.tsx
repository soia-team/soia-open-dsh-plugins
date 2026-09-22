/**
 * A compact companion to the view: the tool the session is using right now,
 * shown in the session header so it is visible from any view.
 *
 * The view tab answers "what is it doing" in full, but only for a reader who is
 * already looking at that tab. "Which tool is it on" is worth one line
 * everywhere else — including in the 对话 view, where a long silent turn is
 * exactly when the question gets asked.
 *
 * Renders nothing when the session has shown no activity, so a fresh session
 * gains no chrome.
 *
 * @module soia-dsh-client-ui-live-tasks/client/header-action
 */
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'

import { hasLiveActivity } from '../shared/live-task-state.ts'
import type { LiveTaskView } from '../shared/types.ts'
import type { LiveTaskKey } from './locales.ts'
import { styles } from './styles.ts'

/** Props the header action slot hands a session-scoped occupant. */
export interface LiveTasksHeaderActionProps {
  /** Host-computed projection value for this session, if the unit has one. */
  useProjection: (key: string) => unknown
  /** Namespace-bound translator for this copy. */
  t: (key: LiveTaskKey, params?: Record<string, string | number>) => string
}

/**
 * Render the running-tool indicator.
 * @param props - projection hook and translator from the slot kit.
 * @returns the indicator, or null when there is nothing to report.
 */
export function LiveTasksHeaderAction({ useProjection, t }: LiveTasksHeaderActionProps): JSX.Element | null {
  const state = useProjection('liveTask') as LiveTaskView | undefined
  if (state === undefined || !hasLiveActivity(state)) return null

  const inFlight = state.openTools.length > 0
  const label = inFlight
    ? state.openTools.map((call) => call.name).join(', ')
    : state.actions.at(-1)?.name ?? t('view.tab')

  return (
    <button
      type="button"
      className={styles.headerChip}
      aria-label={`${inFlight ? t('head.toolRunning') : t('head.toolLast')}: ${label}`}
      // The chip reports; the view tab is where a reader acts on it. A disabled
      // control that looks clickable would be worse than no control, so this one
      // is a real button only in the sense that it focuses the view.
      onClick={() => {
        globalThis.location.hash = ''
      }}
    >
      <StateDot state={inFlight ? 'ongoing' : 'idle'} size={8} />
      <span className={styles.headerChipLabel}>{label}</span>
    </button>
  )
}
