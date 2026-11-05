import { getStroke } from 'perfect-freehand'

/**
 * Drawings on a canvas: freehand strokes kept as an SVG file in the vault, put
 * on the canvas as an ordinary file node - so Obsidian shows it as a picture,
 * and Recto opens it again to draw more or to erase. The strokes themselves
 * (their points) are kept inside the SVG, in a `<metadata>` element, so a
 * drawing is edited as strokes, not as pixels.
 *
 * A stroke is a little tidied when it ends, never forced: one that is nearly
 * straight is pulled toward a straight line, one that nearly closes on itself
 * as a round toward an ellipse, and handwriting is only smoothed - all by a
 * part of the way, so a hand-drawn line still looks hand-drawn.
 */

/** A point: x, y in canvas units, and the pen's pressure (0.5 when the device gives none). */
export type Pt = [number, number, number]
export type Stroke = { points: Pt[]; color: string | null; size: number }
export type Box = { x: number; y: number; width: number; height: number }

/** The ink a stroke is written with in the file when it has no colour of its own: what Obsidian shows. */
export const FILE_INK = '#1f1f1f'
export const PEN_SIZE = 4
/** Room left round the strokes inside the drawing's box, so a thick line's edge is not cut. */
const MARGIN = 12

/** A stroke's outline, as SVG path data: perfect-freehand's shape for the pen. */
export function strokePath(stroke: Stroke): string {
  const outline = getStroke(stroke.points, { size: stroke.size, thinning: 0.5, smoothing: 0.6, streamline: 0.5, simulatePressure: stroke.points.every((p) => p[2] === 0.5) })
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
  const paths = local.map((s) => `  <path d="${strokePath(s)}" fill="${s.color ?? FILE_INK}"/>`).join('\n')
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

/** How much of the way to the ideal shape a stroke is pulled: enough to look drawn well, not drawn by a ruler. */
const PULL_LINE = 0.6
const PULL_ROUND = 0.45

const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1])
const lengthOf = (pts: readonly Pt[]): number => pts.reduce((sum, p, i) => (i === 0 ? 0 : sum + dist(pts[i - 1]!, p)), 0)

/** A stroke as drawn, a little tidied: see the top of this file. */
export function tidy(points: readonly Pt[]): Pt[] {
  if (points.length < 3) return [...points]
  const length = lengthOf(points)
  if (length < 8) return [...points]
  const a = points[0]!
  const b = points[points.length - 1]!

  // Nearly straight: every point close to the line from the first to the last.
  const chord = dist(a, b)
  if (chord > length * 0.92) {
    const dx = (b[0] - a[0]) / (chord || 1)
    const dy = (b[1] - a[1]) / (chord || 1)
    return points.map((p) => {
      const t = (p[0] - a[0]) * dx + (p[1] - a[1]) * dy
      const on: Pt = [a[0] + dx * t, a[1] + dy * t, p[2]]
      return [p[0] + (on[0] - p[0]) * PULL_LINE, p[1] + (on[1] - p[1]) * PULL_LINE, p[2]]
    })
  }

  // Nearly closed, and round: every point about as far from the middle as the rest, by its axis.
  if (chord < length * 0.15) {
    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const rx = (Math.max(...xs) - Math.min(...xs)) / 2
    const ry = (Math.max(...ys) - Math.min(...ys)) / 2
    if (rx > 4 && ry > 4) {
      const off = points.map((p) => Math.abs(Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry) - 1))
      const mean = off.reduce((s, v) => s + v, 0) / off.length
      if (mean < 0.12) {
        return points.map((p) => {
          const angle = Math.atan2((p[1] - cy) / ry, (p[0] - cx) / rx)
          const on: Pt = [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle), p[2]]
          return [p[0] + (on[0] - p[0]) * PULL_ROUND, p[1] + (on[1] - p[1]) * PULL_ROUND, p[2]]
        })
      }
    }
  }

  // Anything else - handwriting, a scribble: only smoothed, each point a little toward its neighbours.
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return p
    const prev = points[i - 1]!
    const next = points[i + 1]!
    return [(prev[0] + p[0] * 2 + next[0]) / 4, (prev[1] + p[1] * 2 + next[1]) / 4, p[2]]
  })
}

/** The strokes the eraser, at `at` with this reach, does not touch. */
export function erase(strokes: readonly Stroke[], at: { x: number; y: number }, reach: number): Stroke[] {
  return strokes.filter((s) => !s.points.some(([x, y]) => Math.hypot(x - at.x, y - at.y) <= reach + s.size / 2))
}
