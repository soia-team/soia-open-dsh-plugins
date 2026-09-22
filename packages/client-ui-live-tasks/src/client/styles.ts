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
.lt-view { display: flex; flex-direction: column; gap: 18px; padding: 18px 20px; }
.lt-head { display: flex; align-items: center; gap: 8px; }
.lt-elapsed { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; }

/* 模块：统一的标题层级与间距，让每块自成一段 */
.lt-section { display: flex; flex-direction: column; gap: 8px; }
.lt-sectionHead { display: flex; align-items: center; gap: 10px; }
.lt-sectionTitle { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--dsw-alias-label-tertiary); }

/* 模块一：概览卡网格 */
.lt-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 8px; }
.lt-stat { display: flex; flex-direction: column; gap: 3px; padding: 9px 11px; border-radius: 10px;
  background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 4%)); }
.lt-statLabel { font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
.lt-statValue { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums; }
.lt-statValueFailed { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-error, #b42318); }

/* 模块二：正在跑 */
.lt-list { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
.lt-call { display: grid; grid-template-columns: 10px 150px 1fr auto; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 8px; font-size: 13px; line-height: 18px;
  background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 4%)); }
.lt-callTook { color: var(--dsw-alias-label-tertiary); font-size: 12px; }

/* 模块三：动作日志 */
.lt-filters { margin-left: auto; display: flex; gap: 4px; }
.lt-filter, .lt-filterActive { padding: 2px 8px; border: 0; border-radius: 999px; cursor: pointer;
  font-size: 11.5px; line-height: 18px; }
.lt-filter { color: var(--dsw-alias-label-tertiary); background: transparent; }
.lt-filter:hover { background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 5%)); }
.lt-filterActive { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 7%)); }
.lt-table { width: 100%; border-collapse: collapse; font-size: 12.5px; line-height: 18px; }
.lt-th { padding: 4px 8px; text-align: left; font-weight: 600; color: var(--dsw-alias-label-tertiary);
  border-bottom: 1px solid var(--dsw-alias-separator, rgb(0 0 0 / 8%)); white-space: nowrap; }
.lt-table tbody tr:nth-child(odd) { background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 3%)); }
.lt-rowFailed { background: rgb(180 35 24 / 6%) !important; }
.lt-tdTime { padding: 5px 8px; color: var(--dsw-alias-label-tertiary); font-family: var(--dsw-font-mono, monospace); white-space: nowrap; }
.lt-tdTool { padding: 5px 8px; white-space: nowrap; }
.lt-tdWhat { padding: 5px 8px; max-width: 260px; }
.lt-tdTook { padding: 5px 8px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; font-variant-numeric: tabular-nums; }
.lt-tdResult { padding: 5px 8px; }
.lt-resultLine { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  max-width: 260px; color: var(--dsw-alias-label-primary); }
.lt-badgeOk, .lt-badgeFailed { display: inline-block; margin-top: 2px; padding: 0 6px; border-radius: 6px;
  font-size: 11px; line-height: 16px; }
.lt-badgeOk { color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 5%)); }
.lt-badgeFailed { color: var(--dsw-alias-label-error, #b42318); background: rgb(180 35 24 / 10%); }

/* 模块五：运行状况 */
.lt-health { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.lt-healthStale { color: var(--dsw-alias-label-error, #b42318); }

/* 共用 */
.lt-toolName { color: var(--dsw-alias-label-primary); font-weight: 600; font-family: var(--dsw-font-mono, monospace); }
.lt-callDetail, .lt-tdWhat { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  font-family: var(--dsw-font-mono, monospace); color: var(--dsw-alias-label-secondary); }
.lt-none { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12.5px; }
.lt-empty { display: flex; align-items: center; gap: 8px; padding: 24px 20px;
  color: var(--dsw-alias-label-tertiary); font-size: 13px; }
`

/** Class names this view applies. */
export const styles = {
  view: 'lt-view',
  head: 'lt-head',
  elapsed: 'lt-elapsed',
  section: 'lt-section',
  sectionHead: 'lt-sectionHead',
  sectionTitle: 'lt-sectionTitle',
  stats: 'lt-stats',
  stat: 'lt-stat',
  statLabel: 'lt-statLabel',
  statValue: 'lt-statValue',
  statValueFailed: 'lt-statValueFailed',
  list: 'lt-list',
  call: 'lt-call',
  callDetail: 'lt-callDetail',
  callTook: 'lt-callTook',
  filters: 'lt-filters',
  filter: 'lt-filter',
  filterActive: 'lt-filterActive',
  table: 'lt-table',
  th: 'lt-th',
  rowFailed: 'lt-rowFailed',
  tdTime: 'lt-tdTime',
  tdTool: 'lt-tdTool',
  tdWhat: 'lt-tdWhat',
  tdTook: 'lt-tdTook',
  tdResult: 'lt-tdResult',
  resultLine: 'lt-resultLine',
  badgeOk: 'lt-badgeOk',
  badgeFailed: 'lt-badgeFailed',
  health: 'lt-health',
  healthStale: 'lt-healthStale',
  toolName: 'lt-toolName',
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
