import { describe, expect, it } from 'vitest'
import {
  Workspace,
  makeLeaf,
  makeTabs,
  type SplitNode,
  type WorkspaceLayout,
} from '../src/renderer/core/workspace'
import { DEFAULT_SECTION, SECTIONS, getSection, isSectionId } from '../src/renderer/core/sections'

/** Narrow the root to a split, failing the test if it is not one. */
function asSplit(node: { kind: string }): SplitNode {
  expect(node.kind).toBe('split')
  return node as SplitNode
}

describe('Workspace tree', () => {
  it('opens views into the active tab group', () => {
    const ws = new Workspace()
    const a = ws.openView('markdown', { path: 'a.md' })
    const b = ws.openView('markdown', { path: 'b.md' })
    expect(ws.leaves().map((l) => l.state['path'])).toEqual(['a.md', 'b.md'])
    expect(ws.activeLeaf?.id).toBe(b.id)
    expect(a.id).not.toBe(b.id)
  })

  it('reuses a leaf with identical type and state instead of stacking duplicates', () => {
    const ws = new Workspace()
    const first = ws.openView('settings')
    const second = ws.openView('settings')
    expect(second.id).toBe(first.id)
    expect(ws.leaves()).toHaveLength(1)
  })

  it('reuse:false forces a new leaf', () => {
    const ws = new Workspace()
    const first = ws.openView('markdown', { path: 'a.md' })
    const second = ws.openView('markdown', { path: 'a.md' }, { reuse: false })
    expect(second.id).not.toBe(first.id)
    expect(ws.leaves()).toHaveLength(2)
  })

  it('splitting the root wraps it, and a same-direction split adds a sibling', () => {
    const ws = new Workspace()
    const a = ws.openView('markdown', { path: 'a.md' })
    ws.splitLeaf(a.id, 'vertical')
    const root = asSplit(ws.getRoot())
    expect(root.children).toHaveLength(2)
    expect(root.sizes).toEqual([0.5, 0.5])

    const active = ws.activeLeaf
    expect(active).not.toBeNull()
    ws.splitLeaf(active!.id, 'vertical')
    const grown = asSplit(ws.getRoot())
    expect(grown.children).toHaveLength(3)
    expect(grown.sizes.every((s: number) => Math.abs(s - 1 / 3) < 1e-9)).toBe(true)
  })

  it('a cross-direction split nests instead of flattening', () => {
    const ws = new Workspace()
    const a = ws.openView('markdown', { path: 'a.md' })
    ws.splitLeaf(a.id, 'vertical')
    const active = ws.activeLeaf!
    ws.splitLeaf(active.id, 'horizontal')
    const root = asSplit(ws.getRoot())
    expect(root.children.some((c) => c.kind === 'split')).toBe(true)
  })

  it('closing the last leaf of a split collapses the empty pane', () => {
    const ws = new Workspace()
    const a = ws.openView('markdown', { path: 'a.md' })
    const copy = ws.splitLeaf(a.id, 'vertical')
    expect(ws.getRoot().kind).toBe('split')
    ws.closeLeaf(copy!.id)
    // One pane left, so the split must collapse back to a plain tabs group.
    expect(ws.getRoot().kind).toBe('tabs')
    expect(ws.leaves()).toHaveLength(1)
  })

  it('closing every leaf leaves an empty tabs root, not a broken tree', () => {
    const ws = new Workspace()
    const a = ws.openView('markdown', { path: 'a.md' })
    ws.closeLeaf(a.id)
    expect(ws.getRoot().kind).toBe('tabs')
    expect(ws.leaves()).toHaveLength(0)
    expect(ws.activeLeaf).toBeNull()
    // and it still accepts a new view afterwards
    expect(ws.openView('home')).toBeTruthy()
  })

  it('closing the active leaf moves focus rather than leaving it dangling', () => {
    const ws = new Workspace()
    ws.openView('markdown', { path: 'a.md' })
    const b = ws.openView('markdown', { path: 'b.md' })
    ws.closeLeaf(b.id)
    expect(ws.activeLeaf?.state['path']).toBe('a.md')
  })

  it('activating a leaf reveals it in its own tab group', () => {
    const ws = new Workspace()
    const a = ws.openView('markdown', { path: 'a.md' })
    ws.openView('markdown', { path: 'b.md' })
    ws.setActiveLeaf(a.id)
    const tabs = ws.tabsContaining(a.id)
    expect(tabs?.children[tabs.active]?.id).toBe(a.id)
  })

  it('moveLeaf relocates a tab between groups', () => {
    const ws = new Workspace()
    const a = ws.openView('markdown', { path: 'a.md' })
    const copy = ws.splitLeaf(a.id, 'vertical')!
    const target = ws.tabsContaining(a.id)!
    ws.moveLeaf(copy.id, target.id, 0)
    expect(target.children.map((l) => l.id)).toEqual([copy.id, a.id])
    // source group emptied, so the split collapsed
    expect(ws.getRoot().kind).toBe('tabs')
  })

  it('round-trips through serialize/deserialize', () => {
    const ws = new Workspace()
    const a = ws.openView('markdown', { path: 'a.md' })
    ws.splitLeaf(a.id, 'horizontal')
    ws.openView('graph')

    const json = JSON.parse(JSON.stringify(ws.serialize())) as WorkspaceLayout
    const restored = new Workspace(json)

    expect(restored.leaves().map((l) => l.type)).toEqual(ws.leaves().map((l) => l.type))
    expect(restored.activeLeaf?.id).toBe(ws.activeLeaf?.id)
    expect(restored.getRoot().kind).toBe(ws.getRoot().kind)
  })

  it('restores a layout containing an unknown view type without throwing', () => {
    // A view type that no longer exists must not destroy the saved layout.
    const layout: WorkspaceLayout = {
      version: 1,
      root: makeTabs([makeLeaf('markdown', { path: 'a.md' }), makeLeaf('view-from-the-future')], 1),
      activeLeafId: null,
    }
    const ws = new Workspace(layout)
    expect(ws.leaves().map((l) => l.type)).toEqual(['markdown', 'view-from-the-future'])
  })

  it('setSizes normalises to fractions summing to 1', () => {
    const ws = new Workspace()
    const a = ws.openView('markdown', { path: 'a.md' })
    ws.splitLeaf(a.id, 'vertical')
    const root = asSplit(ws.getRoot())
    ws.setSizes(root.id, [3, 1])
    expect(root.sizes).toEqual([0.75, 0.25])
  })

  it('fires layout-change and active-leaf-change', () => {
    const ws = new Workspace()
    let layouts = 0
    const actives: (string | null)[] = []
    ws.on('layout-change', () => layouts++)
    ws.on('active-leaf-change', (leaf) => actives.push(leaf?.type ?? null))
    ws.openView('home')
    ws.openView('graph')
    expect(layouts).toBeGreaterThanOrEqual(2)
    expect(actives).toEqual(['home', 'graph'])
  })
})

