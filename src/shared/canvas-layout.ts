/**
 * Where new things go on a canvas, worked out by Recto, not the model: the
 * model says what goes together, these say where - never over what is there.
 * Pure: rectangles in, rectangles out.
 */

export type Rect = { x: number; y: number; width: number; height: number }
export type Size = { width: number; height: number }

/** Room left between things, in canvas units. */
export const GAP = 40
/** Room inside a group's frame round what it holds; more at the top, under its label. */
const PAD = 30

export const overlaps = (a: Rect, b: Rect, gap = 0): boolean =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y

/** Only the size: a node passed as a size must not bring its own place along. */
const sizeOf = (s: Size): Size => ({ width: s.width, height: s.height })

const free = (r: Rect, taken: readonly Rect[]): boolean => !taken.some((t) => overlaps(r, t, GAP / 2))

/** The box round some rectangles. */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.width))
  const y1 = Math.max(...rects.map((r) => r.y + r.height))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/**
 * A place for something of `size` beside `anchor` (right, below, left, above,
 * then further out each way) that covers nothing in `taken`.
 */
export function placeNear(anchor: Rect, size: Size, taken: readonly Rect[]): Rect {
  for (let ring = 0; ring < 40; ring++) {
    const reach = GAP + ring * (GAP + Math.max(size.width, size.height) / 2)
    const cx = anchor.x + anchor.width / 2
    const cy = anchor.y + anchor.height / 2
    const tries: [number, number][] = [
      [anchor.x + anchor.width + reach, cy - size.height / 2],
      [cx - size.width / 2, anchor.y + anchor.height + reach],
      [anchor.x - reach - size.width, cy - size.height / 2],
      [cx - size.width / 2, anchor.y - reach - size.height],
    ]
    for (const [x, y] of tries) {
      const r = { x: Math.round(x), y: Math.round(y), ...sizeOf(size) }
      if (free(r, taken)) return r
    }
  }
  return placeInFreeSpace(size, taken)
}

/**
 * Places for several things round `anchor`, in a ring - for ideas around a
 * card - each clear of what is there and of each other.
 */
export function placeAround(anchor: Rect, sizes: readonly Size[], taken: readonly Rect[]): Rect[] {
  const placed: Rect[] = []
  const cx = anchor.x + anchor.width / 2
  const cy = anchor.y + anchor.height / 2
  const widest = Math.max(0, ...sizes.map((s) => Math.max(s.width, s.height)))
  for (const [i, size] of sizes.entries()) {
    const angle = -Math.PI / 2 + (i / Math.max(1, sizes.length)) * Math.PI * 2
    let got: Rect | null = null
    for (let ring = 0; ring < 12 && got === null; ring++) {
      const radius = Math.max(anchor.width, anchor.height) / 2 + GAP + widest / 2 + ring * (GAP + widest / 2)
      const r = { x: Math.round(cx + radius * Math.cos(angle) - size.width / 2), y: Math.round(cy + radius * Math.sin(angle) - size.height / 2), ...sizeOf(size) }
      if (free(r, [...taken, anchor, ...placed])) got = r
    }
    placed.push(got ?? placeNear(anchor, size, [...taken, ...placed]))
  }
  return placed
}

/** A clear spot for something of `size`: to the right of everything there, level with its top. */
export function placeInFreeSpace(size: Size, taken: readonly Rect[]): Rect {
  const all = boundsOf(taken)
  return all === null ? { x: 0, y: 0, ...sizeOf(size) } : { x: Math.round(all.x + all.width + GAP * 2), y: Math.round(all.y), ...sizeOf(size) }
}

/** A group's frame round what it holds, with room for its label. */
export function groupFrame(members: readonly Rect[]): Rect | null {
  const b = boundsOf(members)
  return b === null ? null : { x: b.x - PAD, y: b.y - PAD - 20, width: b.width + PAD * 2, height: b.height + PAD * 2 + 20 }
}

/**
 * Things laid out in rows from a corner, as many to a row as make it about as
 * wide as it is tall - a moodboard's grid - starting in free space.
 */
