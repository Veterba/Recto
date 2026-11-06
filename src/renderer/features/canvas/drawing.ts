import { getStroke } from 'perfect-freehand'

/**
 * Drawings on a canvas: freehand strokes kept as an SVG file in the vault, put
 * on the canvas as an ordinary file node - so Obsidian shows it as a picture,
 * and Recto opens it again to draw more or to erase. The strokes themselves
 * (their points) are kept inside the SVG, in a `<metadata>` element, so a
 * drawing is edited as strokes, not as pixels.
 *
 * A stroke is kept as it was drawn - never tidied behind the hand. A pen
 * with pressure draws with it; a mouse or trackpad draws with a pressure
 * perfect-freehand makes up from the speed. A highlighter is flat, wide and
 * see-through, and is drawn under the ink.
 */

/** A point: x, y in canvas units, and the pen's pressure (0.5 when the device gives none). */
export type Pt = [number, number, number]
export type StrokeKind = 'pen' | 'highlighter'
/**
 * `kind` left out is a pen (drawings made before there were highlighters);
 * `shape`: drawn and held into a clean shape (ink-shapes.ts), drawn crisp.
 */
export type Stroke = { points: Pt[]; color: string | null; size: number; kind?: StrokeKind; shape?: string }
export type Box = { x: number; y: number; width: number; height: number }

/** The ink a stroke is written with in the file when it has no colour of its own: what Obsidian shows. */
export const FILE_INK = '#1f1f1f'
export const PEN_SIZE = 4
/** Room left round the strokes inside the drawing's box, so a thick line's edge is not cut. */
const MARGIN = 12

/** How see-through a highlighter is: the words under it stay readable. */
export const HIGHLIGHT_OPACITY = 0.35

const easeOutSine = (t: number): number => Math.sin((t * Math.PI) / 2)

/**
 * perfect-freehand's settings for a stroke, as tldraw draws them: a pen with
 * its own pressure follows it closely; a mouse or a trackpad gets a pressure
 * made up from its speed; a highlighter is an even, flat band.
 */
function freehandOptions(stroke: Stroke, done: boolean): Parameters<typeof getStroke>[1] {
  // A clean shape: an even line that keeps its corners.
  if (stroke.shape !== undefined) return { size: stroke.size, thinning: 0, streamline: 0, smoothing: 0.4, simulatePressure: false, last: done }
  if (stroke.kind === 'highlighter') return { size: stroke.size, thinning: 0, streamline: 0.5, smoothing: 0.5, simulatePressure: false, last: done }
  const realPressure = stroke.points.some((p) => p[2] !== 0.5)
  return realPressure
    ? { size: 1 + stroke.size * 1.2, thinning: 0.62, streamline: 0.62, smoothing: 0.62, simulatePressure: false, easing: easeOutSine, last: done }
    : { size: stroke.size, thinning: 0.5, streamline: stroke.size > 9 ? 0.74 : 0.64, smoothing: 0.62, simulatePressure: true, easing: easeOutSine, last: done }
}

/** A stroke's outline, as SVG path data: perfect-freehand's shape for it. `done: false` while it is still being drawn. */
export function strokePath(stroke: Stroke, done = true): string {
  const outline = getStroke(stroke.points, freehandOptions(stroke, done))
  if (outline.length === 0) return ''
  const [first, ...rest] = outline
  let d = `M${first![0].toFixed(1)} ${first![1].toFixed(1)}`
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    const b = rest[i + 1] ?? first!
    d += `Q${a[0].toFixed(1)} ${a[1].toFixed(1)} ${((a[0] + b[0]) / 2).toFixed(1)} ${((a[1] + b[1]) / 2).toFixed(1)}`
  }
  return `${d}Z`
}

/** The box round some strokes, with room for their width. */
export function boundsOf(strokes: readonly Stroke[]): Box {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of strokes)
    for (const [x, y] of s.points) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, width: 1, height: 1 }
  return { x: x0 - MARGIN, y: y0 - MARGIN, width: Math.max(1, x1 - x0) + MARGIN * 2, height: Math.max(1, y1 - y0) + MARGIN * 2 }
}

/** Strokes moved by (dx, dy). */
export const shifted = (strokes: readonly Stroke[], dx: number, dy: number): Stroke[] =>
  strokes.map((s) => ({ ...s, points: s.points.map(([x, y, p]) => [x + dx, y + dy, p] as Pt) }))

const round = (v: number): number => Math.round(v * 10) / 10

