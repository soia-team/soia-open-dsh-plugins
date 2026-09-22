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

/* 工具栏：与内置「轨迹」同样的控件位置（左搜索、右按钮），吸顶以保持可用 */
.lt-bar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 6px;
  padding: 4px 0; background: var(--dsw-alias-bg-base, #fff); }
.lt-search { flex: 1 1 220px; min-width: 140px; height: 26px; padding: 0 8px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-separator, rgb(0 0 0 / 16%)); background: transparent;
  color: var(--dsw-alias-label-primary); font-size: 12px; }
.lt-barButton, .lt-barOn { height: 26px; padding: 0 9px; border: 0; border-radius: 6px; cursor: pointer;
  font-size: 12px; background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 5%));
  color: var(--dsw-alias-label-secondary); }
.lt-barOn { background: rgb(64 120 255 / 18%); color: var(--dsw-alias-label-primary); font-weight: 600; }
.lt-barHint { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; }

/* 三泳道时间图：布局规格照内置「轨迹」（44px 标签列 / 50px 高 / span 8px / 泳道间距 14px） */
.lt-chartScroll { overflow-x: auto; overflow-y: hidden; padding-bottom: 2px; }
.lt-chart { display: grid; grid-template-columns: 44px minmax(0, 1fr); height: 50px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-2, rgb(0 0 0 / 2%)); border-radius: 8px; }
.lt-chartLabels { position: relative; border-right: .5px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 8%));
  color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 1; }
