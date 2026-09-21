/**
 * Session-header entry point for the live-task panel.
 *
 * The component is a pure reader: the host folds the state and the projection
 * registry mirrors it, so there is no fetch, no subscription to a private
 * channel, and no derived state beyond whether the popover is open. The only
 * fact it computes locally is the trigger's own label.
 *
 * It renders nothing at all until the session projection carries a state with
 * activity, so an ordinary conversation never grows a control for a capability
 * it is not using.
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

import { hasLiveActivity } from '../shared/live-task-state.ts'
import { LIVE_TASK_PROJECTION_KEY } from '../shared/projection.ts'
import type { LiveTaskView } from '../shared/types.ts'
import type { NS } from './locales.ts'
import styles from './LiveTasksAction.module.css'

/** Full props for the session-header live-task action. */
export type LiveTasksActionProps =
  & PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>

/**
 * One labeled row of the popover.
 * @param props - localized label and the value to show beside it.
 * @returns the row element.
 */
function Row({ label, value }: { label: string, value: string }): JSX.Element {
  return (
    <li className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
    </li>
  )
}

/**
 * Short state word for the trigger and the phase row.
 * @param state - current projection value.
 * @param t - namespace translator.
 * @returns the localized phase label.
 */
function phaseLabel(state: LiveTaskView, t: LiveTasksActionProps['t']): string {
  if (state.openTools.length > 0) return t('phase.tool')
  if (state.running) return t('phase.running')
  if (state.endedReason !== null) return t('phase.ended')
  return t('phase.idle')
}

/**
 * Session-header action and popover for this session's task state.
 * @param props - runtime slot currency plus the namespace translator.
 * @returns the trigger and its popover, or null when there is nothing to show.
 */
export function LiveTasksAction({ useProjection, t }: LiveTasksActionProps): JSX.Element | null {
  // The slot contract hands the projection hook in as a prop, so which hook this
  // is gets decided by the host, not here. React cannot verify that statically;
  // the official client packages read slots the same way.
  // eslint-disable-next-line react/hooks -- hook supplied by the slot contract
  const state = useProjection(LIVE_TASK_PROJECTION_KEY)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

  // Closing on Escape and on a press outside is the whole interaction model;
  // both listeners exist only while the popover is open.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && root.current?.contains(target) === true) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  // `undefined` means the capability is absent in this composition — the host
  // unit is unmounted, or no baseline has carried the key yet. Absence renders
  // as absence, never as an invented empty state.
  if (state === undefined || !hasLiveActivity(state)) return null

  const openTool = state.openTools.at(-1)
  const label = openTool !== undefined
    ? openTool.name
    : state.running
      ? t('trigger.running')
      : t('trigger.idle')
  const toolValue = state.lastTool === null
    ? t('value.none')
    : [
        state.lastTool.name,
        state.lastTool.open ? t('tool.open') : t('tool.done'),
        ...(state.lastTool.failed === true ? [t('tool.failed')] : []),
      ].join(' · ')

  return (
    <div className={styles.root} ref={root}>
      <button
        type="button"
        ref={trigger}
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('panel.aria')}
        onClick={() => {
          setOpen((wasOpen) => !wasOpen)
        }}
      >
        <span
          className={openTool === undefined ? styles.dotIdle : styles.dotTool}
          aria-hidden="true"
        />
        <span className={styles.label}>{label}</span>
      </button>
      {open
        ? (
            <ul className={styles.menu} aria-label={t('panel.aria')}>
              <Row label={t('row.phase')} value={phaseLabel(state, t)} />
              <Row
                label={t('row.turn')}
                value={state.turn === null ? t('value.none') : String(state.turn)}
              />
              <Row
                label={t('row.step')}
                value={state.step === null ? t('value.none') : String(state.step)}
              />
              <Row label={t('row.lastTool')} value={toolValue} />
              <Row label={t('row.toolCalls')} value={String(state.toolCallsInTurn)} />
              <Row
                label={t('row.lastEvent')}
                value={state.lastEvent === null
                  ? t('value.none')
                  : state.lastEvent.detail === null
                    ? state.lastEvent.type
                    : `${state.lastEvent.type} · ${state.lastEvent.detail}`}
              />
              {state.endedReason === null
                ? null
                : <Row label={t('row.endedReason')} value={state.endedReason} />}
            </ul>
          )
        : null}
    </div>
  )
}
