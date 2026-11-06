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
      const r = { x: Math.round(x), y: Math.round(y), ...size }
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
      const r = { x: Math.round(cx + radius * Math.cos(angle) - size.width / 2), y: Math.round(cy + radius * Math.sin(angle) - size.height / 2), ...size }
      if (free(r, [...taken, anchor, ...placed])) got = r
    }
    placed.push(got ?? placeNear(anchor, size, [...taken, ...placed]))
  }
  return placed
}

/** A clear spot for something of `size`: to the right of everything there, level with its top. */
export function placeInFreeSpace(size: Size, taken: readonly Rect[]): Rect {
  const all = boundsOf(taken)
  return all === null ? { x: 0, y: 0, ...size } : { x: Math.round(all.x + all.width + GAP * 2), y: Math.round(all.y), ...size }
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
    out.push({ x: Math.round(x), y: Math.round(y), ...s })
    x += s.width + GAP
    rowHeight = Math.max(rowHeight, s.height)
  }
  return out
}
