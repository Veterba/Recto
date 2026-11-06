import { describe, expect, it } from 'vitest'
import { groupFrame, overlaps, packRows, placeAround, placeInFreeSpace, placeNear, type Rect } from '../../src/shared/canvas-layout'

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
})
