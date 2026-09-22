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
/* One place for the row grid: the rows, their header and the detail indentation
   all read these, so a column change cannot leave them out of line. */
.lt-view { display: flex; flex-direction: column; gap: 18px; padding: 18px 20px;
  --lt-col-time: 84px; --lt-col-kind: 44px; --lt-col-took: 64px; --lt-gap: 8px;
  /* Narrow windows narrow the columns instead of squeezing the payload, and the
     row keeps a floor so the timeline scrolls sideways rather than clipping. */
  container: lt-panel / inline-size; }
@container lt-panel (width <= 620px) {
  .lt-view { --lt-col-time: 50px; --lt-col-kind: 20px; }
  .lt-kindTag { padding: 0; justify-content: center; }
}
.lt-head { display: flex; align-items: center; gap: 8px; }
.lt-elapsed { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; }

/* 模块：统一的标题层级与间距，让每块自成一段 */
.lt-section { display: flex; flex-direction: column; gap: 8px; }
.lt-sectionHead { display: flex; align-items: center; gap: 10px; }
.lt-sectionTitle { margin: 0; font: var(--dsw-font-xs-strong-13, 600 13px/18px inherit);
  color: var(--dsw-alias-label-secondary); user-select: none; }

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
/* 轮次导轨：与轨迹同规格（2px、accent 色、贯穿该轮所有行） */
.lt-turnSection, .lt-turnSectionActive { position: relative; padding: 2px 0 2px 12px; }
.lt-turnSection { border-left: 2px solid transparent; }
.lt-turnSectionActive { border-left: 2px solid transparent; }
.lt-turnSectionActive { border-left-color: var(--soia-turn-accent, color-mix(in srgb, var(--dsw-static-blue-500, #4078ff) 45%, transparent)); }
.lt-turnRail { position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
  background: color-mix(in srgb, var(--dsw-static-blue-500, #4078ff) 22%, var(--dsw-alias-bg-layer-1, transparent)); }
.lt-turnHead { display: flex; align-items: center; gap: 8px; min-height: 26px; font-size: 12px; }
/* 轮次标签：与轨迹的 turnLabel 同规格（胶囊、字距、accent 背景） */
.lt-turnLabel, .lt-turnLabelActive { padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 650;
  letter-spacing: .035em; }
.lt-turnLabel { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 4%)); }
.lt-turnLabelActive { color: var(--dsw-alias-label-primary);
  background: color-mix(in srgb, var(--dsw-static-blue-500, #4078ff) 22%, var(--dsw-alias-bg-layer-1, #fff)); }
.lt-turnMeta { color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
/* The timeline scrolls as one pane, both ways: vertical for length, horizontal
   for a narrow window, where the rows keep a floor width instead of clipping. */
.lt-scroll { min-width: 0; max-height: 62vh; overflow: auto; }

/* ── Table structure, copied from the trajectory view ────────────────────────
   Same two-column table, same 30px rows, same half-pixel separators, same hover
   and selection tokens, same container-query widths. The panel is meant to look
   like a sibling of that view, so its numbers are taken from it rather than
   invented here. */
.lt-tablePane { box-sizing: border-box; min-width: 0; width: 100%; max-height: 62vh;
  position: relative; overflow: auto; container: lt-panel / inline-size; }
.lt-table { width: 100%; min-width: 640px; border-collapse: collapse; table-layout: fixed; }
.lt-table td { box-sizing: border-box; height: 30px; padding: 0 8px; overflow: hidden;
  border-bottom: .5px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 8%));
  white-space: nowrap; text-overflow: ellipsis; vertical-align: middle; }
.lt-table tbody tr { transition: background-color .12s var(--ds-ease-in-out, ease-in-out); }
.lt-table tbody tr:hover { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 4%)); }
.lt-table tbody tr[data-selected='true'] { background: var(--dsw-alias-interactive-bg-active, rgb(64 120 255 / 10%)); }
.lt-table tbody tr[data-dim='true'] { opacity: .24; }
.lt-table tbody tr[data-picked='true'] { background: var(--dsw-alias-interactive-bg-active, rgb(64 120 255 / 10%)); }
.lt-table tbody tr[data-turn-start='true'] td { position: relative; overflow: visible; }
.lt-table tbody tr[data-turn-start='true']:not(:first-child) td::before {
  content: ''; position: absolute; inset: 0 0 auto; height: 2px; transform: translateY(-50%);
  background: var(--dsw-alias-border-l1, rgb(0 0 0 / 8%)); pointer-events: none; z-index: 1; }
.lt-eventColumn { width: 84px; }
@container lt-panel (width <= 620px) {
  /* The trajectory view narrows this column to 50px because its chip is a 13px
     icon there; ours is a word, so it narrows less — the row still scrolls
     sideways rather than clipping. */
  .lt-eventColumn { width: 64px; }
  .lt-kindTag { padding: 0 4px; }
  .lt-tlEntryId { display: none; }
}
.lt-eventCell { position: relative; overflow: visible; padding-left: 12px !important; padding-right: 4px !important; }
/* The trajectory view puts a dot at the left of every row, on the same vertical
   line the turn rail runs down; without it the gutter reads as empty space. */
.lt-eventCell::after { content: ''; position: absolute; left: 15px; top: 50%; width: 4px; height: 4px;
  border-radius: 50%; transform: translateY(-50%); background: var(--dsw-alias-label-caption); pointer-events: none; }
.lt-turnRow .lt-eventCell::after { display: none; }
.lt-contentColumn { width: auto; }
.lt-contentCell { min-width: 0; color: var(--dsw-alias-label-primary); padding-left: 4px !important; }
.lt-rowButton { display: flex; align-items: center; gap: 6px; width: 100%; height: 30px; padding: 0;
  border: 0; background: transparent; text-align: left; font-size: 12.5px; line-height: 20px; cursor: pointer; }
.lt-rowButton:focus-visible { outline: none; box-shadow: inset 0 0 0 1px var(--dsw-alias-state-business-primary); }
.lt-turnRow td { height: 26px; }
.lt-turnRail { position: absolute; left: 0; top: -1px; bottom: -1px; width: 2px; z-index: 4;
  background: var(--soia-turn-accent, color-mix(in srgb, var(--dsw-static-blue-500, #4078ff) 22%, var(--dsw-alias-bg-layer-1, #fff))); }
.lt-stepRow td { height: 22px; border-bottom: 0; }
.lt-stepLabel { color: var(--dsw-alias-label-tertiary); font-size: 11px; font-weight: 600; letter-spacing: .03em; }
.lt-detailRow > td { height: auto; white-space: normal; padding: 0 !important; border-bottom: .5px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 8%)); }
.lt-detailCell { background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 3%)); }
.lt-turnMeta { margin-right: 12px; }

/* ── Panes and the detail drawer ────────────────────────────────────────────
   The trajectory view opens a row's detail as a right-hand pane with a 42px
   header, a tab strip and a scrolling body; an inline block under the row pushed
   every later row down and could not be read against the row it described. */
.lt-panes { display: flex; align-items: flex-start; gap: 16px; min-width: 0; }
.lt-paneMain { display: flex; flex-direction: column; gap: 18px; flex: 1; min-width: 0; }
.lt-details { display: flex; flex-direction: column; flex: none; width: 380px; max-height: 78vh;
  /* The shell scrolls the whole view; without this the tab strip rides up out of
     the viewport (measured at y=-94 on a live session) and the drawer cannot be
     used without scrolling back to the top. The trajectory view keeps its pane
     pinned the same way. */
  position: sticky; top: 8px; align-self: flex-start; z-index: 1;
  border: 1px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 8%)); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #fff); overflow: hidden; }
.lt-detailsHeader { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  box-sizing: border-box; height: 42px; padding: 0 8px 0 12px; flex: none;
  border-bottom: .5px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 14%)); }
.lt-detailsTitle { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--dsw-alias-label-primary); }
.lt-detailsName { font-weight: 600; }
.lt-detailsLocation { min-width: 0; color: var(--dsw-alias-label-tertiary);
  font: 11px/16px var(--dsw-font-mono, monospace); text-overflow: ellipsis; white-space: nowrap; overflow: hidden; }
.lt-detailsClose { flex: none; width: 22px; height: 22px; border: 0; border-radius: 4px; cursor: pointer;
  background: transparent; color: var(--dsw-alias-label-tertiary); font-size: 15px; line-height: 1; }
.lt-detailsClose:hover { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 6%)); }
.lt-detailTabs { display: flex; flex: none; overflow-x: auto; border-bottom: .5px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 8%)); }
.lt-detailTabs::-webkit-scrollbar { display: none; }
.lt-detailTab, .lt-detailTabActive { flex: none; position: relative; padding: 6px 9px; border: 0;
  background: transparent; cursor: pointer; font: var(--dsw-font-xs-13, 13px/18px inherit); }
