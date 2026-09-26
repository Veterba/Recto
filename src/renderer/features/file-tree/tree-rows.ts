/**
 * The tree as the list it is drawn as: one row per visible node, and where a
 * drop between rows puts the dragged note.
 */

import type { FileNode } from '@shared/vault'
import { type TreeOrder, orderChildren } from './tree-order'

export type Row = { node: FileNode; depth: number }

export function flatten(
  nodes: readonly FileNode[],
  expanded: ReadonlySet<string>,
  order: TreeOrder,
  parent = '',
  depth = 0,
  out: Row[] = [],
): Row[] {
  for (const node of orderChildren(nodes, order, parent)) {
    out.push({ node, depth })
    if (node.kind === 'folder' && expanded.has(node.path) && node.children) {
      flatten(node.children, expanded, order, node.path, depth + 1, out)
    }
  }
  return out
}

/** Where a dragged row would land: inside a folder, or between two rows. */
export type DropHint = { path: string; place: 'before' | 'after' | 'into' }

/**
 * Which third of the row the pointer is in.
 *
 * A row is three targets, not one: its edges put the dragged thing above or
 * below, its middle puts it inside. A folder gets a generous middle, because
 * that is the older gesture and the one people arrive with; a file has no
 * inside, so it splits down the level into before and after.
 *
 * Read from the event rather than from what the last `dragover` decided - a
 * drop that trusts state can act on a stale answer, and the stale answer here
 * is "inside", which swallows the folder instead of moving it.
 */
export function placeFor(node: FileNode, clientY: number, box: DOMRect): DropHint['place'] {
  const at = (clientY - box.top) / Math.max(1, box.height)
  if (node.kind !== 'folder') return at < 0.5 ? 'before' : 'after'
  return at < 0.25 ? 'before' : at > 0.75 ? 'after' : 'into'
}
