import { describe, expect, it } from 'vitest'
import type { Pt } from '../../../../src/renderer/features/canvas/drawing'
import { recognise } from '../../../../src/renderer/features/canvas/ink-shapes'

/** Draw and hold: a hand-drawn stroke and the clean shape it becomes - or none. */

/** A hand: points along the given corners, a little shaky. */
function drawn(corners: [number, number][], wobble = 2, every = 4): Pt[] {
  const out: Pt[] = []
  let k = 0
  for (let i = 1; i < corners.length; i++) {
    const [a, b] = [corners[i - 1]!, corners[i]!]
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / every))
    for (let j = 0; j < n; j++) {
      const t = j / n
      const shake = Math.sin(k++ * 0.45) * wobble
      out.push([a[0] + (b[0] - a[0]) * t + shake, a[1] + (b[1] - a[1]) * t - shake, 0.5])
    }
  }
  out.push([...corners[corners.length - 1]!, 0.5])
  return out
}

const span = (pts: Pt[]): { w: number; h: number } => ({
  w: Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])),
  h: Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])),
})

describe('draw and hold', () => {
  it('a nearly straight stroke becomes a straight line between its ends', () => {
    const r = recognise(drawn([[0, 0], [200, 10]]))!
    expect(r.shape).toBe('line')
    expect(r.points[0]!.slice(0, 2)).toEqual([0, 0].map((v, i) => drawn([[0, 0], [200, 10]])[0]![i]))
    // Every point on the line between the ends.
    const [a, b] = [r.points[0]!, r.points[r.points.length - 1]!]
    for (const p of r.points) expect(Math.abs((b[1] - a[1]) * p[0] - (b[0] - a[0]) * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThan(0.01)
  })

  it('a box drawn round, near square to the page, becomes a rectangle square to it', () => {
    const r = recognise(drawn([[0, 0], [200, 4], [204, 120], [2, 118], [0, 3]]))!
    expect(r.shape).toBe('rectangle')
    const s = span(r.points)
    expect(s.w).toBeGreaterThan(195)
    expect(s.h).toBeGreaterThan(110)
  })

  it('three corners round: a triangle', () => {
    expect(recognise(drawn([[0, 100], [100, 0], [200, 100], [2, 98]]))!.shape).toBe('triangle')
  })

  it('a round closed stroke: an ellipse', () => {
    const ring: Pt[] = Array.from({ length: 80 }, (_, i) => [100 + 80 * Math.cos((i / 79) * 2 * Math.PI) + Math.sin(i) * 1.5, 60 + 40 * Math.sin((i / 79) * 2 * Math.PI), 0.5] as Pt)
    expect(recognise(ring)!.shape).toBe('ellipse')
  })

  it('a long line with a head drawn back and forth at its end: an arrow', () => {
    expect(recognise(drawn([[0, 0], [200, 0], [180, -15], [200, 0], [180, 15]], 1))!.shape).toBe('arrow')
  })

  it('handwriting, a scribble or a dot is left as it is', () => {
    expect(recognise(drawn([[0, 0], [10, 30], [20, -5], [35, 25], [40, 0], [55, 30], [60, 2]]))).toBeNull()
    expect(recognise([[0, 0, 0.5], [1, 1, 0.5], [2, 0, 0.5]])).toBeNull()
  })
})
