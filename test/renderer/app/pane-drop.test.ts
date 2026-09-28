import { describe, expect, it } from 'vitest'
import { EDGE, zoneAt, zonePreview, type Rect } from '../../../src/renderer/app/pane-drop'
import { Workspace, makeLeaf, makeTabs, type WorkspaceNode } from '../../../src/renderer/app/workspace'

const pane: Rect = { left: 100, top: 50, width: 800, height: 400 }
/** A point inside the pane, as fractions of its width and height. */
const at = (fx: number, fy: number): [number, number] => [pane.left + fx * pane.width, pane.top + fy * pane.height]

describe('drop zones', () => {
  it('the centre is everything well inside the pane', () => {
    expect(zoneAt(pane, ...at(0.5, 0.5))).toBe('center')
    expect(zoneAt(pane, ...at(0.3, 0.7))).toBe('center')
    expect(zoneAt(pane, ...at(EDGE, 0.5))).toBe('center')
  })

  it('near an edge, the nearest edge', () => {
    expect(zoneAt(pane, ...at(0.05, 0.5))).toBe('left')
    expect(zoneAt(pane, ...at(0.95, 0.5))).toBe('right')
    expect(zoneAt(pane, ...at(0.5, 0.1))).toBe('top')
    expect(zoneAt(pane, ...at(0.5, 0.9))).toBe('bottom')
  })

  it('in a corner, the diagonal decides', () => {
    expect(zoneAt(pane, ...at(0.05, 0.1))).toBe('left')
    expect(zoneAt(pane, ...at(0.1, 0.05))).toBe('top')
    expect(zoneAt(pane, ...at(0.95, 0.9))).toBe('right')
    expect(zoneAt(pane, ...at(0.9, 0.95))).toBe('bottom')
  })

  it('measures in fractions, so a wide pane still has side zones', () => {
    // 40px from the left of an 800px pane is 5%: left, though the top edge is nearer in pixels.
    expect(zoneAt(pane, pane.left + 40, pane.top + 30)).toBe('left')
  })

  it('outside the pane, or on an empty one, is no zone', () => {
    expect(zoneAt(pane, pane.left - 1, 200)).toBeNull()
    expect(zoneAt(pane, 300, pane.top + pane.height + 1)).toBeNull()
    expect(zoneAt({ left: 0, top: 0, width: 0, height: 100 }, 0, 50)).toBeNull()
  })

  it('previews half the pane for an edge, all of it for the centre', () => {
    expect(zonePreview(pane, 'left')).toEqual({ left: 100, top: 50, width: 400, height: 400 })
    expect(zonePreview(pane, 'right')).toEqual({ left: 500, top: 50, width: 400, height: 400 })
    expect(zonePreview(pane, 'top')).toEqual({ left: 100, top: 50, width: 800, height: 200 })
    expect(zonePreview(pane, 'bottom')).toEqual({ left: 100, top: 250, width: 800, height: 200 })
    expect(zonePreview(pane, 'center')).toEqual(pane)
  })
})

/** The layout as text: `row(...)` side by side, `col(...)` stacked, `[a,b]` a pane's tabs. */
function shape(node: WorkspaceNode): string {
  if (node.kind === 'leaf') return String(node.state['path'])
  if (node.kind === 'tabs') return `[${node.children.map(shape).join(',')}]`
  return `${node.direction === 'vertical' ? 'row' : 'col'}(${node.children.map(shape).join(' ')})`
}
const note = (path: string): { type: string; state: Record<string, unknown> } => ({ type: 'markdown', state: { path } })

