import { describe, expect, it } from 'vitest'
import { boundsOf, erase, fromSvg, isDrawingSvg, strokePath, tidy, toSvg, type Pt, type Stroke } from '../../../../src/renderer/features/canvas/drawing'

const stroke = (points: Pt[]): Stroke => ({ points, color: null, size: 4 })

describe('drawing', () => {
  it('a drawing written as SVG reads back as the same strokes, and is a picture Obsidian can show', () => {
    const strokes = [stroke([[100, 100, 0.5], [140, 120, 0.5], [180, 100, 0.5]])]
    const box = boundsOf(strokes)
    const svg = toSvg(strokes, box)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('<path d="M')
    expect(isDrawingSvg(svg)).toBe(true)
    const back = fromSvg(svg)!
    // Kept relative to the file's box.
    expect(back[0]!.points[0]).toEqual([100 - box.x, 100 - box.y, 0.5])
    expect(fromSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')).toBeNull()
  })

  it('a nearly straight stroke is pulled toward a straight line - most of the way, not all', () => {
    const wobbly: Pt[] = Array.from({ length: 21 }, (_, i) => [i * 10, i % 2 === 0 ? 0 : 6, 0.5] as Pt)
    const tidied = tidy(wobbly)
    const off = (pts: Pt[]): number => Math.max(...pts.map((p) => Math.abs(p[1] - (p[0] * (pts.at(-1)![1] - pts[0]![1])) / 200 - pts[0]![1])))
    expect(off(tidied)).toBeLessThan(off(wobbly))
    expect(off(tidied)).toBeGreaterThan(0)
  })

  it('a roughly round, closed stroke is pulled toward an ellipse', () => {
    const rough: Pt[] = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2
      const r = 50 + (i % 3) * 3
      return [100 + r * Math.cos(a), 100 + r * Math.sin(a), 0.5] as Pt
    })
    rough.push(rough[0]!)
    const spread = (pts: Pt[]): number => {
      const rs = pts.map((p) => Math.hypot(p[0] - 101, p[1] - 101))
      return Math.max(...rs) - Math.min(...rs)
    }
    expect(spread(tidy(rough))).toBeLessThan(spread(rough))
  })

  it('handwriting is only smoothed: its first and last points stay where the pen put them', () => {
    const scribble: Pt[] = [[0, 0, 0.5], [10, 30, 0.5], [20, -5, 0.5], [35, 25, 0.5], [40, 0, 0.5]]
    const tidied = tidy(scribble)
    expect(tidied[0]).toEqual(scribble[0])
    expect(tidied.at(-1)).toEqual(scribble.at(-1))
  })

  it('the eraser takes away the strokes it touches, and only those', () => {
    const a = stroke([[0, 0, 0.5], [10, 0, 0.5]])
    const b = stroke([[100, 100, 0.5], [110, 100, 0.5]])
    expect(erase([a, b], [[5, 1, 0.5]], 4)).toEqual([b])
    // A sweep between two far-apart points of a stroke still finds it: line against line, not point against point.
    const long = stroke([[0, 50, 0.5], [200, 50, 0.5]])
    expect(erase([long, b], [[100, 30, 0.5], [100, 70, 0.5]], 2)).toEqual([b])
    expect(erase([long], [[100, 10, 0.5], [100, 30, 0.5]], 2)).toEqual([long])
    expect(strokePath(a)).toMatch(/^M.*Z$/)
  })
})
