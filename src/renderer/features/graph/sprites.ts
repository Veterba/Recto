/**
 * Prepared drawing surfaces: the glow sprites, cached per colour, and resolving
 * any CSS colour to hex for them.
 */

import { type GraphLook, averageColor, parseHex, withAlpha } from './look'
import type { Palette } from './palette'

/** What the background implies for the colours drawn on it. */
type Surface = { dark: boolean; edge: string; node: string; orphan: string; label: string }

/**
 * The theme's colours - unless a tinted background has flipped how dark the
 * ground is. A deep navy wash over a light theme leaves the theme's dark grey
 * dots and labels unreadable, so the defaults follow the ground they sit on.
 */
export function surfaceFor(look: GraphLook, palette: Palette): Surface {
  const themeDark = palette.dark ?? true
  const tint = averageColor(look.background.colors)
  const base = parseHex(palette.background ?? '') ?? (themeDark ? [23, 23, 23] : [250, 250, 250])
  let dark = themeDark
  if (tint !== null) {
    const k = Math.min(100, Math.max(0, look.background.strength)) / 100
    const mixed = [0, 1, 2].map((i) => base[i]! * (1 - k) + tint[i]! * k)
    dark = (0.2126 * mixed[0]! + 0.7152 * mixed[1]! + 0.0722 * mixed[2]!) / 255 < 0.5
  }
  if (dark === themeDark) {
    return { dark, edge: palette.edge, node: palette.node, orphan: palette.nodeOrphan, label: palette.label }
  }
  // A tinted ground sits mid-way far more often than a theme does, so these
  // lean to contrast: a grey link that works on near-black vanishes on slate.
  return dark
    ? { dark, edge: '#cbd5e1', node: '#e2e8f0', orphan: '#94a3b8', label: 'rgba(241, 245, 249, 0.92)' }
    : { dark, edge: '#3f3f46', node: '#27272a', orphan: '#71717a', label: 'rgba(24, 24, 27, 0.9)' }
}

/** Soft round light, one per colour, drawn scaled - far cheaper than shadowBlur. */
const glowSprites = new Map<string, HTMLCanvasElement>()

export function glowSprite(colour: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  // Theme colours arrive as whatever CSS the token holds - `hsl(...)`, a name.
  // The gradient's alpha stops need a hex, and without one every stop came out
  // opaque and the "glow" was a solid square.
  const hex = toHex(colour)
  if (hex === null) return null
  colour = hex
  let sprite = glowSprites.get(colour)
  if (sprite === undefined) {
    sprite = document.createElement('canvas')
    sprite.width = 64
    sprite.height = 64
    const g = sprite.getContext('2d')
    if (g === null) return null
    const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, withAlpha(colour, 0.9))
    gradient.addColorStop(0.25, withAlpha(colour, 0.45))
    gradient.addColorStop(1, withAlpha(colour, 0))
    g.fillStyle = gradient
    g.fillRect(0, 0, 64, 64)
    if (glowSprites.size > 256) glowSprites.clear()
    glowSprites.set(colour, sprite)
  }
  return sprite
}

let probe: CanvasRenderingContext2D | null = null

const hexCache = new Map<string, string | null>()

/** Any CSS colour as `#rrggbb`, via the canvas's own colour parser. Null if it cannot be read. */
function toHex(colour: string): string | null {
  if (parseHex(colour) !== null) return colour
  const cached = hexCache.get(colour)
  if (cached !== undefined) return cached
  probe ??= document.createElement('canvas').getContext('2d')
  let out: string | null = null
  if (probe !== null) {
    probe.fillStyle = '#000000'
    probe.fillStyle = colour
    const value = String(probe.fillStyle)
    if (value.startsWith('#')) out = value
    else {
      const parts = /rgba?\(([^)]+)\)/
        .exec(value)?.[1]
        ?.split(',')
        .map((v) => Number.parseFloat(v))
      if (parts !== undefined && parts.length >= 3) {
        out = `#${parts
          .slice(0, 3)
          .map((v) => Math.round(v).toString(16).padStart(2, '0'))
          .join('')}`
      }
    }
  }
  hexCache.set(colour, out)
  return out
}
