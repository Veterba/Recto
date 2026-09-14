/**
 * The shape the graph grows into.
 *
 * - organic: free force layout - clusters find their own places (the default).
 * - tree: each linked group as a tree from its best-connected note, growing
 *   down, up, left, right, or outward in rings.
 * - radial: hubs in the middle, less-linked notes further out.
 * - circle: every linked note on one ring, neighbours beside each other, links
 *   crossing the middle.
 * - clusters: one island per top-level folder.
 *
 * None of these replace the physics. Each produces a target per node that the
 * simulation is pulled toward, and repulsion and collisions still act - so a
 * tree is a tree you can still grab and shake, nodes never pile up on their
 * target, and switching layout animates from one shape into the other.
 *
 * Pure and free of d3, so it runs in the worker and in tests alike.
 */

import { hierarchy, tree } from 'd3-hierarchy'

export type LayoutMode = 'organic' | 'tree' | 'radial' | 'circle' | 'clusters'
export type TreeDirection = 'down' | 'up' | 'right' | 'left' | 'out'

export type GraphLayout = {
  mode: LayoutMode
  direction: TreeDirection
  /** Multiplier on the gaps a structured layout leaves; organic ignores it. */
  spacing: number
}

export const DEFAULT_LAYOUT: GraphLayout = { mode: 'organic', direction: 'down', spacing: 1 }

export const LAYOUT_MODES: readonly LayoutMode[] = ['organic', 'tree', 'radial', 'circle', 'clusters']
export const TREE_DIRECTIONS: readonly TreeDirection[] = ['down', 'up', 'right', 'left', 'out']

export function coerceLayout(raw: unknown): GraphLayout {
  const r = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const mode = LAYOUT_MODES.includes(r['mode'] as LayoutMode) ? (r['mode'] as LayoutMode) : DEFAULT_LAYOUT.mode
  const direction = TREE_DIRECTIONS.includes(r['direction'] as TreeDirection)
    ? (r['direction'] as TreeDirection)
    : DEFAULT_LAYOUT.direction
  const spacing =
    typeof r['spacing'] === 'number' && Number.isFinite(r['spacing'])
      ? Math.min(3, Math.max(0.3, r['spacing']))
      : DEFAULT_LAYOUT.spacing
  return { mode, direction, spacing }
}

/**
 * Where each node wants to be. NaN means "no preference" on that axis.
 *
 * `radius`, when present, pulls a node onto a circle of that size around the
 * origin instead of toward a point.
 */
