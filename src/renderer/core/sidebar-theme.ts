/**
 * The sidebar's own colour, the way Arc does it.
 *
 * Up to three colours blended across the panel, how much of the panel they
 * take, and how much grain sits over it - all laid OVER the frosted panel
 * rather than replacing it, so the blur, the backdrop and every text colour
 * still come from the theme. That is what makes it safe to hand a colour picker
 * to a user: the worst they can do is make the sidebar green, not unreadable.
 *
 * Colours are picked on a 2D pad rather than typed: across is hue, down is
 * lightness, saturation is fixed. One fixed saturation is a deliberate loss -
 * it is what keeps every point on the pad a colour that works as a wash over
 * both themes, instead of half the pad being mud or neon.
 */

export type SidebarTheme = {
  /** 1-3 hex colours, `#rrggbb`. Empty means no tint at all. */
  colors: string[]
  /** How strongly the tint sits over the panel, 0-100. */
  strength: number
  /**
   * Grain, 0-100. 50 is the theme's own amount, 0 is none, and the top half of
   * the dial goes well past anything the theme would choose - see
   * `grainLevels`.
   *
   * Relative rather than absolute because the themes already disagree on the
   * right amount - light frost wants less than dark - and a single absolute
   * number would move one of them away from where it was tuned.
   */
  grain: number
}

export const MAX_STOPS = 3

/** Fixed, not a control: Arc does not expose one, and a third knob for it earned nothing. */
const GRADIENT_ANGLE = 160

export const NO_THEME: SidebarTheme = { colors: [], strength: 45, grain: 50 }

/**
 * The swatch row.
 *
 * Picked to be distinguishable at 20px and to work as a wash over both a dark
 * panel and a light one - which rules out anything very dark, since a dark tint
 * on the dark theme's already-dark panel is not a colour, it is a smudge.
 */
export const PRESETS: readonly { id: string; label: string; colors: string[] }[] = [
  { id: 'none', label: 'None', colors: [] },
  { id: 'sand', label: 'Sand', colors: ['#e8dcc8'] },
  { id: 'rose', label: 'Rose', colors: ['#f0a6c8'] },
  { id: 'plum', label: 'Plum', colors: ['#a274c4'] },
  { id: 'ember', label: 'Ember', colors: ['#e2584a'] },
  { id: 'amber', label: 'Amber', colors: ['#f0a63c'] },
  { id: 'citrus', label: 'Citrus', colors: ['#e8cf4a'] },
  { id: 'mint', label: 'Mint', colors: ['#5cd49a'] },
  { id: 'sky', label: 'Sky', colors: ['#5aaee0'] },
  { id: 'indigo', label: 'Indigo', colors: ['#5a5fbf'] },
  // Two- and three-stop presets, because the gradient is the point and an
  // empty gradient editor is a feature nobody finds.
  { id: 'dusk', label: 'Dusk', colors: ['#f0a6c8', '#5a5fbf'] },
  { id: 'lagoon', label: 'Lagoon', colors: ['#5cd49a', '#5aaee0', '#5a5fbf'] },
]

const HEX = /^#[0-9a-f]{6}$/i

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
export function tintCss(theme: Pick<SidebarTheme, 'colors' | 'strength'>): string {
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

/** Read one back out of appearance.json, refusing anything malformed. */
export function coerceSidebarTheme(value: unknown): SidebarTheme {
  if (typeof value !== 'object' || value === null) return NO_THEME
  const v = value as Partial<SidebarTheme>
  const colors = Array.isArray(v.colors)
    ? v.colors.filter((color): color is string => typeof color === 'string' && HEX.test(color)).slice(0, MAX_STOPS)
    : []
  const clamp = (n: unknown, fallback: number): number =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback
  return {
    colors,
    strength: clamp(v.strength, NO_THEME.strength),
    grain: clamp(v.grain, NO_THEME.grain),
  }
}

// --- the pad ----------------------------------------------------------------

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
    .map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0'))
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
