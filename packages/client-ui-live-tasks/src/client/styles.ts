/**
 * Layout skeleton for the live-task view.
 *
 * Buttons, pills, tags and state dots come from the official primitives; what
 * is left here is only the layout they deliberately do not own — the row grid
 * and the view padding. Class names carry an `lt-` prefix so they cannot
 * collide with the page's own generic names, and the stylesheet is injected
 * once per document, tagged with the plugin id.
 *
 * The `--dsw-*` variables come from the host shell, so the view follows the
 * active theme without duplicating any palette.
 */
const CSS = `
.lt-view { display: flex; flex-direction: column; gap: 16px; padding: 18px 20px; }
.lt-head { display: flex; align-items: center; gap: 8px; }
.lt-title { font-size: 13.5px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.lt-elapsed { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.lt-section { display: flex; flex-direction: column; gap: 6px; }
.lt-sectionTitle { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .02em;
  color: var(--dsw-alias-label-tertiary); }
.lt-list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.lt-call { display: grid; grid-template-columns: 10px 84px 1fr; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 8px; font-size: 13px; line-height: 18px;
  background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 4%)); }
.lt-callName { color: var(--dsw-alias-label-primary); font-weight: 600; }
.lt-callDetail { min-width: 0; overflow: hidden; font-family: var(--dsw-font-mono, monospace);
  white-space: nowrap; text-overflow: ellipsis; color: var(--dsw-alias-label-secondary); }
.lt-event { display: grid; grid-template-columns: 76px 112px 1fr; align-items: baseline; gap: 10px;
  padding: 4px 8px; border-radius: 6px; font-size: 12.5px; line-height: 18px; }
.lt-event:nth-child(odd) { background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 3%)); }
.lt-eventTime { color: var(--dsw-alias-label-tertiary); }
.lt-eventType { color: var(--dsw-alias-label-secondary); font-family: var(--dsw-font-mono, monospace); }
.lt-eventDetail { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-mono, monospace); }
.lt-none { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12.5px; }
.lt-rows { display: flex; flex-direction: column; gap: 2px; }
.lt-row { display: grid; grid-template-columns: 132px 1fr; align-items: baseline; gap: 12px;
  padding: 6px 8px; border-radius: 8px; font-size: 13px; line-height: 18px;
  color: var(--dsw-alias-label-primary); }
.lt-rowLabel { color: var(--dsw-alias-label-tertiary); }
.lt-rowValue { min-width: 0; overflow: hidden; font-family: var(--dsw-font-mono, monospace);
  white-space: nowrap; text-overflow: ellipsis; }
.lt-empty { display: flex; align-items: center; gap: 8px; padding: 24px 20px;
  color: var(--dsw-alias-label-tertiary); font-size: 13px; }
`

/** Class names this view applies. */
export const styles = {
  view: 'lt-view',
  head: 'lt-head',
  title: 'lt-title',
  elapsed: 'lt-elapsed',
  section: 'lt-section',
  sectionTitle: 'lt-sectionTitle',
  list: 'lt-list',
  call: 'lt-call',
  callName: 'lt-callName',
  callDetail: 'lt-callDetail',
  event: 'lt-event',
  eventTime: 'lt-eventTime',
  eventType: 'lt-eventType',
  eventDetail: 'lt-eventDetail',
  none: 'lt-none',
  rows: 'lt-rows',
  row: 'lt-row',
  rowLabel: 'lt-rowLabel',
  rowValue: 'lt-rowValue',
  empty: 'lt-empty',
} as const

/** Plugin id the injected style tag is tagged with. */
const STYLE_TAG_ID = 'ui-live-tasks'

if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = STYLE_TAG_ID
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = CSS
  document.head.append(tag)
}
