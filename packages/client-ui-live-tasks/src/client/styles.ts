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
.lt-sectionTitle { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--dsw-alias-label-tertiary); }
.lt-list { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
.lt-call { display: grid; grid-template-columns: 10px 150px 1fr auto; align-items: center; gap: 8px;
  padding: 7px 9px; border-radius: 8px; font-size: 13px; line-height: 18px;
  background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 4%)); }
.lt-toolName { color: var(--dsw-alias-label-primary); font-weight: 600; font-family: var(--dsw-font-mono, monospace); }
.lt-callDetail, .lt-tdWhat { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  font-family: var(--dsw-font-mono, monospace); color: var(--dsw-alias-label-secondary); }
.lt-callTook { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.lt-table { width: 100%; border-collapse: collapse; font-size: 12.5px; line-height: 18px; }
.lt-th { padding: 4px 8px; text-align: left; font-weight: 600; color: var(--dsw-alias-label-tertiary);
  border-bottom: 1px solid var(--dsw-alias-separator, rgb(0 0 0 / 8%)); }
.lt-table tbody tr:nth-child(odd) { background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 3%)); }
.lt-tdTime { padding: 5px 8px; color: var(--dsw-alias-label-tertiary); font-family: var(--dsw-font-mono, monospace); white-space: nowrap; }
.lt-tdTool { padding: 5px 8px; }
.lt-tdWhat { padding: 5px 8px; max-width: 260px; }
.lt-tdResult { padding: 5px 8px; }
.lt-resultLine { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  max-width: 260px; color: var(--dsw-alias-label-primary); }
.lt-badgeOk, .lt-badgeFailed { display: inline-block; margin-top: 2px; padding: 0 6px; border-radius: 6px;
  font-size: 11px; line-height: 16px; }
.lt-badgeOk { color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 5%)); }
.lt-badgeFailed { color: var(--dsw-alias-label-error, #b42318); background: rgb(180 35 24 / 10%); }
.lt-none { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12.5px; }
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
  toolName: 'lt-toolName',
  callDetail: 'lt-callDetail',
  callTook: 'lt-callTook',
  table: 'lt-table',
  th: 'lt-th',
  tdTime: 'lt-tdTime',
  tdTool: 'lt-tdTool',
  tdWhat: 'lt-tdWhat',
  tdResult: 'lt-tdResult',
  resultLine: 'lt-resultLine',
  badgeOk: 'lt-badgeOk',
  badgeFailed: 'lt-badgeFailed',
  none: 'lt-none',
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