export function packRows(sizes: readonly Size[], taken: readonly Rect[], at?: { x: number; y: number }): Rect[] {
  if (sizes.length === 0) return []
  // As many to a row as make the whole about as wide as it is tall: cols² ≈ n·(h+gap)/(w+gap).
  const w = sizes.reduce((s, z) => s + z.width, 0) / sizes.length
  const h = sizes.reduce((s, z) => s + z.height, 0) / sizes.length
  const cols = Math.max(1, Math.ceil(Math.sqrt((sizes.length * (h + GAP)) / (w + GAP))))
  const rowWidth = Math.max(Math.max(...sizes.map((s) => s.width)), cols * (w + GAP) - GAP + 1)
  const origin = at ?? placeInFreeSpace({ width: rowWidth, height: 1 }, taken)
  const out: Rect[] = []
  let x = origin.x
  let y = origin.y
  let rowHeight = 0
  for (const s of sizes) {
    if (x > origin.x && x + s.width > origin.x + rowWidth) {
      x = origin.x
      y += rowHeight + GAP
      rowHeight = 0
    }
    out.push({ x: Math.round(x), y: Math.round(y), ...sizeOf(s) })
    x += s.width + GAP
    rowHeight = Math.max(rowHeight, s.height)
  }
  return out
}

/** Room between a mind map's levels, before an arrow's label. */
const LEVEL_GAP = GAP * 2

export type Point = { x: number; y: number }

/**
 * A mind map round `root`: its branches half to the right, half to the left
 * (as many cards' height each side), each level a column lined up on the edge
 * toward the root, a card level with the middle of what hangs off it. Drawn
 * from side to facing side, its arrows pass no card: a column is reached only
 * at the card an arrow goes to. `children` lists each card's branches in
 * order; `label` is how wide the label on the arrow into a card is, for room
 * between levels. Places relative to the root's, which stays where it is.
 */
export function mindMap(
  root: string,
  sizes: ReadonlyMap<string, Size>,
  children: ReadonlyMap<string, readonly string[]>,
  label: (id: string) => number = () => 0,
): Map<string, Point> {
  const kids = (id: string): readonly string[] => children.get(id) ?? []
  const size = (id: string): Size => sizes.get(id)!
  const spans = new Map<string, number>()
  const height = (ids: readonly string[]): number => ids.reduce((t, k) => t + span(k), 0) + GAP * Math.max(0, ids.length - 1)
  const span = (id: string): number => {
    const known = spans.get(id)
    if (known !== undefined) return known
    const got = Math.max(size(id).height, height(kids(id)))
    spans.set(id, got)
    return got
  }
  // Half each way, by height, keeping their order.
  const branches = kids(root)
  const total = branches.reduce((s, k) => s + span(k), 0)
  const right: string[] = []
  const left: string[] = []
  let sum = 0
  for (const k of branches) {
    if (sum < total / 2 || right.length === 0) right.push(k)
    else left.push(k)
    sum += span(k)
  }

  const out = new Map<string, Point>([[root, { x: 0, y: 0 }]])
  const rootSize = size(root)
  for (const [side, dir] of [
    [right, 1],
    [left, -1],
  ] as const) {
    if (side.length === 0) continue
    // Each level's column: as wide as its widest card, the gap before it wide enough for the arrows' labels.
    const levels: string[][] = []
    const walk = (id: string, depth: number): void => {
      ;(levels[depth] ??= []).push(id)
      for (const k of kids(id)) walk(k, depth + 1)
    }
    for (const k of side) walk(k, 0)
    const edgeOf: number[] = []
    let at = dir === 1 ? rootSize.width : 0
    levels.forEach((ids, d) => {
      const width = Math.max(...ids.map((id) => size(id).width))
      const gap = LEVEL_GAP + Math.max(0, ...ids.map(label))
      edgeOf[d] = dir === 1 ? at + gap : at - gap
      at = dir === 1 ? at + gap + width : at - gap - width
    })
    const place = (ids: readonly string[], depth: number, top: number): void => {
      let y = top
      for (const id of ids) {
        const s = size(id)
        // Right of the root, cards line up on their left edge; left of it, on their right.
        out.set(id, { x: dir === 1 ? edgeOf[depth]! : edgeOf[depth]! - s.width, y: y + (span(id) - s.height) / 2 })
        place(kids(id), depth + 1, y + (span(id) - height(kids(id))) / 2)
        y += span(id) + GAP
      }
    }
    place(side, 0, rootSize.height / 2 - height(side) / 2)
  }
  for (const [id, p] of out) out.set(id, { x: Math.round(p.x), y: Math.round(p.y) })
  return out
}

/**
 * Columns side by side, each a stack of cards top to bottom; `framed` columns
 * get room above for a group's label. Places from (0,0).
 */
export function columns(cols: readonly { sizes: readonly Size[]; framed: boolean }[]): Point[][] {
  let x = 0
  return cols.map((c) => {
    let y = c.framed ? GAP + 20 : 0
    const placed = c.sizes.map((s) => {
      const p = { x, y }
      y += s.height + GAP
      return p
    })
    x += Math.max(0, ...c.sizes.map((s) => s.width)) + GAP * 3
    return placed
  })
}
