import { styleOf, type CanvasEdge, type CanvasNode, type CanvasSide } from '@shared/canvas'

/**
 * Arrows as tldraw draws them: each end is pinned to a point inside its node
 * (the centre, unless put elsewhere), the arrow runs from one point to the
 * other - straight, or bent into an arc through a point beside the middle -
 * and is cut where it leaves the first node and enters the second.
 *
 * JSON Canvas only has sides, so the pins and the bend are kept as Recto's
 * own style keys (`fromAnchor`, `toAnchor`: "x,y" as fractions of the node;
 * `bend`: how far the middle is pushed sideways, in canvas units). The sides
 * are still written, so Obsidian draws the edge too, between those sides.
 * An edge with sides and no pins (one Obsidian made) is drawn as before:
 * a curve between the two sides.
 */

export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; width: number; height: number }
export type Anchor = { x: number; y: number }

export const CENTRE: Anchor = { x: 0.5, y: 0.5 }

const parseAnchor = (raw: string | undefined): Anchor | null => {
  if (raw === undefined) return null
  const [x, y] = raw.split(',').map(Number)
  return x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y) ? null : { x, y }
}

export const anchorText = (a: Anchor): string => `${round3(a.x)},${round3(a.y)}`
const round3 = (v: number): number => Math.round(v * 1000) / 1000

/** The pins of an edge's ends: null for an end drawn at its side (or, with no side either, at the centre). */
export function anchorsOf(edge: CanvasEdge): { from: Anchor | null; to: Anchor | null } {
  const style = styleOf(edge)
  return { from: parseAnchor(style['fromAnchor']), to: parseAnchor(style['toAnchor']) }
}

export function bendOf(edge: CanvasEdge): number {
  const bend = Number(styleOf(edge)['bend'] ?? 0)
  return Number.isFinite(bend) ? bend : 0
}

/** True for an edge drawn the tldraw way: pinned at either end, or bent. */
export const isPinned = (edge: CanvasEdge): boolean => {
  const a = anchorsOf(edge)
  return a.from !== null || a.to !== null || bendOf(edge) !== 0
}

export const pointIn = (r: Rect, a: Anchor): Point => ({ x: r.x + a.x * r.width, y: r.y + a.y * r.height })

export const sidePoint = (r: Rect, side: CanvasSide): Point =>
  side === 'top'
    ? { x: r.x + r.width / 2, y: r.y }
    : side === 'bottom'
      ? { x: r.x + r.width / 2, y: r.y + r.height }
      : side === 'left'
        ? { x: r.x, y: r.y + r.height / 2 }
        : { x: r.x + r.width, y: r.y + r.height / 2 }

const inside = (r: Rect, p: Point): boolean => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height

/** The pin a point on a node makes: near the middle, the centre itself; elsewhere where it is, inside the node. */
export function anchorAt(r: Rect, p: Point): Anchor {
  const x = r.width === 0 ? 0.5 : (p.x - r.x) / r.width
  const y = r.height === 0 ? 0.5 : (p.y - r.y) / r.height
  if (Math.abs(x - 0.5) < 0.2 && Math.abs(y - 0.5) < 0.2) return CENTRE
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
}

/** The side of `from` that faces `to`, and of `to` that faces `from`, along the axis they are further apart on. */
export function facingSides(from: Rect, to: Rect): { from: CanvasSide; to: CanvasSide } {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' }
  return dy >= 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' }
}

/** One end of an arrow: the point it is pinned to, and the node it is cut by (none for a free end or a side). */
export type End = { at: Point; cut: Rect | null }

export type ArrowShape = {
  /** SVG path data. */
  d: string
  /** Where the drawn arrow starts and ends (after cutting), and its middle: where the label and the bend handle go. */
  start: Point
  end: Point
  mid: Point
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const len = (a: Point): number => Math.hypot(a.x, a.y)

/** The unit normal of the line from a to b: to its left, as the screen sees it. */
function normal(a: Point, b: Point): Point {
  const d = sub(b, a)
  const l = len(d) || 1
  return { x: d.y / l, y: -d.x / l }
}

/** The last t in [lo, hi] along f at which the point is still inside r (f(lo) inside, f(hi) outside). */
function exitAt(f: (t: number) => Point, r: Rect, lo: number, hi: number): number {
  if (!inside(r, f(lo))) return lo
  if (inside(r, f(hi))) return hi
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2
    if (inside(r, f(m))) lo = m
    else hi = m
  }
  return hi
}

/** An arrow from one end to the other, `bend` units off the straight line in the middle. */
export function arrowShape(from: End, to: End, bend: number): ArrowShape {
  const a = from.at
  const b = to.at
  const n = normal(a, b)
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const chord = len(sub(b, a))

  if (Math.abs(bend) < 0.5 || chord < 1) {
    const f = (t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    const t0 = from.cut === null ? 0 : exitAt(f, from.cut, 0, 1)
    // The far end, walked back from: the last point before it enters `to`.
    const g = (t: number): Point => f(1 - t)
    const t1 = to.cut === null ? 1 : 1 - exitAt(g, to.cut, 0, 1 - t0)
    const start = f(t0)
    const end = f(Math.max(t0, t1))
    return { d: `M${start.x} ${start.y}L${end.x} ${end.y}`, start, end, mid: f((t0 + t1) / 2) }
  }

  // The circle through both ends and the bent middle.
  const m = { x: middle.x + n.x * bend, y: middle.y + n.y * bend }
  const h = chord / 2
  const r = (h * h + bend * bend) / (2 * Math.abs(bend))
  // The centre is on the normal through the middle, on the far side from m when the arc is under a half circle.
  const off = r - Math.abs(bend)
  const sign = Math.sign(bend)
  const c = { x: middle.x - n.x * sign * off, y: middle.y - n.y * sign * off }
  const angle = (p: Point): number => Math.atan2(p.y - c.y, p.x - c.x)
  const a0 = angle(a)
  const am = angle(m)
  const a1 = angle(b)
  // Go from a0 to a1 the way that passes am.
  const norm = (v: number): number => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const ccw = norm(am - a0) < norm(a1 - a0)
  const delta = ccw ? norm(a1 - a0) : -norm(a0 - a1)
  const f = (t: number): Point => {
    const th = a0 + delta * t
    return { x: c.x + r * Math.cos(th), y: c.y + r * Math.sin(th) }
  }
  const t0 = from.cut === null ? 0 : exitAt(f, from.cut, 0, 0.5)
  const t1 = to.cut === null ? 1 : 1 - exitAt((t) => f(1 - t), to.cut, 0, 0.5)
  const start = f(t0)
  const end = f(t1)
  const drawn = delta * (t1 - t0)
  const large = Math.abs(drawn) > Math.PI ? 1 : 0
  const sweep = drawn > 0 ? 1 : 0
  return { d: `M${start.x} ${start.y}A${r} ${r} 0 ${large} ${sweep} ${end.x} ${end.y}`, start, end, mid: f((t0 + t1) / 2) }
}

/** The bend a middle handle dragged to `p` makes: how far it is from the straight line, on which side. Near the line, none. */
export function bendTowards(a: Point, b: Point, p: Point, snap: number): number {
  const n = normal(a, b)
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const bend = (p.x - middle.x) * n.x + (p.y - middle.y) * n.y
  return Math.abs(bend) < snap ? 0 : Math.round(bend)
}

/** A free end of an arrow: a point node, too small to see, that the arrow ends at. Obsidian shows it as a dot of a box. */
export const POINT_SIZE = 2
export const isPointNode = (n: CanvasNode): boolean => n.type === 'text' && styleOf(n)['shape'] === 'point'
