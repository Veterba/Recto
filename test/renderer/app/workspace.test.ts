import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, Workspace, makeLeaf, makeTabs, type SplitNode, type WorkspaceLayout } from '../../../src/renderer/app/workspace'
import { DEFAULT_SECTION, SECTIONS, getSection, isSectionId } from '../../../src/renderer/app/sections'

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

describe('tabs that outlive their notes', () => {
  const withNotes = (paths: readonly string[]): Workspace => {
    const workspace = new Workspace()
    for (const path of paths) workspace.openView('markdown', { path })
    return workspace
  }

  it('closes tabs whose note is gone and keeps the rest', () => {
    const workspace = withNotes(['a.md', 'b.md', 'gone.md', 'c.md'])
    const removed = workspace.pruneMissing((path) => path !== 'gone.md')
    expect(removed).toBe(1)
    expect(workspace.leaves().map((leaf) => leaf.state['path'])).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('leaves views that are not notes alone', () => {
    const workspace = new Workspace()
    workspace.openView('graph')
    workspace.openView('markdown', { path: 'gone.md' })
    workspace.pruneMissing(() => false)
    expect(workspace.leaves().map((leaf) => leaf.type)).toEqual(['graph'])
  })

  it('drops tabs of a view type that no longer exists', () => {
    const workspace = new Workspace()
    workspace.openView('settings')
    workspace.openView('bot', { bot: 'recto' })
    expect(workspace.pruneUnknown((type) => type !== 'settings')).toBe(1)
    expect(workspace.leaves().map((leaf) => leaf.type)).toEqual(['bot'])
    expect(workspace.activeLeaf?.type).toBe('bot')
  })

  it('clears every tab at once', () => {
    const workspace = withNotes(['a.md', 'b.md', 'c.md'])
    workspace.closeAll()
    expect(workspace.leaves()).toEqual([])
    expect(workspace.activeLeaf).toBeNull()
  })

  it('closing a tab left of the shown one keeps showing the same tab', () => {
    const workspace = withNotes(['a.md', 'b.md', 'c.md'])
    const [a, b] = workspace.leaves()
    workspace.setActiveLeaf(b!.id)
    workspace.closeLeaf(a!.id)
    const tabs = workspace.tabsContaining(b!.id)!
    expect(tabs.children[tabs.active]?.id).toBe(b!.id)
    expect(workspace.activeLeaf?.id).toBe(b!.id)
  })

  it('"Close other tabs" closes only the pane it is clicked in', () => {
    const workspace = withNotes(['a.md', 'b.md'])
    const b = workspace.leaves()[1]!
    const right = workspace.splitLeaf(b.id, 'vertical')!
    workspace.openView('markdown', { path: 'c.md' }, { inTabs: workspace.tabsContaining(right.id)!.id })
    workspace.closeAll({ except: b.id })
    expect(workspace.leaves().map((leaf) => leaf.state['path'])).toEqual(['b.md', 'b.md', 'c.md'])
    expect(workspace.activeLeaf?.id).toBe(b.id)
  })

  it('can keep one tab while clearing the others', () => {
    const workspace = withNotes(['a.md', 'b.md', 'c.md'])
    const keep = workspace.leaves()[1]!
    workspace.closeAll({ except: keep.id })
    expect(workspace.leaves().map((leaf) => leaf.state['path'])).toEqual(['b.md'])
  })
})

describe('pinned tabs', () => {
  const withNotes = (paths: readonly string[]): Workspace => {
    const workspace = new Workspace()
    for (const path of paths) workspace.openView('markdown', { path })
    return workspace
  }
  const paths = (workspace: Workspace): unknown[] => workspace.leaves().map((leaf) => leaf.state['path'])
  const leafAt = (workspace: Workspace, path: string) => workspace.leaves().find((leaf) => leaf.state['path'] === path)!

  it('moves a pinned tab to the end of the pinned run at the left, and back on unpin', () => {
    const workspace = withNotes(['a.md', 'b.md', 'c.md', 'd.md'])
    workspace.setPinned(leafAt(workspace, 'c.md').id, true)
    workspace.setPinned(leafAt(workspace, 'd.md').id, true)
    expect(paths(workspace)).toEqual(['c.md', 'd.md', 'a.md', 'b.md'])
    workspace.setPinned(leafAt(workspace, 'c.md').id, false)
    expect(paths(workspace)).toEqual(['d.md', 'c.md', 'a.md', 'b.md'])
  })

  it('keeps the same tab active while pinning reorders the row', () => {
    const workspace = withNotes(['a.md', 'b.md', 'c.md'])
    workspace.setPinned(leafAt(workspace, 'b.md').id, true)
    expect(workspace.activeLeaf?.state['path']).toBe('c.md')
    const tabs = workspace.tabsContaining(leafAt(workspace, 'c.md').id)!
    expect(tabs.children[tabs.active]?.state['path']).toBe('c.md')
  })

  it('survives close others and close to the right', () => {
    const workspace = withNotes(['a.md', 'b.md', 'c.md', 'd.md'])
    workspace.setPinned(leafAt(workspace, 'd.md').id, true)
    workspace.closeAll({ except: leafAt(workspace, 'b.md').id })
    expect(paths(workspace)).toEqual(['d.md', 'b.md'])
    expect(workspace.activeLeaf?.state['path']).toBe('b.md')

    const more = withNotes(['a.md', 'b.md', 'c.md'])
    more.setPinned(leafAt(more, 'c.md').id, true)
    more.closeToRight(leafAt(more, 'c.md').id)
    expect(paths(more)).toEqual(['c.md'])
  })

  it('closes only the tabs to the right', () => {
    const workspace = withNotes(['a.md', 'b.md', 'c.md', 'd.md'])
    workspace.closeToRight(leafAt(workspace, 'b.md').id)
    expect(paths(workspace)).toEqual(['a.md', 'b.md'])
    expect(workspace.activeLeaf?.state['path']).toBe('b.md')
  })

  it('reorders within a group without crossing the pinned boundary', () => {
    const workspace = withNotes(['a.md', 'b.md', 'c.md'])
    workspace.setPinned(leafAt(workspace, 'a.md').id, true)
    const tabsId = workspace.tabsContaining(leafAt(workspace, 'a.md').id)!.id
    workspace.moveLeaf(leafAt(workspace, 'c.md').id, tabsId, 0)
    expect(paths(workspace)).toEqual(['a.md', 'c.md', 'b.md'])
    workspace.moveLeaf(leafAt(workspace, 'a.md').id, tabsId, 2)
    expect(paths(workspace)).toEqual(['a.md', 'c.md', 'b.md'])
  })

  it('keeps the pin through a save and restore', () => {
    const workspace = withNotes(['a.md', 'b.md'])
    workspace.setPinned(leafAt(workspace, 'b.md').id, true)
    const restored = new Workspace(JSON.parse(JSON.stringify(workspace.serialize())) as WorkspaceLayout)
    expect(restored.leaves().map((leaf) => [leaf.state['path'], leaf.pinned ?? false])).toEqual([
      ['b.md', true],
      ['a.md', false],
    ])
  })
})

describe('tab history', () => {
  const tab = (): { workspace: Workspace; id: string } => {
    const workspace = new Workspace()
    return { workspace, id: workspace.openView('markdown', { path: 'a.md' }).id }
  }
  const go = (workspace: Workspace, id: string, path: string): void => workspace.navigate(id, { type: 'markdown', state: { path } })
  const shown = (workspace: Workspace, id: string): unknown => workspace.getLeaf(id)?.state['path']
  const lists = (workspace: Workspace, id: string): [unknown[], unknown[]] => {
    const history = workspace.getLeaf(id)?.history
    return [(history?.back ?? []).map((e) => e.state['path']), (history?.forward ?? []).map((e) => e.state['path'])]
  }

  it('keeps each note it showed as a step back, nearest first, and forgets the steps forward', () => {
    const { workspace, id } = tab()
    go(workspace, id, 'b.md')
    go(workspace, id, 'c.md')
    expect(lists(workspace, id)).toEqual([['b.md', 'a.md'], []])
    workspace.travel(id, -1)
    go(workspace, id, 'd.md')
    expect(lists(workspace, id)).toEqual([['b.md', 'a.md'], []])
    expect(shown(workspace, id)).toBe('d.md')
  })

  it('goes several steps at once and comes back to where it started', () => {
    const { workspace, id } = tab()
    for (const path of ['b.md', 'c.md', 'd.md']) go(workspace, id, path)
    const arrived = workspace.travel(id, -3, { scroll: 40, cursor: 7 })
    expect(arrived?.state['path']).toBe('a.md')
    expect(lists(workspace, id)).toEqual([[], ['b.md', 'c.md', 'd.md']])
    expect(workspace.travel(id, 3)?.state['path']).toBe('d.md')
    expect(lists(workspace, id)).toEqual([['c.md', 'b.md', 'a.md'], []])
    expect(workspace.travel(id, -1)?.state['path']).toBe('c.md')
    expect(workspace.getLeaf(id)?.history?.forward[0]?.at).toBeUndefined()
  })

  it('remembers where in a note you were, for coming back to it', () => {
    const { workspace, id } = tab()
    workspace.navigate(id, { type: 'markdown', state: { path: 'b.md' } }, { at: { scroll: 120, cursor: 33 } })
    expect(workspace.travel(id, -1)?.at).toEqual({ scroll: 120, cursor: 33 })
  })

  it('refuses to go further than it has been, and does nothing for the same note', () => {
    const { workspace, id } = tab()
    expect(workspace.travel(id, -1)).toBeNull()
    go(workspace, id, 'a.md')
    expect(lists(workspace, id)).toEqual([[], []])
  })

  it('keeps 100 steps, dropping the oldest', () => {
    const { workspace, id } = tab()
    for (let i = 0; i < 120; i++) go(workspace, id, `${i}.md`)
    const [back] = lists(workspace, id)
    expect(back).toHaveLength(HISTORY_LIMIT)
    expect(back[0]).toBe('118.md')
  })

  it('follows a rename, of the note or a folder it is in, everywhere in the history', () => {
    const { workspace, id } = tab()
    go(workspace, id, 'Garden/b.md')
    go(workspace, id, 'c.md')
    workspace.travel(id, -1)
    workspace.renamePath('Garden', 'Yard')
    workspace.renamePath('c.md', 'see.md')
    expect(shown(workspace, id)).toBe('Yard/b.md')
    expect(lists(workspace, id)).toEqual([['a.md'], ['see.md']])
  })

  it('skips steps to notes that are gone', () => {
    const { workspace, id } = tab()
    go(workspace, id, 'gone.md')
    go(workspace, id, 'c.md')
    workspace.pruneMissing((path) => path !== 'gone.md')
    expect(lists(workspace, id)).toEqual([['a.md'], []])
  })

  it('takes boards and other views as steps too, and keeps the history through a save and restore', () => {
    const { workspace, id } = tab()
    workspace.navigate(id, { type: 'board', state: { path: 'tasks/Launch.md', card: 'tasks/Design.md' } })
    const restored = new Workspace(JSON.parse(JSON.stringify(workspace.serialize())) as WorkspaceLayout)
    expect(restored.getLeaf(id)?.type).toBe('board')
    expect(restored.travel(id, -1)?.state).toEqual({ path: 'a.md' })
    expect(restored.getLeaf(id)?.type).toBe('markdown')
  })
})
