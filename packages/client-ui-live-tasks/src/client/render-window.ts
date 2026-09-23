/**
 * Turn-group render windowing — the "virtual spacer" piece of record paging.
 *
 * The archive folds the whole session, so a long history means thousands of
 * rows in one table. Rows are grouped by turn and the table renders newest
 * first, so the window keeps the HEAD (the live tail the panel exists to show)
 * and cuts the OLDER tail: one spacer row at the bottom carries the hidden row
 * count and a button to expand. Cuts happen between turn groups — never inside
 * one — so step headers and turn context stay intact; that, plus rows having
 * variable heights, is why a scroll-math virtualizer would buy nothing here.
 *
 * @module soia-dsh-client-ui-live-tasks/client/render-window
 */

/** One turn group as the view renders it: anything with rows to count. */
export interface RenderGroup {
  /** Rows this group contributes to the table. */
  readonly entries: readonly unknown[]
}

/** Rows rendered before older groups are held behind the spacer. */
export const RENDER_STEP = 400

/** Head of the render list plus what the spacer hides. */
export interface RenderWindow<T extends RenderGroup> {
  /** Groups to render now (newest first, as the table draws them). */
  readonly shown: readonly T[]
  /** Rows hidden behind the spacer (including one head-equivalent per held group). */
  readonly hiddenRows: number
  /** Whether the spacer row should render. */
  readonly hasMore: boolean
}

/**
 * Keep head groups until the row budget runs out; hold the rest behind the spacer.
 * @param groups - turn groups in render order (newest first).
 * @param limit - row-equivalent budget (each group counts its rows + 1 header slot).
 * @returns the groups to render and what the spacer would reveal.
 */
export function windowGroups<T extends RenderGroup>(
  groups: readonly T[],
  limit: number,
): RenderWindow<T> {
  let used = 0
  let cut = groups.length
  for (let index = 0; index < groups.length; index += 1) {
    const cost = (groups[index]?.entries.length ?? 0) + 1
    // The first group always renders — a single oversized turn stays whole;
    // cuts only ever happen BETWEEN groups, and only once the budget is spent.
    if (index > 0 && used + cost > limit) {
      cut = index
      break
    }
    used += cost
  }
  const shown = groups.slice(0, cut)
  let hiddenRows = 0
  for (const group of groups.slice(cut)) hiddenRows += group.entries.length + 1
  return { shown, hiddenRows, hasMore: groups.length - cut > 0 }
}
