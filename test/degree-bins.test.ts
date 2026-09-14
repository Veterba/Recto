import { describe, expect, it } from 'vitest'
import { ALL_LINKS, binOf, binsToRange, coerceLinkRange, DEGREE_BINS, histogram, inRange, rangeToBins } from '../src/renderer/graph/degree-bins'

describe('degree bins', () => {
  it('puts every link count in exactly one bin', () => {
    for (const degree of [0, 1, 2, 3, 4, 5, 8, 9, 16, 17, 64, 65, 5000]) {
      const bin = DEGREE_BINS[binOf(degree)]!
      expect(degree).toBeGreaterThanOrEqual(bin.min)
      expect(degree).toBeLessThanOrEqual(bin.max)
    }
  })

  it('counts a histogram', () => {
    expect(histogram([0, 0, 1, 3, 4, 100]).slice(0, 4)).toEqual([2, 1, 0, 2])
  })

  it('round-trips a range through bins, with the last bin meaning no limit', () => {
    expect(binsToRange(...rangeToBins(ALL_LINKS))).toEqual(ALL_LINKS)
    expect(binsToRange(3, 5)).toEqual({ min: 3, max: 16 })
    expect(rangeToBins({ min: 3, max: 16 })).toEqual([3, 5])
  })

  it('filters by the range', () => {
    expect(inRange(0, ALL_LINKS)).toBe(true)
    expect(inRange(900, ALL_LINKS)).toBe(true)
    expect(inRange(2, { min: 3, max: null })).toBe(false)
    expect(inRange(17, { min: 3, max: 16 })).toBe(false)
  })

  it('reads a saved range defensively', () => {
    expect(coerceLinkRange(undefined)).toEqual(ALL_LINKS)
    expect(coerceLinkRange({ min: -4, max: 'x' })).toEqual(ALL_LINKS)
    expect(coerceLinkRange({ min: 5, max: 2 })).toEqual({ min: 5, max: null })
  })
})