describe('dropping on a pane', () => {
  it('a note on the right edge of the only pane makes two panes side by side', () => {
    const ws = new Workspace()
    ws.openView('markdown', { path: 'a' })
    const root = ws.getRoot()
    const placed = ws.placeInPane(root.id, 'right', note('b'))
    expect(shape(ws.getRoot())).toBe('row([a] [b])')
    expect(ws.getRoot().kind === 'split' && ws.getRoot()).toMatchObject({ sizes: [0.5, 0.5] })
    expect(ws.activeLeaf?.id).toBe(placed?.id)
  })

  it('left and top put the new pane first; top and bottom stack', () => {
    for (const [zone, expected] of [
      ['left', 'row([b] [a])'],
      ['top', 'col([b] [a])'],
      ['bottom', 'col([a] [b])'],
    ] as const) {
      const ws = new Workspace()
      ws.openView('markdown', { path: 'a' })
      ws.placeInPane(ws.getRoot().id, zone, note('b'))
      expect(shape(ws.getRoot())).toBe(expected)
    }
  })

  it('beside a pane in a row, it halves that pane and leaves the others alone', () => {
    const a = makeTabs([makeLeaf('markdown', { path: 'a' })])
    const b = makeTabs([makeLeaf('markdown', { path: 'b' })])
    const ws = new Workspace({
      version: 1,
      root: { kind: 'split', id: 'root', direction: 'vertical', children: [a, b], sizes: [0.6, 0.4] },
      activeLeafId: null,
    })
    ws.placeInPane(b.id, 'left', note('c'))
    expect(shape(ws.getRoot())).toBe('row([a] [c] [b])')
    expect(ws.getRoot()).toMatchObject({ sizes: [0.6, 0.2, 0.2] })
  })

  it('across a row, it nests a new split in place of the pane', () => {
    const a = makeTabs([makeLeaf('markdown', { path: 'a' })])
    const b = makeTabs([makeLeaf('markdown', { path: 'b' })])
    const ws = new Workspace({
      version: 1,
      root: { kind: 'split', id: 'root', direction: 'vertical', children: [a, b], sizes: [0.7, 0.3] },
      activeLeafId: null,
    })
    ws.placeInPane(b.id, 'bottom', note('c'))
    expect(shape(ws.getRoot())).toBe('row([a] col([b] [c]))')
    // The row keeps its proportions; the new column splits b's share evenly.
    expect(ws.getRoot()).toMatchObject({ sizes: [0.7, 0.3], children: [{}, { sizes: [0.5, 0.5] }] })
  })

  it('the centre opens it as a tab, or goes to the tab it already has', () => {
    const ws = new Workspace()
    ws.openView('markdown', { path: 'a' })
    const root = ws.getRoot()
    const b = ws.placeInPane(root.id, 'center', note('b'))
    expect(shape(ws.getRoot())).toBe('[a,b]')
    ws.placeInPane(root.id, 'center', note('a'))
    expect(shape(ws.getRoot())).toBe('[a,b]')
    expect(ws.activeLeaf?.state['path']).toBe('a')
    expect(b?.state['path']).toBe('b')
  })

  it('a dragged tab moves: out of its pane into a new one', () => {
    const ws = new Workspace()
    ws.openView('markdown', { path: 'a' })
    const b = ws.openView('markdown', { path: 'b' })
    const placed = ws.placeInPane(ws.getRoot().id, 'right', { leafId: b.id })
    expect(shape(ws.getRoot())).toBe('row([a] [b])')
    expect(placed?.id).toBe(b.id)
    expect(ws.leaves()).toHaveLength(2)
  })

  it("a pane's only tab dragged to another pane's edge leaves no empty pane behind", () => {
    const a = makeTabs([makeLeaf('markdown', { path: 'a' })])
    const bLeaf = makeLeaf('markdown', { path: 'b' })
    const b = makeTabs([bLeaf])
    const c = makeTabs([makeLeaf('markdown', { path: 'c' })])
    const ws = new Workspace({
      version: 1,
      root: { kind: 'split', id: 'root', direction: 'vertical', children: [a, b, c], sizes: [0.25, 0.25, 0.5] },
      activeLeafId: null,
    })
    ws.placeInPane(a.id, 'bottom', { leafId: bLeaf.id })
    expect(shape(ws.getRoot())).toBe('row(col([a] [b]) [c])')
    // b's room is shared out in proportion, not reset to even.
    expect(ws.getRoot()).toMatchObject({ sizes: [1 / 3, 2 / 3] })
  })

  it("a pane's only tab on its own edge does nothing; on its own centre it stays", () => {
    const ws = new Workspace()
    const a = ws.openView('markdown', { path: 'a' })
    expect(ws.placeInPane(ws.getRoot().id, 'left', { leafId: a.id })).toBeNull()
    expect(ws.placeInPane(ws.getRoot().id, 'center', { leafId: a.id })?.id).toBe(a.id)
    expect(shape(ws.getRoot())).toBe('[a]')
  })

  it('a tab dropped on the centre of another pane joins its tabs', () => {
    const a = makeTabs([makeLeaf('markdown', { path: 'a' })])
    const bLeaf = makeLeaf('markdown', { path: 'b' })
    const b = makeTabs([makeLeaf('markdown', { path: 'x' }), bLeaf])
    const ws = new Workspace({
      version: 1,
      root: { kind: 'split', id: 'root', direction: 'vertical', children: [a, b], sizes: [0.5, 0.5] },
      activeLeafId: null,
    })
    ws.placeInPane(a.id, 'center', { leafId: bLeaf.id })
    expect(shape(ws.getRoot())).toBe('row([a,b] [x])')
  })

  it('the result round-trips through the saved layout', () => {
    const ws = new Workspace()
    ws.openView('markdown', { path: 'a' })
    ws.placeInPane(ws.getRoot().id, 'right', note('b'))
    const restored = new Workspace(JSON.parse(JSON.stringify(ws.serialize())))
    expect(shape(restored.getRoot())).toBe('row([a] [b])')
    expect(restored.activeLeaf?.state['path']).toBe('b')
  })

  it('closing a tab elsewhere no longer resets every divider', () => {
    const a = makeTabs([makeLeaf('markdown', { path: 'a' })])
    const bLeaf = makeLeaf('markdown', { path: 'b' })
    const b = makeTabs([bLeaf])
    const c = makeTabs([makeLeaf('markdown', { path: 'c' })])
    const ws = new Workspace({
      version: 1,
      root: { kind: 'split', id: 'root', direction: 'vertical', children: [a, b, c], sizes: [0.6, 0.1, 0.3] },
      activeLeafId: null,
    })
    ws.closeLeaf(bLeaf.id)
    const sizes = (ws.getRoot() as { sizes: number[] }).sizes
    expect(sizes[0]).toBeCloseTo(0.6 / 0.9)
    expect(sizes[1]).toBeCloseTo(0.3 / 0.9)
  })
})
