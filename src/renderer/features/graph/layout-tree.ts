/**
 * The trees and shelves the layouts are built from: a spanning forest of the
 * link graph, a tidy tree drawing of it, and shelf packing for the pieces.
 */

import { tree, hierarchy } from 'd3-hierarchy'

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

function adjacency(count: number, edges: readonly (readonly [number, number])[]): number[][] {
  const adj = Array.from({ length: count }, () => [] as number[])
  for (const [a, b] of edges) {
    if (a === b || a >= count || b >= count) continue
    adj[a]!.push(b)
    adj[b]!.push(a)
  }
  return adj
}

/**
 * Connected groups, biggest first, each as a breadth-first spanning tree from
 * its most-linked note. Ties go to the lower index, so the same vault always
 * gives the same tree.
 */
export function spanningForest(
  count: number,
  edges: readonly (readonly [number, number])[],
): { roots: number[]; parent: Int32Array; depth: Int32Array; children: number[][]; order: number[][] } {
  const adj = adjacency(count, edges)
  const parent = new Int32Array(count).fill(-1)
  const depth = new Int32Array(count).fill(-1)
  const children = Array.from({ length: count }, () => [] as number[])

  // Which component each node is in, found once.
  const component = new Int32Array(count).fill(-1)
  const members: number[][] = []
  for (let i = 0; i < count; i++) {
    if (component[i] !== -1) continue
    const id = members.length
    const list: number[] = [i]
    component[i] = id
    for (let k = 0; k < list.length; k++) {
      for (const next of adj[list[k]!]!) {
        if (component[next] === -1) {
          component[next] = id
          list.push(next)
        }
      }
    }
    members.push(list)
  }

  members.sort((a, b) => b.length - a.length || (a[0] ?? 0) - (b[0] ?? 0))

  const roots: number[] = []
  const order: number[][] = []
  for (const list of members) {
    let root = list[0]!
    for (const node of list) {
      const better = adj[node]!.length > adj[root]!.length || (adj[node]!.length === adj[root]!.length && node < root)
      if (better) root = node
    }
    roots.push(root)
    depth[root] = 0
    const queue = [root]
    for (let k = 0; k < queue.length; k++) {
      const node = queue[k]!
      // Busiest neighbours first, so a node's big branches sit together.
      const next = [...adj[node]!].sort((a, b) => adj[b]!.length - adj[a]!.length || a - b)
      for (const child of next) {
        if (depth[child] !== -1) continue
        depth[child] = depth[node]! + 1
        parent[child] = node
        children[node]!.push(child)
        queue.push(child)
      }
    }
    order.push(queue)
  }
  return { roots, parent, depth, children, order }
}

/** Unlinked notes in a filled disc or ring band, golden-angle spaced: no rows, no rings. */
export function scatter(
  nodes: readonly number[],
  x: Float32Array,
  y: Float32Array,
  cx: number,
  cy: number,
  inner: number,
  gap: number,
): void {
  nodes.forEach((node, i) => {
    const r = Math.sqrt(inner * inner + i * gap * gap)
    x[node] = cx + Math.cos(i * GOLDEN) * r
    y[node] = cy + Math.sin(i * GOLDEN) * r
  })
}

/**
 * A node in the tree handed to d3's tidy layout.
 *
 * `block` stands for a whole fan of leaves: a hub with two hundred notes that
 * link only to it gets one block, as wide as a compact grid of them, instead of
 * two hundred slots in a row - which is what turned every real vault's tree into
 * a line. `spacer` hangs under a block to reserve the depth its rows take, so a
 * neighbouring branch cannot tuck its deeper levels underneath it.
 */
export type TidyNode = {
  kind: 'note' | 'block' | 'spacer' | 'forest'
  id: number
  leaves: number[]
  cols: number
  rows: number
  children: TidyNode[]
}

/** Fans of leaves at or under this size stay individual children. */
const INLINE_LEAVES = 4

/** Grid rows inside a block, as a fraction of a level. */
const ROW = 0.42

const widthOf = (node: TidyNode): number => (node.kind === 'block' || node.kind === 'spacer' ? node.cols : 1)

