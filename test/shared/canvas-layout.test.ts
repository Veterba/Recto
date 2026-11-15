import { describe, expect, it } from 'vitest'
import { columns, groupFrame, mindMap, overlaps, packRows, placeAround, placeInFreeSpace, placeNear, type Rect } from '../../src/shared/canvas-layout'

/** Where Recto puts what the AI suggests: never over what is there. */

const card = (x: number, y: number): Rect => ({ x, y, width: 200, height: 100 })
const size = { width: 200, height: 100 }
const clear = (placed: readonly Rect[], taken: readonly Rect[]): boolean =>
  placed.every((p, i) => !taken.some((t) => overlaps(p, t)) && !placed.some((q, j) => j !== i && overlaps(p, q)))

describe('canvas layout', () => {
  it('beside a card: to its right when that is free, else the next free side', () => {
    const anchor = card(0, 0)
    expect(placeNear(anchor, size, [anchor])).toMatchObject({ x: 240, y: 0 })
    const right = card(240, 0)
    const placed = placeNear(anchor, size, [anchor, right])
    expect(clear([placed], [anchor, right])).toBe(true)
  })

  it('a node given as the size: placed by its size only, never left where it was', () => {
    const anchor = card(0, 0)
    const node = { id: 'x', ...card(900, 900) }
    expect(placeNear(anchor, node, [anchor])).toEqual({ x: 240, y: 0, width: 200, height: 100 })
    expect(packRows([node], [], { x: 0, y: 0 })).toEqual([{ x: 0, y: 0, width: 200, height: 100 }])
  })

  it('round a card: every one clear of the canvas and of each other', () => {
    const anchor = card(0, 0)
    const taken = [anchor, card(300, 0), card(0, 200), card(-300, -200)]
    const placed = placeAround(anchor, Array.from({ length: 7 }, () => size), taken)
    expect(placed).toHaveLength(7)
    expect(clear(placed, taken)).toBe(true)
  })

  it('a group frame holds its members with room for its label; free space is beside everything', () => {
    const frame = groupFrame([card(0, 0), card(300, 0)])!
    expect(frame.x).toBeLessThan(0)
    expect(frame.y).toBeLessThan(-30)
    expect(frame.x + frame.width).toBeGreaterThan(500)
    expect(placeInFreeSpace(size, [card(0, 0), card(300, 400)]).x).toBeGreaterThan(500)
  })

  it('a moodboard in rows, about as wide as tall, clear of the canvas', () => {
    const taken = [card(0, 0)]
    const placed = packRows(Array.from({ length: 9 }, () => ({ width: 300, height: 200 })), taken)
    expect(clear(placed, taken)).toBe(true)
    expect(new Set(placed.map((p) => p.y)).size).toBe(3)
  })

  it('a mind map: branches half right, half left of the root, each level a column, no card over another or an arrow through one', () => {
    // A hub with six branches, two of them with branches of their own.
    const ids = ['hub', 'a', 'b', 'c', 'd', 'e', 'f', 'a1', 'a2', 'e1']
    const sizes = new Map(ids.map((id) => [id, id === 'hub' ? { width: 300, height: 160 } : size]))
    const children = new Map([
      ['hub', ['a', 'b', 'c', 'd', 'e', 'f']],
      ['a', ['a1', 'a2']],
      ['e', ['e1']],
    ])
    const at = mindMap('hub', sizes, children, (id) => (id === 'b' ? 120 : 0))
    const rect = (id: string): Rect => ({ ...at.get(id)!, ...sizes.get(id)! })
    expect(at.get('hub')).toEqual({ x: 0, y: 0 })
    const rects = ids.map(rect)
    expect(rects.every((r, i) => !rects.some((q, j) => j !== i && overlaps(r, q)))).toBe(true)
    const right = ['a', 'b', 'c', 'd', 'e', 'f'].filter((k) => rect(k).x > 300)
    const left = ['a', 'b', 'c', 'd', 'e', 'f'].filter((k) => rect(k).x + 200 < 0)
    expect(right.length + left.length).toBe(6)
    expect(right.length).toBeGreaterThan(0)
    expect(left.length).toBeGreaterThan(0)
    // A level is a column; a branch's branches one column further out; room for the label on the arrow into b.
    expect(new Set(right.map((k) => rect(k).x)).size).toBe(1)
    expect(rect('a1').x).toBeGreaterThan(rect('a').x + 200)
    if (right.includes('b')) expect(rect('b').x).toBeGreaterThanOrEqual(300 + 80 + 120)
    // Arrows side to facing side, sampled along: inside no card but their two ends.
    const arrows = [...children].flatMap(([p, ks]) => ks.map((k) => [p, k] as const))
    for (const [p, k] of arrows) {
      const [pr, kr] = [rect(p), rect(k)]
      const toRight = kr.x > pr.x
      const a = { x: toRight ? pr.x + pr.width : pr.x, y: pr.y + pr.height / 2 }
      const b = { x: toRight ? kr.x : kr.x + kr.width, y: kr.y + kr.height / 2 }
      for (let t = 0.01; t < 1; t += 0.02) {
        const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, width: 0, height: 0 }
        expect(ids.filter((id) => id !== p && id !== k).some((id) => overlaps(q, rect(id)))).toBe(false)
      }
    }
    // A card is level with the middle of its branches.
    expect(rect('a').y + 50).toBe(Math.round((rect('a1').y + rect('a2').y) / 2 + 50))
  })

  it('columns: side by side, each stacked top to bottom, room above a framed one for its label', () => {
    const [one, two] = columns([
      { sizes: [size, size], framed: false },
      { sizes: [size], framed: true },
    ])
    expect(one).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 140 },
    ])
    expect(two![0]!.x).toBeGreaterThan(200)
    expect(groupFrame([{ ...two![0]!, ...size }])!.y).toBeGreaterThanOrEqual(0)
  })
})
