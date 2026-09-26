/**
 * Tints: a few colours as one soft gradient wash, the grain over it, and the
 * colour pad the editor picks stops from. Used by the sidebar theme, the graph
 * background and the colour editor.
 */

export const MAX_STOPS = 3

/** Fixed, not a control: Arc does not expose one, and a third knob for it earned nothing. */
const GRADIENT_ANGLE = 160

export const HEX = /^#[0-9a-f]{6}$/i

/** `#rrggbb` to `r g b`, for the space-separated rgb() syntax. */
export function channels(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`
}

/**
 * The CSS, or `none`.
 *
 * A single stop still has to be a gradient rather than a flat colour: it sits
 * in `background-image`, over the panel's `background-color`, and a plain
 * colour there would be an image with no colour. `linear-gradient(c, c)` is the
 * standard way to say "a flat wash" in an image slot.
 */
export function tintCss(theme: { colors: readonly string[]; strength: number }): string {
  const stops = theme.colors.filter((color) => HEX.test(color)).slice(0, MAX_STOPS)
  if (stops.length === 0 || theme.strength <= 0) return 'none'

  const alpha = (Math.min(100, Math.max(0, theme.strength)) / 100).toFixed(3)
  const parts = stops.map((color) => `rgb(${channels(color)} / ${alpha})`)
  if (parts.length === 1) return `linear-gradient(${parts[0]}, ${parts[0]})`
  return `linear-gradient(${GRADIENT_ANGLE}deg, ${parts.join(', ')})`
}

/**
 * What the stylesheet needs to draw a grain setting.
 *
 * Two numbers, because one layer cannot get there. The theme's grain is a
 * noise tile drawn at 42% and blended as an overlay; CSS opacity stops at 1, so
 * even fully opaque that layer is only a moderate texture. "A lot" needs a
 * second, much heavier tile.
 *
 * - `amount` multiplies the theme's own layer. 0-50 on the dial is 0-1x, so 50
 *   is exactly what the theme was tuned to; above 50 it keeps climbing until the
 *   layer is fully opaque.
 * - `boost` fades in the heavy layer, 0 at 50 and 1 at 100. Below 50 it is 0,
 *   so the lower half of the dial is untouched by it.
 */
export function grainLevels(grain: number): { amount: number; boost: number } {
  const g = Math.min(100, Math.max(0, grain))
  if (g <= 50) return { amount: g / 50, boost: 0 }
  const over = (g - 50) / 50
  return { amount: 1 + over * 2.5, boost: over }
}

/**
 * The part of colour space a pad covers: lightness at its top and bottom
 * edges, and the one saturation every point on it has.
 *
 * The sidebar's range is narrow on purpose (see above). Other surfaces can ask
 * for a wider one - a graph wants near-white and near-black dots, which a wash
 * over a panel never does.
 */
export type PadRange = { top: number; bottom: number; saturation: number }

export const SIDEBAR_PAD: PadRange = { top: 0.86, bottom: 0.34, saturation: 0.68 }

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const value = Number.parseInt(hex.slice(1), 16)
  const r = ((value >> 16) & 255) / 255
  const g = ((value >> 8) & 255) / 255
  const b = (value & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: h * 60, s, l }
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return `#${[f(0), f(8), f(4)]
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** Where a colour sits on the pad, both axes 0-1. */
export function padPosition(hex: string, range: PadRange = SIDEBAR_PAD): { x: number; y: number } {
  if (!HEX.test(hex)) return { x: 0.5, y: 0.5 }
  const { h, l } = hexToHsl(hex)
  return {
    x: h / 360,
    y: Math.min(1, Math.max(0, (range.top - l) / (range.top - range.bottom))),
  }
}

/** The colour at a point on the pad. */
export function colorAt(x: number, y: number, range: PadRange = SIDEBAR_PAD): string {
  const cx = Math.min(1, Math.max(0, x))
  const cy = Math.min(1, Math.max(0, y))
  return hslToHex(cx * 359.9, range.saturation, range.top - cy * (range.top - range.bottom))
}

/**
 * Where a new colour goes: across the pad from the last one, same height.
 *
 * Duplicating the last colour would add a stop that changes nothing, which
 * looks like the button is broken.
 */
export function nextStop(colors: readonly string[], range: PadRange = SIDEBAR_PAD): string {
  const last = colors[colors.length - 1]
  if (last === undefined || !HEX.test(last)) return colorAt(0.56, 0.45, range)
  const { x, y } = padPosition(last, range)
  return colorAt((x + 0.28) % 1, y, range)
}