/** A drawing as an SVG file: its strokes drawn, and kept as data to edit again. Points are relative to the file's box. */
export function toSvg(strokes: readonly Stroke[], box: Box): string {
  const local = shifted(strokes, -box.x, -box.y)
  const data = JSON.stringify(local.map((s) => ({ ...s, points: s.points.map(([x, y, p]) => [round(x), round(y), round(p)]) })))
  // Highlighters first, so the ink is drawn over them - in Obsidian too.
  const ordered = [...local.filter((s) => s.kind === 'highlighter'), ...local.filter((s) => s.kind !== 'highlighter')]
  const paths = ordered
    .map((s) => `  <path d="${strokePath(s)}" fill="${s.color ?? FILE_INK}"${s.kind === 'highlighter' ? ` fill-opacity="${HIGHLIGHT_OPACITY}"` : ''}/>`)
    .join('\n')
  const w = Math.round(box.width)
  const h = Math.round(box.height)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n  <metadata id="recto-drawing">${escapeXml(data)}</metadata>\n${paths}\n</svg>\n`
}

const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unescapeXml = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** The strokes a drawing's SVG keeps (relative to its box), or null for an SVG Recto did not draw. */
export function fromSvg(svg: string): Stroke[] | null {
  const m = /<metadata id="recto-drawing">([\s\S]*?)<\/metadata>/.exec(svg)
  if (m === null) return null
  try {
    const parsed = JSON.parse(unescapeXml(m[1]!)) as Stroke[]
    return Array.isArray(parsed) ? parsed.filter((s) => Array.isArray(s.points)) : null
  } catch {
    return null
  }
}

export const isDrawingSvg = (svg: string): boolean => svg.includes('<metadata id="recto-drawing">')

/** The distance between two segments, ab and cd. */
function segmentDistance(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const toSegment = (p: Pt, s: Pt, e: Pt): number => {
    const dx = e[0] - s[0]
    const dy = e[1] - s[1]
    const len = dx * dx + dy * dy
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / len))
    return Math.hypot(p[0] - (s[0] + t * dx), p[1] - (s[1] + t * dy))
  }
  // Crossing segments touch.
  const cross = (p: Pt, q: Pt, r: Pt): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(toSegment(a, c, d), toSegment(b, c, d), toSegment(c, a, b), toSegment(d, a, b))
}

/** The segments of a point list; a single point is a segment of no length. */
const segmentsOf = (points: readonly Pt[]): [Pt, Pt][] =>
  points.length === 1 ? [[points[0]!, points[0]!]] : points.slice(1).map((p, i) => [points[i]!, p])

/**
 * The strokes the eraser, dragged along `trail` with this reach, does not
 * touch: tested line against line, so a sweep between two of a stroke's
 * points still finds it, however far apart they are.
 */
export function erase(strokes: readonly Stroke[], trail: readonly Pt[], reach: number): Stroke[] {
  const swept = segmentsOf(trail)
  return strokes.filter(
    (s) => !segmentsOf(s.points).some(([a, b]) => swept.some(([c, d]) => segmentDistance(a, b, c, d) <= reach + s.size / 2)),
  )
}

/** A stroke's points, with points added between any two further apart than `step`: so a cut falls where the eraser passed. */
function densified(points: readonly Pt[], step: number): Pt[] {
  const out: Pt[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n])
  }
  return out
}

/**
 * The strokes after the eraser was dragged along `trail`, cutting: what it
 * passed over is taken out of each stroke, and what is left either side
 * stays as strokes of their own - as a pixel eraser does, but the pieces are
 * still strokes. A stroke it does not touch is the same stroke.
 */
export function cut(strokes: readonly Stroke[], trail: readonly Pt[], reach: number): Stroke[] {
  const swept = segmentsOf(trail)
  const touched = (p: Pt, size: number): boolean => swept.some(([c, d]) => segmentDistance(p, p, c, d) <= reach + size / 2)
  return strokes.flatMap((s) => {
    if (erase([s], trail, reach).length === 1) return [s]
    const points = densified(s.points, Math.max(1, Math.min(reach, s.size) / 2))
    const pieces: Pt[][] = [[]]
    for (const p of points) {
      if (touched(p, s.size)) {
        if (pieces[pieces.length - 1]!.length > 0) pieces.push([])
      } else pieces[pieces.length - 1]!.push(p)
    }
    // A piece too short to see is gone with the rest.
    return pieces.filter((piece) => piece.length >= 2).map((piece) => ({ ...s, points: piece }))
  })
}
