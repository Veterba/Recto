import type { FileNode, VaultChange } from '@shared/ipc-contract'

/**
 * Pure tree manipulation. No React, no IPC - so it can be tested in plain Node.
 *
 * Watcher events are applied incrementally rather than by refetching the whole
 * tree: a folder rename emits one event per descendant, and refetching on each
 * would walk the vault hundreds of times for a single user action.
 */

export type VaultTree = {
  roots: FileNode[]
  /** Flat index, so a lookup by path is O(1) instead of a walk. */
  byPath: Map<string, FileNode>
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return collator.compare(a.name, b.name)
  })
}

function index(roots: FileNode[]): Map<string, FileNode> {
  const map = new Map<string, FileNode>()
  const walk = (nodes: FileNode[]): void => {
    for (const node of nodes) {
      map.set(node.path, node)
      if (node.children) walk(node.children)
    }
  }
  walk(roots)
  return map
}

const parentOf = (p: string): string => {
  const at = p.lastIndexOf('/')
  return at === -1 ? '' : p.slice(0, at)
}
const nameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

/**
 * Insert a node, creating any missing ancestor folders on the way down.
 *
 * Ancestors can genuinely be missing: chokidar does not guarantee that `addDir`
 * arrives before the `add` of a file inside it.
 */
function insert(roots: FileNode[], node: FileNode): FileNode[] {
  const parent = parentOf(node.path)
  const segments = parent === '' ? [] : parent.split('/')

  const addInto = (nodes: FileNode[], depth: number, prefix: string): FileNode[] => {
    if (depth === segments.length) {
      if (nodes.some((n) => n.path === node.path)) return nodes
      return sortNodes([...nodes, node])
    }

    const name = segments[depth]
    if (name === undefined) return nodes
    const folderPath = prefix === '' ? name : `${prefix}/${name}`
    const at = nodes.findIndex((n) => n.path === folderPath && n.kind === 'folder')

    if (at === -1) {
      const created: FileNode = {
        path: folderPath,
        name,
        kind: 'folder',
        children: addInto([], depth + 1, folderPath),
      }
      return sortNodes([...nodes, created])
    }

    const found = nodes[at]
    if (!found) return nodes
    const copy = [...nodes]
    copy[at] = { ...found, children: addInto(found.children ?? [], depth + 1, folderPath) }
    return copy
  }

  return addInto(roots, 0, '')
}

function remove(roots: FileNode[], targetPath: string): FileNode[] {
  const strip = (nodes: FileNode[]): FileNode[] =>
    nodes
      .filter((n) => n.path !== targetPath)
      .map((n) => (n.children ? { ...n, children: strip(n.children) } : n))
  return strip(roots)
}

function update(roots: FileNode[], targetPath: string, patch: Partial<FileNode>): FileNode[] {
  const walk = (nodes: FileNode[]): FileNode[] =>
    nodes.map((n) => {
      if (n.path === targetPath) return { ...n, ...patch }
      return n.children ? { ...n, children: walk(n.children) } : n
    })
  return walk(roots)
}

export function applyChanges(roots: FileNode[], changes: readonly VaultChange[]): FileNode[] {
  let next = roots
  for (const change of changes) {
    switch (change.type) {
      case 'add':
        next = insert(next, {
          path: change.path,
          name: nameOf(change.path),
          kind: 'file',
          mtime: change.mtime ?? 0,
          size: change.size ?? 0,
        })
        break
      case 'addDir':
        next = insert(next, { path: change.path, name: nameOf(change.path), kind: 'folder', children: [] })
        break
      case 'change':
        next = update(next, change.path, { mtime: change.mtime ?? 0, size: change.size ?? 0 })
        break
      case 'unlink':
      case 'unlinkDir':
        next = remove(next, change.path)
        break
      case 'ready':
        break
    }
  }
  return next
}


export { index as indexTree }

/**
 * Filter the tree to nodes matching a query, keeping the folders that lead to
 * each hit so the result is still a tree and not a flat list of orphans.
 *
 * Uses the same fuzzy matcher as the palette, so "26w37" finds `2026-W37`.
 */
export function filterTree(roots: readonly FileNode[], query: string, match: (text: string) => boolean): FileNode[] {
  if (query.trim() === '') return [...roots]

  const keep = (nodes: readonly FileNode[]): FileNode[] => {
    const out: FileNode[] = []
    for (const node of nodes) {
      if (node.kind === 'file') {
        if (match(node.name)) out.push(node)
        continue
      }
      const children = keep(node.children ?? [])
      // A folder survives if it matches itself (then it keeps everything) or if
      // anything inside it matched.
      if (match(node.name)) out.push({ ...node, children: node.children ?? [] })
      else if (children.length > 0) out.push({ ...node, children })
    }
    return out
  }

  return keep(roots)
}

/** Every folder path in the tree - what a search result expands to. */
export function allFolderPaths(roots: readonly FileNode[], out: string[] = []): string[] {
  for (const node of roots) {
    if (node.kind === 'folder') {
      out.push(node.path)
      allFolderPaths(node.children ?? [], out)
    }
  }
  return out
}