.lt-detailTab { color: var(--dsw-alias-label-tertiary); }
.lt-detailTabActive { color: var(--dsw-alias-state-business-primary, #4078ff); }
.lt-detailTabActive::after { content: ''; position: absolute; bottom: 0; left: 9px; right: 9px; height: 2px;
  border-radius: 1px 1px 0 0; background: var(--dsw-alias-state-business-primary, #4078ff); }
.lt-detailBody { flex: 1; min-height: 0; overflow: auto; padding: 10px 12px; }
.lt-detailBody .lt-detailPre { max-height: none; }
.lt-toolList { display: flex; flex-direction: column; margin: 4px 0 0; padding: 0; list-style: none; }
.lt-toolItem { display: flex; flex-direction: column; }
/* Rows follow the trajectory view's table: one 30px line each, a half-pixel
   separator, no card chrome. Floating rounded rows read as a different product. */
.lt-toolButton { display: grid;
  grid-template-columns: var(--lt-col-time) var(--lt-col-kind) minmax(0, 1fr) var(--lt-col-took) 12px;
  align-items: center; gap: var(--lt-gap);
  box-sizing: border-box; width: 100%; height: 30px; padding: 0 8px;
  border: 0; border-bottom: .5px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 8%));
  border-radius: 0; background: transparent;
  text-align: left; font-size: 12.5px; line-height: 20px; cursor: pointer;
  transition: background-color .12s var(--ds-ease-in-out, ease-in-out); }
.lt-toolButton:hover { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 4%)); }
.lt-toolButton[data-selected='true'] { background: var(--dsw-alias-interactive-bg-active, rgb(64 120 255 / 10%)); }
/* A row outside the selected range dims the way the trajectory view dims its own. */
.lt-toolItem[data-dim='true'] { opacity: .24; }

