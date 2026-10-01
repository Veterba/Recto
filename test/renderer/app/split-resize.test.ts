import { describe, expect, it } from 'vitest'
import { MIN_PANE_PX, boundaryOf, evenPair, resizeSplit } from '../../../src/renderer/app/split-resize'

const px = (sizes: number[], total: number): number[] => sizes.map((s) => Math.round(s * total * 1000) / 1000)

describe('split resize', () => {
  it('puts the divider where the pointer is, in the container', () => {
    expect(boundaryOf([0.5, 0.5], 0, 1000)).toBe(500)
    expect(px(resizeSplit({ sizes: [0.5, 0.5], index: 0, total: 1000, boundaryPx: 600 }), 1000)).toEqual([600, 400])
  })

  it('is absolute: the same pointer position gives the same sizes however it got there', () => {
    // Each move computed from the sizes at the press and the pointer now -
    // summing deltas instead ran the divider off to one end.
    const start = [0.5, 0.5]
    let sizes = start
    for (let x = 510; x <= 600; x += 10) sizes = resizeSplit({ sizes: start, index: 0, total: 1000, boundaryPx: x })
    expect(px(sizes, 1000)).toEqual([600, 400])
  })

  it('stops at the minimum on either side; nothing collapses', () => {
    expect(px(resizeSplit({ sizes: [0.5, 0.5], index: 0, total: 1000, boundaryPx: 10 }), 1000)).toEqual([MIN_PANE_PX, 1000 - MIN_PANE_PX])
    expect(px(resizeSplit({ sizes: [0.5, 0.5], index: 0, total: 1000, boundaryPx: 5000 }), 1000)).toEqual([1000 - MIN_PANE_PX, MIN_PANE_PX])
    expect(px(resizeSplit({ sizes: [0.5, 0.5], index: 0, total: 1000, boundaryPx: -300 }), 1000)).toEqual([MIN_PANE_PX, 1000 - MIN_PANE_PX])
  })

  it('when the two panes cannot both have the minimum, they share evenly', () => {
    expect(px(resizeSplit({ sizes: [0.3, 0.7], index: 0, total: 400, boundaryPx: 20 }), 400)).toEqual([200, 200])
  })

  it('moves only the two panes either side of the divider', () => {
    const sizes = [0.25, 0.25, 0.5]
    const next = resizeSplit({ sizes, index: 1, total: 2000, boundaryPx: 1200 })
    expect(px(next, 2000)).toEqual([500, 700, 800])
    // The same arithmetic stacked, for a horizontal split: only the axis differs.
    expect(next.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })

  it('a custom minimum is honoured', () => {
    expect(px(resizeSplit({ sizes: [0.5, 0.5], index: 0, total: 1000, boundaryPx: 0, minPx: 100 }), 1000)).toEqual([100, 900])
  })

  it('ignores a divider that does not exist', () => {
    expect(resizeSplit({ sizes: [0.5, 0.5], index: 1, total: 1000, boundaryPx: 10 })).toEqual([0.5, 0.5])
    expect(resizeSplit({ sizes: [0.5, 0.5], index: 0, total: 0, boundaryPx: 10 })).toEqual([0.5, 0.5])
  })

  it('double-click evens the pair, leaving the rest', () => {
    expect(evenPair([0.2, 0.8], 0)).toEqual([0.5, 0.5])
    expect(evenPair([0.2, 0.2, 0.6], 1)).toEqual([0.2, 0.4, 0.4])
  })
})
