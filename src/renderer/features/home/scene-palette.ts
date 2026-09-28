/**
 * The home scene's palette: every colour both pages are painted with, read
 * from the theme's tokens (`--home-*` in tokens.css) rather than written into
 * the shaders, so the scene follows the theme - and crossfades to it.
 *
 * Pure: parsing, conversion and blending. Where the tokens come from and when
 * they change is the caller's business.
 */

/** How strongly the texture was drawn for each kind of line (hero-text.ts). */
export type InkBase = { meta: number; rule: number }

export type Palette = {
  /** Page one's ramp, seven stops in OKLab, shallow to deep. */
  ramp: Float32Array<ArrayBuffer>
  rampAt: Float32Array<ArrayBuffer>
  /** Page two's ramp under the glass. */
  glass: Float32Array<ArrayBuffer>
  glassAt: Float32Array<ArrayBuffer>
  /** The text and rules on page one, sRGB 0-1. */
  ink: Float32Array<ArrayBuffer>
  /**
   * Each kind of line's strength relative to how the texture drew it:
   * strong text, meta labels, grid rules. All ones leaves the texture as it is.
   */
  textWeights: Float32Array<ArrayBuffer>
  grain: number
  /** Which end of the ramp page two pushes toward behind its figures: 1 deep, 0 shallow. */
  statsTo: number
}

const STOPS = 7

/** Parse a CSS colour as tokens write them: `#rgb`, `#rrggbb`, `rgb(r g b)`, `hsl(h s% l%)`. sRGB 0-1. */
export function parseColor(value: string): [number, number, number] | null {
  const text = value.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)
  if (hex?.[1] !== undefined) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]
  }
  const fn = /^(rgb|hsl)a?\(([^)]*)\)$/.exec(text)
  if (fn?.[1] === undefined || fn[2] === undefined) return null
  const parts = fn[2]
    .split(/[\s,/]+/)
    .filter((p) => p !== '')
    .slice(0, 3)
  if (parts.length < 3) return null
  const num = parts.map((p) => parseFloat(p))
  if (num.some((n) => Number.isNaN(n))) return null
  if (fn[1] === 'rgb') {
    return parts.map((p, i) => (p.endsWith('%') ? num[i]! / 100 : num[i]! / 255)) as [number, number, number]
  }
  const [h, s, l] = [(((num[0]! % 360) + 360) % 360) / 360, num[1]! / 100, num[2]! / 100]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number): number => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (u < 1 / 6) return p + (q - p) * 6 * u
    if (u < 1 / 2) return q
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6
    return p
  }
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)]
}

/** sRGB 0-1 to OKLab. */
export function toOklab([r8, g8, b8]: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = [r8, g8, b8].map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363286807 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

const list = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')

function rampOf(value: string, name: string): Float32Array<ArrayBuffer> {
  const colours = list(value).map(parseColor)
  if (colours.length !== STOPS || colours.some((c) => c === null)) throw new Error(`${name}: ${STOPS} colours expected, got "${value}"`)
  return new Float32Array(colours.flatMap((c) => toOklab(c!)))
}

function stopsOf(value: string, name: string): Float32Array<ArrayBuffer> {
  const stops = value
    .trim()
    .split(/\s+/)
    .map((s) => parseFloat(s))
  if (stops.length !== STOPS || stops.some((s) => Number.isNaN(s))) throw new Error(`${name}: ${STOPS} stops expected, got "${value}"`)
  return new Float32Array(stops)
}

function numberOf(value: string, name: string): number {
  const n = parseFloat(value)
  if (Number.isNaN(n)) throw new Error(`${name}: a number expected, got "${value}"`)
  return n
}

/**
 * The palette the tokens describe. `read` returns a token's value as the
 * theme has it (a computed style's `getPropertyValue`); `base` is how strong
 * the texture draws meta labels and rules, which the theme's own strengths
 * are measured against.
 */
export function readPalette(read: (token: string) => string, base: InkBase): Palette {
  const get = (token: string): string => read(`--home-${token}`)
  const ink = parseColor(get('ink'))
  if (ink === null) throw new Error(`--home-ink: a colour expected, got "${get('ink')}"`)
  return {
    ramp: rampOf(get('ramp'), '--home-ramp'),
    rampAt: stopsOf(get('ramp-stops'), '--home-ramp-stops'),
    glass: rampOf(get('glass-ramp'), '--home-glass-ramp'),
    glassAt: stopsOf(get('glass-stops'), '--home-glass-stops'),
    ink: new Float32Array(ink),
    textWeights: new Float32Array([
      1,
      numberOf(get('meta-ink'), '--home-meta-ink') / base.meta,
      numberOf(get('rule-ink'), '--home-rule-ink') / base.rule,
    ]),
    grain: numberOf(get('grain'), '--home-grain'),
    statsTo: numberOf(get('stats-to'), '--home-stats-to'),
  }
}

const lerp = (a: Float32Array<ArrayBuffer>, b: Float32Array<ArrayBuffer>, t: number): Float32Array<ArrayBuffer> =>
  a.map((v, i) => v + (b[i]! - v) * t)

/**
 * Part way from one palette to another. Ramps blend in OKLab, stop by stop,
 * so the crossfade passes through no muddy greys; `t` of 0 and 1 return the
 * ends exactly.
 */
export function mixPalette(a: Palette, b: Palette, t: number): Palette {
  if (t <= 0) return a
  if (t >= 1) return b
  return {
    ramp: lerp(a.ramp, b.ramp, t),
    rampAt: lerp(a.rampAt, b.rampAt, t),
    glass: lerp(a.glass, b.glass, t),
    glassAt: lerp(a.glassAt, b.glassAt, t),
    ink: lerp(a.ink, b.ink, t),
    textWeights: lerp(a.textWeights, b.textWeights, t),
    grain: a.grain + (b.grain - a.grain) * t,
    statsTo: a.statsTo + (b.statsTo - a.statsTo) * t,
  }
}