export function tidyTree(root: number, children: readonly number[][], size: Int32Array): TidyNode {
  const build = (id: number): TidyNode => {
    const kids = children[id]!
    const branches = kids.filter((kid) => children[kid]!.length > 0).sort((a, b) => size[b]! - size[a]!)
    const leaves = kids.filter((kid) => children[kid]!.length === 0)
    const node: TidyNode = { kind: 'note', id, leaves: [], cols: 1, rows: 1, children: [] }
    const built = branches.map(build)
    if (leaves.length <= INLINE_LEAVES) {
      const leafNodes = leaves.map((leaf): TidyNode => ({ kind: 'note', id: leaf, leaves: [], cols: 1, rows: 1, children: [] }))
      // Leaves in the middle, big branches to either side: the shape stays balanced.
      node.children = [...built.filter((_, i) => i % 2 === 1).reverse(), ...leafNodes, ...built.filter((_, i) => i % 2 === 0)]
      return node
    }
    const cols = Math.max(2, Math.ceil(Math.sqrt(leaves.length * 2.2)))
    const rows = Math.ceil(leaves.length / cols)
    const block: TidyNode = { kind: 'block', id: -1, leaves, cols, rows, children: [] }
    let tail = block
    for (let i = 1; i < Math.ceil(rows * ROW); i++) {
      const spacer: TidyNode = { kind: 'spacer', id: -1, leaves: [], cols, rows: 1, children: [] }
      tail.children = [spacer]
      tail = spacer
    }
    node.children = [...built.filter((_, i) => i % 2 === 1).reverse(), block, ...built.filter((_, i) => i % 2 === 0)]
    return node
  }
  return build(root)
}

/** Notes per subtree, to put big branches outside and keep them apart. */
export function subtreeSizes(count: number, roots: readonly number[], children: readonly number[][]): Int32Array {
  const size = new Int32Array(count).fill(1)
  for (const root of roots) {
    const order: number[] = []
    const stack = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      order.push(node)
      for (const kid of children[node]!) stack.push(kid)
    }
    for (let i = order.length - 1; i >= 0; i--) {
      const node = order[i]!
      for (const kid of children[node]!) size[node]! += size[kid]!
    }
  }
  return size
}

type Placed = { id: number; x: number; depth: number }

/**
 * Tidy coordinates for one tree (or a forest under a virtual root): `x` in
 * slots, `depth` in levels, fractional for leaves inside a block.
 */
export function tidyPositions(root: TidyNode): Placed[] {
  const layout = tree<TidyNode>()
    .nodeSize([1, 1])
    // Neighbours are as far apart as half of each one's width, plus a gap -
    // more between cousins than between siblings, so branches read as groups.
    .separation((a, b) => (widthOf(a.data) + widthOf(b.data)) / 2 + (a.parent === b.parent ? 0.15 : 0.9))
  const out: Placed[] = []
  layout(hierarchy(root)).each((node) => {
    const data = node.data
    if (data.kind === 'note') out.push({ id: data.id, x: node.x, depth: node.y })
    else if (data.kind === 'block') {
      data.leaves.forEach((leaf, i) => {
        const col = i % data.cols
        const row = Math.floor(i / data.cols)
        out.push({ id: leaf, x: node.x + col - (data.cols - 1) / 2, depth: node.y + row * ROW })
      })
    }
  })
  return out
}

/**
 * Shelf packing: boxes left to right in rows about as wide as the whole set is
 * tall, so several separate trees make a block rather than one long strip.
 */
export function shelves(boxes: readonly { w: number; h: number }[], gap: number): { x: number; y: number }[] {
  const area = boxes.reduce((sum, b) => sum + (b.w + gap) * (b.h + gap), 0)
  const widest = boxes.reduce((max, b) => Math.max(max, b.w), 0)
  const rowWidth = Math.max(widest, Math.sqrt(area) * 1.6)
  const at: { x: number; y: number }[] = []
  let cx = 0
  let cy = 0
  let rowHeight = 0
  let rowStart = 0
  const rows: { start: number; end: number; width: number }[] = []
  boxes.forEach((box, i) => {
    if (cx > 0 && cx + box.w > rowWidth) {
      rows.push({ start: rowStart, end: i, width: cx - gap })
      cy += rowHeight + gap
      cx = 0
      rowHeight = 0
      rowStart = i
    }
    at.push({ x: cx, y: cy })
    cx += box.w + gap
    rowHeight = Math.max(rowHeight, box.h)
  })
  rows.push({ start: rowStart, end: boxes.length, width: cx - gap })
  // Centre each row under the widest, so the block is symmetric.
  for (const row of rows) {
    const shift = (rowWidth - row.width) / 2
    for (let i = row.start; i < row.end; i++) at[i]!.x += shift
  }
  return at
}
