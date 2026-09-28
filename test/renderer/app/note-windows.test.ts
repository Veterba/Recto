import { describe, expect, it } from 'vitest'
import {
  NOTE_WINDOW_DEFAULT,
  NOTE_WINDOW_MIN,
  bringToFront,
  clampInside,
  closeNoteWindow,
  openNoteWindow,
  parseNoteWindows,
  placeNoteWindow,
  resizeFrom,
  serializeNoteWindows,
  topmost,
  type NoteWindowState,
} from '../../../src/renderer/app/note-windows'

const area = { width: 1000, height: 700 }
const win = (over: Partial<NoteWindowState> = {}): NoteWindowState => ({
  id: 'w',
  path: 'a.md',
  x: 100,
  y: 100,
  width: 400,
  height: 300,
  ...over,
})

describe('note windows: staying inside the workspace', () => {
  it('a window past an edge is moved back in', () => {
    expect(clampInside(win({ x: 900, y: -40 }), area)).toMatchObject({ x: 600, y: 0, width: 400, height: 300 })
    expect(clampInside(win({ x: -50, y: 650 }), area)).toMatchObject({ x: 0, y: 400 })
  })

  it('a window larger than the workspace shrinks to fit, but not below the minimum', () => {
    expect(clampInside(win({ width: 2000, height: 2000 }), area)).toMatchObject({ x: 0, y: 0, width: 1000, height: 700 })
    expect(clampInside(win({ width: 10, height: 10 }), area)).toMatchObject({
      width: NOTE_WINDOW_MIN.width,
      height: NOTE_WINDOW_MIN.height,
    })
  })
})

describe('note windows: resizing from edges and corners', () => {
  it('right and bottom grow the window, capped at the workspace', () => {
    expect(resizeFrom(win(), { right: true }, 50, 0, area)).toMatchObject({ x: 100, width: 450, height: 300 })
    expect(resizeFrom(win(), { bottom: true }, 0, 999, area)).toMatchObject({ y: 100, height: 600 })
  })

  it('left and top move the edge and keep the opposite one', () => {
    expect(resizeFrom(win(), { left: true }, -60, 0, area)).toMatchObject({ x: 40, width: 460 })
    expect(resizeFrom(win(), { top: true }, 0, 30, area)).toMatchObject({ y: 130, height: 270 })
  })

  it('an edge dragged past the minimum stops there; the far edge never moves', () => {
    const left = resizeFrom(win(), { left: true }, 500, 0, area)
    expect(left.width).toBe(NOTE_WINDOW_MIN.width)
    expect(left.x + left.width).toBe(500)
    const top = resizeFrom(win(), { top: true }, 0, 500, area)
    expect(top.height).toBe(NOTE_WINDOW_MIN.height)
    expect(top.y + top.height).toBe(400)
  })

  it('a corner moves two edges, and not past the workspace', () => {
    expect(resizeFrom(win(), { top: true, left: true }, -500, -500, area)).toMatchObject({ x: 0, y: 0, width: 500, height: 400 })
    expect(resizeFrom(win(), { bottom: true, right: true }, 20, 10, area)).toMatchObject({ width: 420, height: 310 })
  })
})

describe('note windows: opening, stacking, closing', () => {
  it('a pinned note opens on top, at the card, at the default size', () => {
    let list = openNoteWindow([], 'a.md', { x: 50, y: 60 }, area)
    list = openNoteWindow(list, 'b.md', { x: 900, y: 650 }, area)
    expect(list.map((w) => w.path)).toEqual(['a.md', 'b.md'])
    expect(list[0]).toMatchObject({ x: 50, y: 60, ...NOTE_WINDOW_DEFAULT })
    // Pinned near a corner, it is pulled inside.
    expect(list[1]).toMatchObject({ x: 1000 - NOTE_WINDOW_DEFAULT.width, y: 700 - NOTE_WINDOW_DEFAULT.height })
    expect(topmost(list)?.path).toBe('b.md')
  })

  it('pinning a note that already has a window raises that window instead', () => {
    let list = openNoteWindow([], 'a.md', { x: 0, y: 0 }, area)
    list = openNoteWindow(list, 'b.md', { x: 0, y: 0 }, area)
    const again = openNoteWindow(list, 'a.md', { x: 300, y: 300 }, area)
    expect(again).toHaveLength(2)
    expect(topmost(again)?.path).toBe('a.md')
    expect(again[1]).toMatchObject({ x: 0, y: 0 })
  })

  it('clicking a window brings it to the front; closing removes only it', () => {
    const list = [win({ id: '1' }), win({ id: '2' }), win({ id: '3' })]
    expect(bringToFront(list, '1').map((w) => w.id)).toEqual(['2', '3', '1'])
    expect(bringToFront(list, '3').map((w) => w.id)).toEqual(['1', '2', '3'])
    expect(closeNoteWindow(list, '2').map((w) => w.id)).toEqual(['1', '3'])
    expect(topmost([])).toBeNull()
  })

  it('moving a window keeps it inside', () => {
    const list = placeNoteWindow([win({ id: '1' })], '1', { x: 5000, y: 5000, width: 400, height: 300 }, area)
    expect(list[0]).toMatchObject({ x: 600, y: 400 })
  })
})

describe('note windows: persistence', () => {
  it('round-trips through workspace.json, order and geometry kept', () => {
    const list = [win({ id: '1', path: 'a.md', x: 10 }), win({ id: '2', path: 'b.md', x: 20, width: 500 })]
    const saved = JSON.parse(JSON.stringify(serializeNoteWindows(list))) as unknown
    expect(saved).toEqual([
      { path: 'a.md', x: 10, y: 100, width: 400, height: 300 },
      { path: 'b.md', x: 20, y: 100, width: 500, height: 300 },
    ])
    const restored = parseNoteWindows(saved)
    expect(restored.map(({ path, x, width }) => ({ path, x, width }))).toEqual([
      { path: 'a.md', x: 10, width: 400 },
      { path: 'b.md', x: 20, width: 500 },
    ])
    // Fresh ids, and no two alike.
    expect(new Set(restored.map((w) => w.id)).size).toBe(2)
  })

  it('drops anything malformed rather than trusting it', () => {
    expect(parseNoteWindows(undefined)).toEqual([])
    expect(parseNoteWindows({ path: 'a.md' })).toEqual([])
    const kept = parseNoteWindows([
      { path: 'a.md', x: 1, y: 2, width: 300, height: 200 },
      { path: '', x: 1, y: 2, width: 300, height: 200 },
      { path: 'b.md', x: 'far', y: 2, width: 300, height: 200 },
      { path: 'c.md', x: 1, y: 2, width: Number.NaN, height: 200 },
      null,
    ])
    expect(kept.map((w) => w.path)).toEqual(['a.md'])
  })
})
