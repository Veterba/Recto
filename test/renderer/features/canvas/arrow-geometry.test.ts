import { describe, expect, it } from 'vitest'
import type { CanvasEdge } from '../../../../src/shared/canvas'
import {
  anchorAt,
  anchorsOf,
  arrowShape,
  bendOf,
  bendTowards,
  CENTRE,
  isPinned,
  pointIn,
} from '../../../../src/renderer/features/canvas/arrow-geometry'

const A = { x: 0, y: 0, width: 100, height: 100 }
const B = { x: 300, y: 0, width: 100, height: 100 }
const close = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
  expect(a.x).toBeCloseTo(b.x, 1)
  expect(a.y).toBeCloseTo(b.y, 1)
}

describe('arrow geometry', () => {
  it('a straight arrow between two centres is cut at both borders', () => {
    const s = arrowShape({ at: pointIn(A, CENTRE), cut: A }, { at: pointIn(B, CENTRE), cut: B }, 0)
    close(s.start, { x: 100, y: 50 })
    close(s.end, { x: 300, y: 50 })
    close(s.mid, { x: 200, y: 50 })
    expect(s.d.startsWith('M')).toBe(true)
    expect(s.d).toContain('L')
  })

  it('a free end is not cut', () => {
    const s = arrowShape({ at: pointIn(A, CENTRE), cut: A }, { at: { x: 500, y: 50 }, cut: null }, 0)
    close(s.end, { x: 500, y: 50 })
  })

  it('a bent arrow is an arc whose middle is pushed sideways by the bend, and still leaves at the borders', () => {
    const s = arrowShape({ at: pointIn(A, CENTRE), cut: A }, { at: pointIn(B, CENTRE), cut: B }, 80)
    expect(s.d).toContain('A')
    // Its left, going right on screen: up.
    expect(s.mid.y).toBeLessThan(0)
    expect(s.start.x).toBeLessThanOrEqual(100.5)
    expect(s.end.x).toBeGreaterThanOrEqual(299.5)
  })

  it('a bent arrow’s middle (label, bend handle) is half way along what is drawn, not near an end', () => {
    const from = { x: 560, y: 260, width: 160, height: 110 }
    const to = { x: 880, y: 300, width: 150, height: 150 }
    const s = arrowShape({ at: pointIn(from, CENTRE), cut: from }, { at: pointIn(to, CENTRE), cut: to }, -60)
    const along = (p: { x: number; y: number }): number => Math.hypot(p.x - s.start.x, p.y - s.start.y)
    expect(Math.abs(along(s.mid) - Math.hypot(s.end.x - s.mid.x, s.end.y - s.mid.y))).toBeLessThan(5)
  })

  it('a bend past a half circle still goes through the bent middle', () => {
    const s = arrowShape({ at: { x: 0, y: 0 }, cut: null }, { at: { x: 100, y: 0 }, cut: null }, -150)
    expect(s.d).toMatch(/A[\d.]+ [\d.]+ 0 1 /)
    close(s.mid, { x: 50, y: 150 })
  })

  it('dragging the middle handle gives the bend, none near the straight line', () => {
    expect(bendTowards({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: -40 }, 5)).toBe(40)
    expect(bendTowards({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 3 }, 5)).toBe(0)
  })

  it('a pin near the middle of a node is its centre; elsewhere it is where it was put', () => {
    expect(anchorAt(A, { x: 55, y: 45 })).toEqual(CENTRE)
    expect(anchorAt(A, { x: 10, y: 90 })).toEqual({ x: 0.1, y: 0.9 })
  })

  it('pins and bend are read from the edge’s style keys; an Obsidian edge has none', () => {
    const edge: CanvasEdge = { id: 'e', fromNode: 'a', toNode: 'b', styleAttributes: { fromAnchor: '0.5,0.5', toAnchor: '0.1,0.9', bend: '40' } }
    expect(anchorsOf(edge)).toEqual({ from: CENTRE, to: { x: 0.1, y: 0.9 } })
    expect(bendOf(edge)).toBe(40)
    expect(isPinned(edge)).toBe(true)
    expect(isPinned({ id: 'o', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left' })).toBe(false)
  })
})
