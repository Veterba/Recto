import { describe, expect, it } from 'vitest'
import { applyChanges } from '../src/renderer/core/file-tree-ops'
import type { FileNode, VaultChange } from '../src/shared/ipc-contract'

const file = (p: string): FileNode => ({ path: p, name: p.slice(p.lastIndexOf('/') + 1), kind: 'file', mtime: 1, size: 0 })
const folder = (p: string, children: FileNode[] = []): FileNode => ({
  path: p,
  name: p.slice(p.lastIndexOf('/') + 1),
  kind: 'folder',
  children,
})

/** Flatten to paths, depth-first, so assertions read as a tree shape. */
function paths(nodes: FileNode[]): string[] {
  return nodes.flatMap((n) => [n.path, ...(n.children ? paths(n.children) : [])])
}

describe('applying watcher changes', () => {
  it('adds a file at the root, keeping folders first', () => {
    const before = [folder('work'), file('b.md')]
    const after = applyChanges(before, [{ type: 'add', path: 'a.md', mtime: 2, size: 3 }])
    expect(paths(after)).toEqual(['work', 'a.md', 'b.md'])
  })

  it('adds a file into a nested folder', () => {
    const before = [folder('work', [folder('work/2026', [])])]
    const after = applyChanges(before, [{ type: 'add', path: 'work/2026/day.md', mtime: 1, size: 0 }])
    expect(paths(after)).toEqual(['work', 'work/2026', 'work/2026/day.md'])
  })

  it('removes a folder and everything under it', () => {
    const before = [folder('work', [file('work/a.md'), folder('work/sub', [file('work/sub/b.md')])])]
    const after = applyChanges(before, [{ type: 'unlinkDir', path: 'work/sub' }])
    expect(paths(after)).toEqual(['work', 'work/a.md'])
  })

  it('updates mtime in place on change without moving the node', () => {
    const before = [file('a.md'), file('b.md')]
    const after = applyChanges(before, [{ type: 'change', path: 'a.md', mtime: 99, size: 5 }])
    expect(paths(after)).toEqual(['a.md', 'b.md'])
    expect(after[0]?.mtime).toBe(99)
  })

  it('handles a rename arriving as unlink + add', () => {
    // chokidar reports a rename as two unrelated events; the tree must end up right.
    const before = [file('old.md')]
    const after = applyChanges(before, [
      { type: 'unlink', path: 'old.md' },
      { type: 'add', path: 'new.md', mtime: 1, size: 0 },
    ])
    expect(paths(after)).toEqual(['new.md'])
  })

  it('survives a file arriving before its parent folder event', () => {
    // Ordering is not guaranteed; a missing ancestor must be created, not dropped.
    const after = applyChanges([], [{ type: 'add', path: 'newdir/note.md', mtime: 1, size: 0 }])
    expect(paths(after)).toEqual(['newdir', 'newdir/note.md'])
  })

  it('ignores a duplicate add rather than showing the file twice', () => {
    const before = [file('a.md')]
    const after = applyChanges(before, [{ type: 'add', path: 'a.md', mtime: 2, size: 1 }])
    expect(paths(after)).toEqual(['a.md'])
  })

  it('applies a whole batch in order', () => {
    const changes: VaultChange[] = [
      { type: 'addDir', path: 'notes' },
      { type: 'add', path: 'notes/one.md', mtime: 1, size: 0 },
      { type: 'add', path: 'notes/two.md', mtime: 1, size: 0 },
      { type: 'unlink', path: 'notes/one.md' },
      { type: 'ready' },
    ]
    expect(paths(applyChanges([], changes))).toEqual(['notes', 'notes/two.md'])
  })

  it('does not mutate the input tree', () => {
    const before = [folder('work', [file('work/a.md')])]
    const snapshot = JSON.stringify(before)
    applyChanges(before, [{ type: 'add', path: 'work/b.md', mtime: 1, size: 0 }])
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
