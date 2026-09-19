import type { FileNode } from '@shared/ipc-contract'

/**
 * The order the file tree is shown in, when it is not the alphabet.
 *
 * A folder on disk has no order - the filesystem hands back a set, and the tree
 * has always sorted it folders-first then by name. Dragging a row to a new
 * place needs somewhere to record that choice, so each parent that has been
 * arranged by hand keeps the list of its children's names, in the order they
 * should appear. Stored per vault in `.recto/tree-order.json`.
 *
 * Names, not paths, so renaming a parent does not orphan the arrangement of
 * everything under it. Anything not in the list - a note written since, a file
 * added by Obsidian - falls back to the old rule and goes after what is listed,
 * rather than silently jumping to the top.
 */

/** Parent path (`''` for the vault root) to its children's names, in order. */
export type TreeOrder = Record<string, string[]>

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Folders first, then by name: what the tree does with no arrangement to follow. */
const byKindThenName = (a: FileNode, b: FileNode): number => {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
  return collator.compare(a.name, b.name)
}

export function coerceOrder(raw: unknown): TreeOrder {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: TreeOrder = {}
  for (const [parent, names] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(names)) continue
    const clean = names.filter((n): n is string => typeof n === 'string')
    if (clean.length > 0) out[parent] = [...new Set(clean)]
  }
  return out
}

/**
 * Sort one folder's children.
 *
 * Listed names take the order they are listed in; everything else keeps the
 * default rule and follows, so a note created after the arrangement appears at
 * the end of its kind rather than wherever the alphabet would have put it.
 */
export function orderChildren(nodes: readonly FileNode[], order: TreeOrder, parent: string): FileNode[] {
  const names = order[parent]
  if (names === undefined || names.length === 0) return [...nodes].sort(byKindThenName)
  const rank = new Map(names.map((name, i) => [name, i]))
  const listed: FileNode[] = []
  const rest: FileNode[] = []
  for (const node of nodes) (rank.has(node.name) ? listed : rest).push(node)
  listed.sort((a, b) => (rank.get(a.name) ?? 0) - (rank.get(b.name) ?? 0))
  rest.sort(byKindThenName)
  return [...listed, ...rest]
}

/**
 * Move one child of `parent` to just before or after another, and return the
 * whole sibling list in its new order - which is what gets stored, so there is
 * never a half-arranged folder whose unlisted members drift.
 */
export function moveWithin(
  siblings: readonly FileNode[],
  order: TreeOrder,
  parent: string,
  moved: string,
  target: string,
  place: 'before' | 'after',
): TreeOrder {
  const names = orderChildren(siblings, order, parent).map((node) => node.name)
  const from = names.indexOf(moved)
  if (from === -1 || moved === target) return order
  names.splice(from, 1)
  const at = names.indexOf(target)
  if (at === -1) return order
  names.splice(place === 'before' ? at : at + 1, 0, moved)
  return { ...order, [parent]: names }
}

/** Put a name at a position among its new siblings, after a move between folders. */
export function placeInto(
  siblings: readonly FileNode[],
  order: TreeOrder,
  parent: string,
  name: string,
  target: string,
  place: 'before' | 'after',
): TreeOrder {
  const names = orderChildren(siblings, order, parent)
    .map((node) => node.name)
    .filter((n) => n !== name)
  const at = names.indexOf(target)
  names.splice(at === -1 ? names.length : place === 'before' ? at : at + 1, 0, name)
  return { ...order, [parent]: names }
}

/** Drop arrangements for folders that no longer exist, so the file cannot grow forever. */
export function pruneOrder(order: TreeOrder, exists: (parent: string) => boolean): TreeOrder {
  const out: TreeOrder = {}
  for (const [parent, names] of Object.entries(order)) if (parent === '' || exists(parent)) out[parent] = names
  return out
}