/* 类型徽标：照抄轨迹 kindSlot / kindTag 的规格（中文槽宽 44px、标签高 19px、圆角 4px、10px/650、字距 .035em） */
.lt-kindSlot { display: flex; justify-content: flex-end; align-items: center; width: 44px; flex: none; }
.lt-kindTag { box-sizing: border-box; display: inline-flex; align-items: center; height: 19px; padding: 0 5px;
  border: 1px solid transparent; border-radius: 4px; font-size: 10px; font-weight: 650; line-height: 16px;
  letter-spacing: .035em; user-select: none; white-space: nowrap;
  color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 6%)); }
.lt-kindTag[data-kind='user'] { color: var(--dsw-alias-state-business-primary, #2b5cd9);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4078ff) 14%, transparent); }
.lt-kindTag[data-kind='context'] { color: var(--dsw-alias-state-success-primary, #18794e);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #16a34a) 14%, transparent); }
.lt-kindTag[data-kind='assistant'] { color: var(--dsw-alias-brand-primary-new-colorprimary-new-color, #6b4bd6);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color, #7c5cff) 14%, transparent); }
.lt-kindTag[data-kind='tool'] { color: var(--dsw-alias-state-warn-label, #96540a);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-label, #d97706) 16%, transparent); }
/* Failure wins over the kind tint: the row's outcome is what a reader scans for. */
.lt-kindTag[data-kind][data-failed='true'] { color: var(--dsw-alias-state-error-primary, #b42318);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #b42318) 16%, transparent); }
.lt-toolButton:hover { background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 4%)); }
.lt-toolHint { color: var(--dsw-alias-label-tertiary); font-size: 11px; white-space: nowrap; }
.lt-toolDetail { display: flex; flex-direction: column; gap: 10px;
  /* Indented to the payload column, computed from the same grid constants. */
  margin: 4px 0 10px calc(var(--lt-col-time) + var(--lt-col-kind) + var(--lt-gap) * 2 + 6px);
  padding: 10px 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-separator, rgb(0 0 0 / 8%));
  background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 3%)); }
.lt-detailBlock { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.lt-detailLabel { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.lt-detailPre { margin: 0; max-height: 168px; overflow: auto; padding: 6px 8px; border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1, #fff); white-space: pre-wrap; word-break: break-word;
  font-family: var(--dsw-font-mono, monospace); font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-primary); }
.lt-summaryLine { margin: -6px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.lt-usageLine { margin: -2px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px;
  font-variant-numeric: tabular-nums; }

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
.lt-tlTime { color: var(--dsw-alias-label-caption); font-family: var(--dsw-font-mono, monospace);
  font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lt-tlBadge, .lt-tlBadgeTool { display: inline-block; padding: 0 5px; border-radius: 5px; font-size: 11px;
  line-height: 16px; text-align: center; }
.lt-tlBadge { color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-bg-base-secondary, rgb(0 0 0 / 5%)); }
.lt-tlBadgeTool { color: var(--dsw-alias-label-secondary); background: rgb(64 120 255 / 10%); }
.lt-tlBody { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.lt-tlTitle { flex: none; font-weight: 600; font-family: var(--dsw-font-mono, monospace);
  color: var(--dsw-alias-label-primary); }
.lt-tlEntryId { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 11px;
  font-family: var(--dsw-font-mono, monospace); }
.lt-detailMono { font-family: var(--dsw-font-mono, monospace); }
.lt-tlArgs { flex: none; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-secondary); font-family: var(--dsw-font-mono, monospace); }
.lt-tlDetail, .lt-tlResult { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  font-family: var(--dsw-font-mono, monospace); }
.lt-tlDetail { color: var(--dsw-alias-label-secondary); max-width: 42%; }
.lt-tlArrow { flex: none; color: var(--dsw-alias-label-tertiary); }
.lt-tlResult { color: var(--dsw-alias-label-primary); }
.lt-tlTook, .lt-tlTookFailed { white-space: nowrap; font-size: 11.5px; font-variant-numeric: tabular-nums;
  min-width: 64px; text-align: right; }
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
.lt-detailGrid { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 3px 12px; margin: 0; }
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
  turnMeta: 'lt-turnMeta',
  toolList: 'lt-toolList',
    tablePane: 'lt-tablePane',
    eventColumn: 'lt-eventColumn',
    contentColumn: 'lt-contentColumn',
    row: 'lt-row',
    eventCell: 'lt-eventCell',
    contentCell: 'lt-contentCell',
    rowButton: 'lt-rowButton',
    turnRow: 'lt-turnRow',
    stepRow: 'lt-stepRow',
    detailRow: 'lt-detailRow',
    detailCell: 'lt-detailCell',
    turnBody: 'lt-turnBody',
    panes: 'lt-panes',
    paneMain: 'lt-paneMain',
    details: 'lt-details',
    detailsHeader: 'lt-detailsHeader',
    detailsTitle: 'lt-detailsTitle',
    detailsName: 'lt-detailsName',
    detailsLocation: 'lt-detailsLocation',
    detailsClose: 'lt-detailsClose',
    detailTabs: 'lt-detailTabs',
    detailTab: 'lt-detailTab',
    detailTabActive: 'lt-detailTabActive',
    detailBody: 'lt-detailBody',
  scroll: 'lt-scroll',
  rowsInner: 'lt-rowsInner',
  toolItem: 'lt-toolItem',
  toolButton: 'lt-toolButton',
  toolHint: 'lt-toolHint',
  kindSlot: 'lt-kindSlot',
  kindTag: 'lt-kindTag',
  turnRail: 'lt-turnRail',
  turnLabel: 'lt-turnLabel',
  turnLabelActive: 'lt-turnLabelActive',
  toolDetail: 'lt-toolDetail',
  summaryLine: 'lt-summaryLine',
  usageLine: 'lt-usageLine',
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
  tlEntryId: 'lt-tlEntryId',
  tlArgs: 'lt-tlArgs',
  detailMono: 'lt-detailMono',
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