describe('sections', () => {
  it('is exactly three workspaces - Home and Graph are extensions, not sections', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['data', 'ai', 'tasks'])
  })

  it('every section maps to a distinct view type', () => {
    const types = SECTIONS.map((s) => s.viewType)
    expect(new Set(types).size).toBe(types.length)
  })

  it('getSection falls back rather than returning undefined', () => {
    expect(getSection('ai').label).toBe('AI')
    expect(getSection('nope' as never).id).toBe('data')
  })

  it('isSectionId rejects anything not a section', () => {
    expect(isSectionId('data')).toBe(true)
    expect(isSectionId('graph')).toBe(false)
    expect(isSectionId('home')).toBe(false)
    expect(isSectionId(null)).toBe(false)
  })

  it('the default section is one of the three', () => {
    expect(SECTIONS.some((s) => s.id === DEFAULT_SECTION)).toBe(true)
  })

  it('each section carries its own search placeholder and new-item label', () => {
    for (const section of SECTIONS) {
      expect(section.searchPlaceholder.length).toBeGreaterThan(0)
      expect(section.newLabel.length).toBeGreaterThan(0)
      // Short enough to sit beside the "Folder" button without truncating.
      expect(section.newLabel.length).toBeLessThanOrEqual(6)
    }
  })
})