.lt-chartLabels span { position: absolute; right: 3px; height: 8px; display: flex; align-items: center; }
.lt-chartLabels span:nth-child(1) { top: 7px; }
.lt-chartLabels span:nth-child(2) { top: 21px; }
.lt-chartLabels span:nth-child(3) { top: 35px; }
.lt-chartTrack { position: relative; overflow: hidden; cursor: crosshair; touch-action: none; }
.lt-chartLanes { position: absolute; top: 7px; bottom: 7px; left: 0; right: 0; z-index: 2; }
.lt-chartBoundaries { position: absolute; top: 0; bottom: 0; left: 0; right: 0; z-index: 3; pointer-events: none; }
.lt-chartSelection { position: absolute; top: 0; bottom: 0; z-index: 4; pointer-events: none;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4078ff) 14%, transparent);
  border-left: 2px solid var(--dsw-alias-state-business-primary, #4078ff);
  border-right: 2px solid var(--dsw-alias-state-business-primary, #4078ff); }
.lt-chartBoundary { position: absolute; top: 0; bottom: 0; width: .5px; background: var(--dsw-alias-border-l2, rgb(0 0 0 / 12%)); }
.lt-span { position: absolute; height: 8px; min-width: 2px; padding: 0; border: 0; border-radius: 1px;
  cursor: pointer; opacity: .78; background: var(--dsw-alias-label-secondary); }
.lt-span[data-kind='user'] { background: var(--dsw-alias-state-business-primary, #4078ff); }
.lt-span[data-kind='context'] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #16a34a) 68%, var(--dsw-alias-label-secondary)); }
.lt-span[data-error='true'] { background: var(--dsw-alias-state-error-primary, #b42318); opacity: 1; }
.lt-span[data-selected='false'] { opacity: .2; }

/* 轮次横轴：宽度按该轮耗时分配（像素），超出宽度时横向滚动 */
.lt-axisScroll { overflow-x: auto; overflow-y: hidden; padding-bottom: 2px; }
.lt-axisScroll::-webkit-scrollbar { height: 8px; }
.lt-axisScroll::-webkit-scrollbar-thumb { background: var(--dsw-alias-separator, rgb(0 0 0 / 18%)); border-radius: 4px; }
.lt-axis { display: flex; gap: 2px; min-height: 26px; align-items: stretch; }
.lt-axisSegment, .lt-axisSegmentActive { position: relative; display: flex; align-items: center; justify-content: center;
  min-width: 30px; padding: 3px 6px; border: 0; border-radius: 5px; cursor: pointer;
  font-size: 11px; line-height: 16px; font-variant-numeric: tabular-nums;
  background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 6%)); color: var(--dsw-alias-label-secondary); }
.lt-axisSegmentActive { background: rgb(64 120 255 / 18%); color: var(--dsw-alias-label-primary); font-weight: 600; }
.lt-axisLabel { pointer-events: none; }
.lt-axisFailures { position: absolute; top: 1px; right: 3px; color: var(--dsw-alias-label-error, #b42318);
  font-size: 10px; font-weight: 700; }

/* 轮次明细：每轮一段，行可点开看参数与结果 */
.lt-turnList { display: flex; flex-direction: column; gap: 10px; }
.lt-turnSection { border-left: 2px solid var(--dsw-alias-separator, rgb(0 0 0 / 8%)); padding: 2px 0 2px 10px; }
.lt-turnSectionActive { border-left: 2px solid rgb(64 120 255 / 55%); padding: 2px 0 2px 10px; }
.lt-turnHead { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.lt-turnTitle { color: var(--dsw-alias-label-primary); }
.lt-turnMeta { color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.lt-toolList { display: flex; flex-direction: column; gap: 1px; margin: 4px 0 0; padding: 0; list-style: none; }
.lt-toolItem { display: flex; flex-direction: column; }
.lt-toolButton { display: grid; grid-template-columns: 62px 12px minmax(90px, max-content) 1fr auto auto; align-items: baseline;
  gap: 8px; width: 100%; padding: 3px 6px; border: 0; border-radius: 6px; background: transparent;
  text-align: left; font-size: 12.5px; line-height: 20px; cursor: pointer; }
.lt-toolButton:hover { background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 4%)); }
.lt-toolHint { color: var(--dsw-alias-label-tertiary); font-size: 11px; white-space: nowrap; }
.lt-toolDetail { display: flex; flex-direction: column; gap: 6px; margin: 2px 0 8px 88px;
  padding: 8px 10px; border-radius: 8px; background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 4%)); }
.lt-detailBlock { display: flex; flex-direction: column; gap: 3px; }
.lt-detailLabel { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.lt-detailPre { margin: 0; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-all;
  font-family: var(--dsw-font-mono, monospace); font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-primary); }
.lt-summaryLine { margin: -6px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }

/* 时间线：一条导轨 + 每行一个事件，视觉语言与内置「轨迹」一致 */
.lt-timeline { margin: 0; padding: 0; list-style: none; }
.lt-tlRow, .lt-tlTurn { display: grid; align-items: baseline; gap: 8px; font-size: 12.5px; line-height: 20px; }
.lt-tlRow { grid-template-columns: 18px 62px 40px 1fr auto; padding: 3px 0; }
.lt-tlTurn { grid-template-columns: 18px 1fr; padding: 10px 0 4px; }
.lt-tlRail { position: relative; display: flex; align-items: center; justify-content: center; align-self: stretch; }
.lt-tlRail::before { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 1px;
  background: var(--dsw-alias-separator, rgb(0 0 0 / 10%)); transform: translateX(-50%); }
.lt-tlRow:first-child .lt-tlRail::before { top: 50%; }
.lt-tlRow:last-child .lt-tlRail::before { bottom: 50%; }
.lt-tlRail > * { position: relative; z-index: 1; background: var(--dsw-alias-bg-base, #fff); border-radius: 50%; }
.lt-tlTurnDot { position: relative; z-index: 1; width: 5px; height: 5px; border-radius: 50%;
  background: var(--dsw-alias-label-tertiary); }
.lt-tlTurnLabel { font-weight: 600; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.lt-tlTime { color: var(--dsw-alias-label-tertiary); font-family: var(--dsw-font-mono, monospace); white-space: nowrap; }
.lt-tlBadge, .lt-tlBadgeTool { display: inline-block; padding: 0 5px; border-radius: 5px; font-size: 11px;
  line-height: 16px; text-align: center; }
.lt-tlBadge { color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 5%)); }
.lt-tlBadgeTool { color: var(--dsw-alias-label-secondary); background: rgb(64 120 255 / 10%); }
.lt-tlBody { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.lt-tlTitle { flex: none; font-weight: 600; font-family: var(--dsw-font-mono, monospace);
  color: var(--dsw-alias-label-primary); }
.lt-tlDetail, .lt-tlResult { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  font-family: var(--dsw-font-mono, monospace); }
.lt-tlDetail { color: var(--dsw-alias-label-secondary); max-width: 42%; }
.lt-tlArrow { flex: none; color: var(--dsw-alias-label-tertiary); }
.lt-tlResult { color: var(--dsw-alias-label-primary); }
.lt-tlTook, .lt-tlTookFailed { white-space: nowrap; font-size: 11.5px; font-variant-numeric: tabular-nums; }
.lt-tlTook { color: var(--dsw-alias-label-tertiary); }
.lt-tlTookFailed { color: var(--dsw-alias-label-error, #b42318); }

/* 会话头指示器：在 对话/轨迹 页也能看到当前工具 */
.lt-headerChip { display: inline-flex; align-items: center; gap: 5px; min-height: 24px; padding: 2px 8px;
  border: 0; border-radius: 999px; background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 5%));
  color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; cursor: default; }
.lt-headerChipLabel { font-family: var(--dsw-font-mono, monospace); }

/* 顶部工具行：不展开表格也能看到"现在用哪个工具" */
.lt-toolLine { display: flex; align-items: baseline; gap: 8px; margin: -4px 0 0; }
.lt-toolLineLabel { font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
.lt-toolLineValue { font-size: 13px; font-weight: 600; font-family: var(--dsw-font-mono, monospace);
  color: var(--dsw-alias-label-primary); }

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

/* 轮次内的步骤分组（与轨迹一致） */
.lt-stepGroup { display: flex; flex-direction: column; }
.lt-stepLabel { margin: 6px 0 2px 6px; color: var(--dsw-alias-label-tertiary); font-size: 11px;
  letter-spacing: .02em; }

/* 详情：概览网格 + 参数/结果 */
.lt-detailGrid { display: grid; grid-template-columns: 64px 1fr; gap: 2px 10px; margin: 0; }
.lt-detailGrid dt { color: var(--dsw-alias-label-tertiary); }
.lt-detailGrid dd { margin: 0; color: var(--dsw-alias-label-primary); }

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
  headerChip: 'lt-headerChip',
  headerChipLabel: 'lt-headerChipLabel',
  toolLine: 'lt-toolLine',
  toolLineLabel: 'lt-toolLineLabel',
  toolLineValue: 'lt-toolLineValue',
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
  bar: 'lt-bar',
  search: 'lt-search',
  barButton: 'lt-barButton',
  barOn: 'lt-barOn',
  barHint: 'lt-barHint',
  axisScroll: 'lt-axisScroll',
  stepGroup: 'lt-stepGroup',
  stepLabel: 'lt-stepLabel',
  detailGrid: 'lt-detailGrid',
  detailBlock: 'lt-detailBlock',
  detailLabel: 'lt-detailLabel',
  detailPre: 'lt-detailPre',
  chartScroll: 'lt-chartScroll',
  chart: 'lt-chart',
  chartLabels: 'lt-chartLabels',
  chartTrack: 'lt-chartTrack',
  chartLanes: 'lt-chartLanes',
  chartBoundaries: 'lt-chartBoundaries',
  chartBoundary: 'lt-chartBoundary',
  chartSelection: 'lt-chartSelection',
  span: 'lt-span',
  axis: 'lt-axis',
  axisSegment: 'lt-axisSegment',
  axisSegmentActive: 'lt-axisSegmentActive',
  axisLabel: 'lt-axisLabel',
  axisFailures: 'lt-axisFailures',
  turnList: 'lt-turnList',
  turnSection: 'lt-turnSection',
  turnSectionActive: 'lt-turnSectionActive',
  turnHead: 'lt-turnHead',
  turnTitle: 'lt-turnTitle',
  turnMeta: 'lt-turnMeta',
  toolList: 'lt-toolList',
  toolItem: 'lt-toolItem',
  toolButton: 'lt-toolButton',
  toolHint: 'lt-toolHint',
  toolDetail: 'lt-toolDetail',
  summaryLine: 'lt-summaryLine',
  timeline: 'lt-timeline',
  tlRow: 'lt-tlRow',
  tlTurn: 'lt-tlTurn',
  tlRail: 'lt-tlRail',
  tlTurnDot: 'lt-tlTurnDot',
  tlTurnLabel: 'lt-tlTurnLabel',
  tlTime: 'lt-tlTime',
  tlBadge: 'lt-tlBadge',
  tlBadgeTool: 'lt-tlBadgeTool',
  tlBody: 'lt-tlBody',
  tlTitle: 'lt-tlTitle',
  tlDetail: 'lt-tlDetail',
  tlArrow: 'lt-tlArrow',
  tlResult: 'lt-tlResult',
  tlTook: 'lt-tlTook',
  tlTookFailed: 'lt-tlTookFailed',
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
