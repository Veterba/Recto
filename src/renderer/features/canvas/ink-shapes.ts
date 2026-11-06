import type { Pt } from './drawing'

/**
 * Draw and hold: a stroke held still at its end for a moment becomes the
 * clean shape it was drawn as - a line, an arrow, a triangle, a rectangle or
 * an ellipse - as in Apple Notes. Only when asked by holding, never behind
 * the hand. Corners are found as ShortStraw does (Wolin, Eoff and Hammond,
 * 2008): resample evenly, then a point whose neighbours three either side
 * are unusually close together is a corner.
 */

export type InkShape = 'line' | 'arrow' | 'triangle' | 'rectangle' | 'ellipse'

type P = [number, number]

const dist = (a: P, b: P): number => Math.hypot(a[0] - b[0], a[1] - b[1])
const pathLength = (pts: readonly P[]): number => pts.reduce((sum, p, i) => (i === 0 ? 0 : sum + dist(pts[i - 1]!, p)), 0)

/** A hand's shake taken out: each point the mean of it and its neighbours, the ends kept. */
function steady(pts: readonly P[], reach = 2): P[] {
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p
    const from = Math.max(0, i - reach)
    const to = Math.min(pts.length - 1, i + reach)
    let x = 0
    let y = 0
    for (let k = from; k <= to; k++) {
      x += pts[k]![0]
      y += pts[k]![1]
    }
    return [x / (to - from + 1), y / (to - from + 1)]
  })
}

/** The stroke resampled `step` apart along its path. */
function resample(pts: readonly P[], step: number): P[] {
  const out: P[] = [pts[0]!]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]!
    const b = pts[i]!
    let d = dist(a, b)
    while (carry + d >= step) {
      const t = (step - carry) / d
      const q: P = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      out.push(q)
      d -= step - carry
      a = q
      carry = 0
    }
    carry += d
  }
  const last = pts[pts.length - 1]!
  if (dist(out[out.length - 1]!, last) > step / 2) out.push(last)
  return out
}

/** The indexes of the corners of a resampled stroke, its ends included. */
function corners(pts: readonly P[]): number[] {
  const W = 3
  if (pts.length < 2 * W + 2) return [0, pts.length - 1]
  const straw = pts.map((_, i) => (i < W || i >= pts.length - W ? Infinity : dist(pts[i - W]!, pts[i + W]!)))
  const sorted = straw.filter(Number.isFinite).sort((a, b) => a - b)
  const threshold = sorted[Math.floor(sorted.length / 2)]! * 0.95
  const found = [0]
  for (let i = W; i < pts.length - W; i++) {
    if (straw[i]! >= threshold) continue
    // The lowest straw in this run of low ones is the corner.
    let best = i
    while (i + 1 < pts.length - W && straw[i + 1]! < threshold) {
      i++
      if (straw[i]! < straw[best]!) best = i
    }
    found.push(best)
  }
  found.push(pts.length - 1)
  // Corners closer than a sixth of the way round are one corner.
  const total = pathLength(pts)
  return found.filter((c, k) => k === 0 || k === found.length - 1 || pathLength(pts.slice(found[k - 1]!, c + 1)) > total / 16)
}

/** The angle at b, between ba and bc, in degrees. */
function angleAt(a: P, b: P, c: P): number {
  const v1: P = [a[0] - b[0], a[1] - b[1]]
  const v2: P = [c[0] - b[0], c[1] - b[1]]
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1)
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
}

/** A line from a to b, as points `step` apart, for the pen to draw evenly. */
function segment(a: P, b: P, step: number): P[] {
  const n = Math.max(1, Math.ceil(dist(a, b) / step))
  return Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as P)
}
const polyline = (vertices: readonly P[], step: number): P[] => [
  ...vertices.slice(1).flatMap((v, i) => segment(vertices[i]!, v, step)),
  vertices[vertices.length - 1]!,
]

