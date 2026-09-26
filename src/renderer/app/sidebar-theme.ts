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

import { HEX, MAX_STOPS } from '../ui/tint'
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
