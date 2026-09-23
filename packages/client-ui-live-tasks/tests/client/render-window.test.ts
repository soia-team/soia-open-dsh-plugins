import { describe, expect, it } from 'vitest'
import { RENDER_STEP, windowGroups } from '../../src/client/render-window.ts'

const group = (turn: number, rows: number) => ({ turn, entries: Array.from({ length: rows }, (_, i) => i) })

describe('windowGroups', () => {
  it('renders everything under the budget and hides nothing', () => {
    const result = windowGroups([group(3, 2), group(2, 2)], RENDER_STEP)
    expect(result.shown).toHaveLength(2)
    expect(result.hasMore).toBe(false)
    expect(result.hiddenRows).toBe(0)
  })

  it('keeps the head (newest) groups and counts the held tail for the spacer', () => {
    const groups = [group(9, 5), group(8, 5), group(7, 5), group(6, 5)]
    // Budget 12 = exactly two groups (5+1 + 5+1); the third would exceed it.
    const result = windowGroups(groups, 12)
    expect(result.shown.map((entry) => entry.turn)).toEqual([9, 8])
    expect(result.hasMore).toBe(true)
    // Held groups count rows + one header slot each, the way the spacer claims.
    expect(result.hiddenRows).toBe(5 + 1 + 5 + 1)
  })

  it('never cuts inside a group: even one oversized group renders whole', () => {
    const result = windowGroups([group(9, 500)], 10)
    expect(result.shown).toHaveLength(1)
    expect(result.hasMore).toBe(false)
  })

  it('an empty list stays empty', () => {
    const result = windowGroups([], RENDER_STEP)
    expect(result.shown).toHaveLength(0)
    expect(result.hasMore).toBe(false)
  })
})
