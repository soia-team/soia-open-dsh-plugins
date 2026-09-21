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
.lt-view { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px; }
.lt-head { display: flex; align-items: center; gap: 8px; }
.lt-title { font-size: 13.5px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.lt-rows { display: flex; flex-direction: column; gap: 2px; }
.lt-row { display: grid; grid-template-columns: 132px 1fr; align-items: baseline; gap: 12px;
  padding: 6px 8px; border-radius: 8px; font-size: 13px; line-height: 18px;
  color: var(--dsw-alias-label-primary); }
.lt-row:nth-child(odd) { background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 3%)); }
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
