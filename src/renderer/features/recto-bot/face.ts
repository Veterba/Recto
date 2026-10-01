/**
 * The bot's face: pure geometry, in the SVG's own units (viewBox -60 -60 120 120).
 *
 * The eyes sit on a sphere of radius 17 behind the page, so a sideways look
 * slides them along it and foreshortens them - that, and not the page turning,
 * is most of what makes the figure read as having depth. The lids are not drawn:
 * each eye is a capsule clipped by a polygon whose top edge is the upper lid and
 * bottom edge the lower one. Ink lids drawn over the eye leave hairline edges
 * at every size; a clip leaves none.
 */

export const PAGE_PATH = 'M-27 -30 Q-27 -36 -21 -36 L16 -36 L27 -25 L27 30 Q27 36 21 36 L-21 36 Q-27 36 -27 30 Z'
export const CORNER_PATH = 'M16 -36 L27 -25 L16 -25 Z'
export const LINE_PATHS = ['M-15 15 L15 15', 'M-15 22 L9 22', 'M-15 29 L1 29'] as const

/** Below this size in px the bot drops its text lines and gets bigger eyes. */
export const SMALL_PX = 60

const SPHERE_R = 17
const EYE_Y = -8
/** Small bots' eyes, relative to full size: the reference's 6.6 × 13.5 against 5 × 12. */
const SMALL_WIDTH = 6.6 / 5
const SMALL_HEIGHT = 13.5 / 12
/** How far the eyes may slide sideways: the page's edge, less a margin. */
const EYE_X_LIMIT = 16.5
/** The visible strip between the lids never gets thinner than this: a closed eye is a short line. */
export const MIN_STRIP = 2.2
/** Half-width of the clip polygon: wider than any eye, so only its top and bottom edges clip. */
const CLIP_HALF = 12
const MAX_SLANT_DEG = 14

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export type EyeInput = {
  /** -1 for the left eye, 1 for the right. */
  side: -1 | 1
  /** Gaze, roughly -1..1 each way (1 = right, down). */
  gx: number
  gy: number
  /** Surprise: height × wide, width × (0.4 + 0.6 × wide). */
  wide: number
  /** 0..1, the vertical squeeze of a blink. */
  blink: number
  small: boolean
  /** The bot's eyes at full size (BotLook.eyes). */
  eyes: { width: number; height: number; spacing: number }
}

export type EyeShape = {
  /** Centre of the eye on the face. */
  cx: number
  cy: number
  /** The capsule before the blink squeezes it: what the lids are measured against. */
  width: number
  height: number
  /** The capsule as drawn, blink applied. */
  rect: { x: number; y: number; width: number; height: number; rx: number }
}

/** Where an eye lands on the sphere for a gaze, and how foreshortened it is. */
export function projectEye({ side, gx, gy, wide, blink, small, eyes }: EyeInput): EyeShape {
  const a = Math.asin((side * eyes.spacing) / SPHERE_R) + gx * 0.62
  const cx = clamp(Math.sin(a) * SPHERE_R, -EYE_X_LIMIT, EYE_X_LIMIT)
  const fx = Math.max(0.58, Math.cos(a))
  const b = gy * 0.5
  const cy = EYE_Y + Math.sin(b) * 8.5
  const fy = Math.max(0.6, Math.cos(b))
  const width = eyes.width * (small ? SMALL_WIDTH : 1) * fx * (0.4 + 0.6 * wide)
  const height = eyes.height * (small ? SMALL_HEIGHT : 1) * fy * wide
  const squeezed = Math.max(1.6, height * (1 - 0.85 * blink))
  return {
    cx,
    cy,
    width,
    height,
    rect: { x: cx - width / 2, y: cy - squeezed / 2, width, height: squeezed, rx: Math.min(width, squeezed) / 2 },
  }
}

export type Lids = {
  /** 0..1 of the eye's height, from the top. */
  upper: number
  /** 0..1, from the bottom; scaled by 0.6, a lower lid never rises far. */
  lower: number
  /** 0..1: inner corners down, up to 14°. */
  slant: number
}

/**
 * The clip polygon for one eye, as SVG `points`. Its top edge is the upper lid,
 * tilted by the slant; its bottom edge the lower lid. The strip between them is
 * never thinner than MIN_STRIP.
 */
export function lidPolygon(eye: Pick<EyeShape, 'cx' | 'cy' | 'height'>, side: -1 | 1, lids: Lids): string {
  const top = eye.cy - eye.height / 2
  const bottom = top + eye.height - eye.height * lids.lower * 0.6
  const lid = Math.min(top + eye.height * lids.upper, bottom - MIN_STRIP)
  // Positive slant drops the edge toward the face's centre line: for the right
  // eye that is its left end, for the left eye its right end.
  const drop = Math.tan((lids.slant * MAX_SLANT_DEG * Math.PI) / 180) * CLIP_HALF * side
  const x0 = eye.cx - CLIP_HALF
  const x1 = eye.cx + CLIP_HALF
  return `${f(x0)},${f(lid + drop)} ${f(x1)},${f(lid - drop)} ${f(x1)},${f(bottom)} ${f(x0)},${f(bottom)}`
}

const f = (n: number): string => n.toFixed(2)
