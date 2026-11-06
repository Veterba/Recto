import { describe, expect, it } from 'vitest'
import { boundsOf, cut, erase, fromSvg, HIGHLIGHT_OPACITY, isDrawingSvg, strokePath, toSvg, type Pt, type Stroke } from '../../../../src/renderer/features/canvas/drawing'

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

  it('a stroke is kept as drawn: no tidying behind the hand', () => {
    const wobbly: Pt[] = Array.from({ length: 21 }, (_, i) => [i * 10, i % 2 === 0 ? 0 : 6, 0.5] as Pt)
    const back = fromSvg(toSvg([stroke(wobbly)], { x: 0, y: 0, width: 220, height: 20 }))!
    expect(back[0]!.points).toEqual(wobbly)
  })

  it('a highlighter is kept under the ink, see-through - in the file too - and keeps its kind, colour and size', () => {
    const ink: Stroke = { points: [[0, 0, 0.5], [50, 0, 0.5]], color: '#e03131', size: 4 }
    const marker: Stroke = { points: [[0, 5, 0.5], [50, 5, 0.5]], color: '#fab005', size: 16, kind: 'highlighter' }
    const svg = toSvg([ink, marker], { x: -20, y: -20, width: 100, height: 60 })
    const paths = [...svg.matchAll(/<path [^>]*>/g)].map((m) => m[0])
    expect(paths[0]).toContain(`fill="#fab005" fill-opacity="${HIGHLIGHT_OPACITY}"`)
    expect(paths[1]).toContain('fill="#e03131"')
    expect(fromSvg(svg)!.map((s) => [s.kind, s.color, s.size])).toEqual([[undefined, '#e03131', 4], ['highlighter', '#fab005', 16]])
  })

  it('a pen with pressure draws with it; a mouse gets a pressure made up from its speed', () => {
    const line = (p: number): Stroke => stroke([[0, 0, p], [20, 0, p], [40, 0, p], [60, 0, p]])
    expect(strokePath(line(0.9))).not.toBe(strokePath(line(0.5)))
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

describe('the cutting eraser', () => {
  const line: Stroke = { points: [[0, 0, 0.5], [200, 0, 0.5]], color: '#e03131', size: 4 }

  it('cuts a stroke where it passes: two pieces either side, the same colour and size', () => {
    const pieces = cut([line], [[100, -20, 0.5], [100, 20, 0.5]], 6)
    expect(pieces).toHaveLength(2)
    expect(pieces.every((p) => p.color === '#e03131' && p.size === 4)).toBe(true)
    expect(Math.max(...pieces[0]!.points.map((p) => p[0]))).toBeLessThan(100 - 6)
    expect(Math.min(...pieces[1]!.points.map((p) => p[0]))).toBeGreaterThan(100 + 6)
  })

  it('leaves an untouched stroke as it was, and takes away what it covers whole', () => {
    expect(cut([line], [[100, 30, 0.5], [100, 60, 0.5]], 6)).toEqual([line])
    expect(cut([line], [[-10, 0, 0.5], [210, 0, 0.5]], 6)).toEqual([])
  })
})