export type Targets = {
  x: Float32Array
  y: Float32Array
  radius: Float32Array | null
  /** How hard nodes are pulled to their targets. */
  pull: number
  /** Multiplier on repulsion: structured layouts need less of it. */
  charge: number
  /** Multiplier on link strength: a tree should not be dragged out of shape. */
  links: number
  /** Further multiplier for links whose ends are in different groups. */
  crossGroupLinks: number
}

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
function scatter(
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

// --- tidy trees -------------------------------------------------------------------

/**
 * A node in the tree handed to d3's tidy layout.
 *
 * `block` stands for a whole fan of leaves: a hub with two hundred notes that
 * link only to it gets one block, as wide as a compact grid of them, instead of
 * two hundred slots in a row - which is what turned every real vault's tree into
 * a line. `spacer` hangs under a block to reserve the depth its rows take, so a
 * neighbouring branch cannot tuck its deeper levels underneath it.
 */
type TidyNode = {
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

function tidyTree(root: number, children: readonly number[][], size: Int32Array): TidyNode {
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
function subtreeSizes(count: number, roots: readonly number[], children: readonly number[][]): Int32Array {
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
function tidyPositions(root: TidyNode): Placed[] {
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
function shelves(boxes: readonly { w: number; h: number }[], gap: number): { x: number; y: number }[] {
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

// --- the layouts ------------------------------------------------------------------

export function layoutTargets(
  count: number,
  edges: readonly (readonly [number, number])[],
  layout: GraphLayout,
  /** Group per node (top-level folder), for clusters. */
  groups: ArrayLike<number> | null,
  /** The link distance slider, so structured layouts scale with it. */
  linkDistance: number,
  /** Drawn radius per node, so a ring can give big nodes more room. */
  radiusOf?: (node: number) => number,
): Targets | null {
  if (layout.mode === 'organic' || count === 0) return null

  const x = new Float32Array(count).fill(Number.NaN)
  const y = new Float32Array(count).fill(Number.NaN)
  const unit = Math.max(8, linkDistance) * layout.spacing

  const forest = spanningForest(count, edges)
  const linkedRoots = forest.roots.filter((root) => forest.children[root]!.length > 0)
  const orphans = forest.roots.filter((root) => forest.children[root]!.length === 0)
  const size = subtreeSizes(count, linkedRoots, forest.children)

  if (layout.mode === 'tree') {
    const across = unit * 0.36
    const down = unit * 1.1

    if (layout.direction === 'out') {
      // One radial tree: every group hangs off a virtual centre, so each group
      // is a sector and nothing overlaps. A single group keeps its own root in
      // the middle.
      const single = linkedRoots.length === 1
      const top: TidyNode = single
        ? tidyTree(linkedRoots[0]!, forest.children, size)
        : { kind: 'forest', id: -1, leaves: [], cols: 1, rows: 1, children: linkedRoots.map((r) => tidyTree(r, forest.children, size)) }
      const placed = tidyPositions(top)
      if (placed.length > 0) {
        let minX = Infinity
        let maxX = -Infinity
        for (const p of placed) {
          minX = Math.min(minX, p.x)
          maxX = Math.max(maxX, p.x)
        }
        const span = Math.max(1, maxX - minX + 1)
        // Each ring must be long enough for the notes on it, or the physics
        // collapses the tree into a ball.
        const perLevel: number[] = []
        for (const p of placed) {
          const k = Math.floor(p.depth)
          perLevel[k] = (perLevel[k] ?? 0) + 1
        }
        const ring = unit * 0.95
        const radii: number[] = []
        for (let k = 0; k < perLevel.length; k++) {
          const needed = ((perLevel[k] ?? 0) * across) / (Math.PI * 2)
          radii[k] = k === 0 ? (single ? 0 : ring) : Math.max((radii[k - 1] ?? 0) + ring, needed)
        }
        let outer = 0
        for (const p of placed) {
          const k = Math.floor(p.depth)
          const r = (radii[k] ?? k * ring) + (p.depth - k) * ring
          const angle = ((p.x - minX + 0.5) / span) * Math.PI * 2 - Math.PI / 2
          x[p.id] = Math.cos(angle) * r
          y[p.id] = Math.sin(angle) * r
          outer = Math.max(outer, r)
        }
        scatter(orphans, x, y, 0, 0, outer + ring * 1.3, unit * 0.3)
      }
      return { x, y, radius: null, pull: 0.85, charge: 0.02, links: 0, crossGroupLinks: 1 }
    }

    // Top-down, one tidy tree per group, groups packed on shelves.
    // A big vault's tree is shallow and very wide. Past about 2.2:1 it reads as
    // a strip, so the levels are pulled apart until it has a tree's shape - the
    // branch curves make the longer links read as branches, not noise.
    const shapes = linkedRoots.map((root) => tidyPositions(tidyTree(root, forest.children, size)))
    let widest = 1
    let deepest = 1
    for (const placed of shapes) {
      let lo = Infinity
      let hi = -Infinity
      let depth = 0
      for (const p of placed) {
        lo = Math.min(lo, p.x)
        hi = Math.max(hi, p.x)
        depth = Math.max(depth, p.depth)
      }
      widest = Math.max(widest, (hi - lo + 1) * across)
      deepest = Math.max(deepest, depth + 1)
    }
    const level = Math.max(down, Math.min(unit * 8, widest / (deepest * 2.2)))
    const trees = shapes.map((placed) => {
      let minX = Infinity
      let maxX = -Infinity
      let maxDepth = 0
      for (const p of placed) {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        maxDepth = Math.max(maxDepth, p.depth)
      }
      return { placed, minX, w: (maxX - minX + 1) * across, h: (maxDepth + 1) * level }
    })
    // Unlinked notes as one more box: a compact grid, not a cloud across the page.
    const orphanCols = Math.max(1, Math.ceil(Math.sqrt(orphans.length * 1.8)))
    const orphanBox = { w: orphanCols * across, h: Math.ceil(orphans.length / orphanCols) * across }
    const boxes = [...trees.map((t) => ({ w: t.w, h: t.h })), ...(orphans.length > 0 ? [orphanBox] : [])]
    const at = shelves(boxes, unit * 0.9)

    let minX = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    trees.forEach((t, i) => {
      const origin = at[i]!
      for (const p of t.placed) {
        x[p.id] = origin.x + (p.x - t.minX + 0.5) * across
        // Leaves inside a block keep a tight row gap; only whole levels stretch.
        const whole = Math.floor(p.depth)
        y[p.id] = origin.y + whole * level + (p.depth - whole) * down
      }
      minX = Math.min(minX, origin.x)
      maxX = Math.max(maxX, origin.x + t.w)
      maxY = Math.max(maxY, origin.y + t.h)
    })
    if (orphans.length > 0) {
      const origin = at[at.length - 1]!
      orphans.forEach((node, i) => {
        x[node] = origin.x + ((i % orphanCols) + 0.5) * across
        y[node] = origin.y + Math.floor(i / orphanCols) * across
      })
      minX = Math.min(minX, origin.x)
      maxX = Math.max(maxX, origin.x + orphanBox.w)
      maxY = Math.max(maxY, origin.y + orphanBox.h)
    }
    // Centred on the origin, then turned for the other three directions.
    const cx = (minX + maxX) / 2
    const cy = maxY / 2
    for (let i = 0; i < count; i++) {
      if (Number.isNaN(x[i]!)) continue
      const px = x[i]! - cx
      const py = y[i]! - cy
      switch (layout.direction) {
        case 'up':
          x[i] = px
          y[i] = -py
          break
        case 'right':
          x[i] = py
          y[i] = px
          break
        case 'left':
          x[i] = -py
          y[i] = px
          break
        default:
          x[i] = px
          y[i] = py
      }
    }
    return { x, y, radius: null, pull: 0.85, charge: 0.02, links: 0, crossGroupLinks: 1 }
  }

  if (layout.mode === 'circle') {
    // Depth-first order round the ring: a whole branch stays together, so the
    // links inside it are short chords and only the links between branches
    // cross the middle. Each note takes as much of the ring as it is wide.
    const dfs: number[] = []
    for (const root of linkedRoots) {
      const stack = [root]
      while (stack.length > 0) {
        const node = stack.pop()!
        dfs.push(node)
        const kids = [...forest.children[node]!].sort((a, b) => size[a]! - size[b]!)
        for (const kid of kids) stack.push(kid)
      }
    }
    // Folders first, tree order inside each: in a vault whose links mostly stay
    // within a folder, those links become short arcs along the rim and only the
    // links between folders cross the middle.
    const rank = new Map(dfs.map((node, i) => [node, i]))
    const ring =
      groups === null
        ? dfs
        : [...dfs].sort((a, b) => (groups[a] ?? 0) - (groups[b] ?? 0) || rank.get(a)! - rank.get(b)!)
    const gap = unit * 0.08
    const room = ring.map((node) => 2 * (radiusOf?.(node) ?? 4) + gap)
    const circumference = room.reduce((sum, r) => sum + r, 0)
    const radius = Math.max(unit * 1.5, circumference / (Math.PI * 2))
    let travelled = 0
    ring.forEach((node, i) => {
      const angle = ((travelled + room[i]! / 2) / Math.max(1, circumference)) * Math.PI * 2 - Math.PI / 2
      travelled += room[i]!
      x[node] = Math.cos(angle) * radius
      y[node] = Math.sin(angle) * radius
    })
    scatter(orphans, x, y, 0, 0, radius + unit * 0.9, unit * 0.3)
    return { x, y, radius: null, pull: 0.7, charge: 0.02, links: 0, crossGroupLinks: 1 }
  }

  if (layout.mode === 'radial') {
    // Rings by how linked a note is, hubs innermost: 32+ links, 16+, 8+, 4+,
    // 2+, 1, then unlinked on the outside. Distinct rings rather than a smooth
    // radius, so the structure reads as structure. Angle is left to the forces,
    // which keeps linked notes near each other round their ring.
    const degree = new Int32Array(count)
    for (const [a, b] of edges) {
      if (a >= count || b >= count || a === b) continue
      degree[a]!++
      degree[b]!++
    }
    const BANDS = 6
    const bandOf = (d: number): number => (d === 0 ? BANDS : Math.max(0, BANDS - 1 - Math.min(BANDS - 1, Math.floor(Math.log2(d)))))
    const perBand = new Array<number>(BANDS + 1).fill(0)
    for (let i = 0; i < count; i++) perBand[bandOf(degree[i]!)]!++
    const radii: number[] = []
    const slot = unit * 0.34
    let previous = 0
    let first = true
    for (let k = 0; k <= BANDS; k++) {
      if (perBand[k] === 0) {
        radii[k] = previous
        continue
      }
      const needed = (perBand[k]! * slot) / (Math.PI * 2)
      radii[k] = first && perBand[k]! <= 2 ? 0 : Math.max(previous + unit * (k === BANDS ? 2 : 1.6), needed)
      previous = radii[k]!
      first = false
    }
    const radius = new Float32Array(count)
    for (let i = 0; i < count; i++) radius[i] = radii[bandOf(degree[i]!)]!
    return { x, y, radius, pull: 1, charge: 0.12, links: 0.02, crossGroupLinks: 1 }
  }

  // clusters: one island per group. Islands are circles sized to their notes,
  // packed greedily outward from the biggest so no two overlap.
  const sizes = new Map<number, number>()
  for (let i = 0; i < count; i++) {
    const g = groups?.[i] ?? 0
    sizes.set(g, (sizes.get(g) ?? 0) + 1)
  }
  const ranked = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  const placedIslands: { g: number; x: number; y: number; r: number }[] = []
  for (const [group, n] of ranked) {
    const r = Math.sqrt(n) * unit * 0.32 + unit * 0.4
    if (placedIslands.length === 0) {
      placedIslands.push({ g: group, x: 0, y: 0, r })
      continue
    }
    // Walk a spiral out from the centre until the island fits.
    for (let step = 0; ; step++) {
      const angle = step * 0.35
      const dist = unit * 0.25 * step
      const cx = Math.cos(angle) * dist
      const cy = Math.sin(angle) * dist
      const clear = placedIslands.every((o) => Math.hypot(o.x - cx, o.y - cy) >= o.r + r + unit * 0.35)
      if (clear || step > 4000) {
        placedIslands.push({ g: group, x: cx, y: cy, r })
        break
      }
    }
  }
  const centres = new Map(placedIslands.map((island) => [island.g, island]))
  for (let i = 0; i < count; i++) {
    const island = centres.get(groups?.[i] ?? 0)
    x[i] = island?.x ?? 0
    y[i] = island?.y ?? 0
  }
  return { x, y, radius: null, pull: 0.22, charge: 0.45, links: 0.5, crossGroupLinks: 0.03 }
}

/**
 * Which links belong to the spanning tree, by index into `edges`.
 *
 * In a tree layout the other links - the ones that close loops - are drawn
 * faintly, or they cross the whole picture and hide the tree.
 */
export function treeEdgeIndices(count: number, edges: readonly (readonly [number, number])[]): Set<number> {
  const forest = spanningForest(count, edges)
  const out = new Set<number>()
  edges.forEach(([a, b], i) => {
    if (a >= count || b >= count) return
    if (forest.parent[b] === a || forest.parent[a] === b) out.add(i)
  })
  return out
}