/** The clean shape a stroke was drawn as, with its points, or null when it is not one of them. */
export function recognise(points: readonly Pt[]): { shape: InkShape; points: Pt[] } | null {
  if (points.length < 3) return null
  const raw: P[] = points.map((p) => [p[0], p[1]])
  const xs = raw.map((p) => p[0])
  const ys = raw.map((p) => p[1])
  const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
  const diagonal = Math.hypot(box.x1 - box.x0, box.y1 - box.y0)
  if (diagonal < 12) return null
  const pts = steady(resample(raw, diagonal / 40))
  const length = pathLength(pts)
  const step = Math.max(2, diagonal / 60)
  const pressure = points.reduce((s, p) => s + p[2], 0) / points.length
  const out = (shape: InkShape, ps: P[]): { shape: InkShape; points: Pt[] } => ({ shape, points: ps.map(([x, y]) => [x, y, pressure] as Pt) })

  const first = pts[0]!
  const last = pts[pts.length - 1]!
  const closed = dist(first, last) < Math.max(length * 0.12, diagonal * 0.15)

  if (!closed) {
    // A line: hardly any longer than the straight way between its ends.
    if (dist(first, last) > length * 0.94) return out('line', segment(first, last, step).concat([last]))
    // An arrow: a straight shaft to its tip - the point farthest from the start - then a short head drawn about the tip.
    // The first time the pen gets (nearly) that far: a head drawn back and forth passes the tip again.
    const far = Math.max(...pts.map((p) => dist(first, p)))
    const tipAt = pts.findIndex((p) => dist(first, p) >= far * 0.97)
    const tip = pts[tipAt]!
    const shaft = pathLength(pts.slice(0, tipAt + 1))
    const headPath = length - shaft
    const headNear = pts.slice(tipAt).every((p) => dist(p, tip) < shaft * 0.35)
    if (dist(first, tip) > shaft * 0.9 && headPath > shaft * 0.1 && headPath < shaft * 0.8 && headNear) {
      const head = Math.max(diagonal * 0.08, Math.min(shaft * 0.2, 40))
      const angle = Math.atan2(tip[1] - first[1], tip[0] - first[0])
      const barb = (side: number): P => [tip[0] - head * Math.cos(angle + side * (Math.PI / 6)), tip[1] - head * Math.sin(angle + side * (Math.PI / 6))]
      return out('arrow', polyline([first, tip, barb(1), tip, barb(-1)], step))
    }
    return null
  }

  const cs = corners(pts)
  // The stroke's own start and end are one corner of a closed shape: drop the end.
  const vertices = cs.slice(0, -1).map((c) => pts[c]!)
  if (vertices.length >= 2 && dist(vertices[0]!, vertices[vertices.length - 1]!) < diagonal * 0.12) vertices.pop()

  if (vertices.length === 3) return out('triangle', polyline([...vertices, vertices[0]!], step))
  if (vertices.length === 4) {
    const angles = vertices.map((v, i) => angleAt(vertices[(i + 3) % 4]!, v, vertices[(i + 1) % 4]!))
    if (angles.every((a) => Math.abs(a - 90) < 25)) {
      // Square to the page when drawn nearly so; else the quadrilateral as drawn, its corners kept.
      const tilt = (Math.atan2(vertices[1]![1] - vertices[0]![1], vertices[1]![0] - vertices[0]![0]) * 180) / Math.PI
      const square = Math.abs(((tilt % 90) + 90) % 90) < 12 || Math.abs(((tilt % 90) + 90) % 90) > 78
      const corners4: P[] = square
        ? [
            [box.x0, box.y0],
            [box.x1, box.y0],
            [box.x1, box.y1],
            [box.x0, box.y1],
          ]
        : vertices
      return out('rectangle', polyline([...corners4, corners4[0]!], step))
    }
  }
  // Round: every point about as far from the middle as the rest, by each axis.
  const cx = (box.x0 + box.x1) / 2
  const cy = (box.y0 + box.y1) / 2
  const rx = (box.x1 - box.x0) / 2
  const ry = (box.y1 - box.y0) / 2
  if (rx > 4 && ry > 4) {
    const off = pts.map((p) => Math.abs(Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry) - 1))
    if (off.reduce((s, v) => s + v, 0) / off.length < 0.12) {
      const n = 72
      const ring = Array.from({ length: n + 1 }, (_, i) => [cx + rx * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI)] as P)
      return out('ellipse', ring)
    }
  }
  return null
}
