/**
 * How the graph looks: colours, node and link styling, labels, backdrop.
 *
 * Kept apart from the physics on purpose - changing a colour must never move a
 * node, and a look is something to try on and take off. Every field is plain
 * data so it round-trips through `.recto/graph.json`, and everything is read
 * defensively because that file is human-editable.
 *
 * The default look is exactly the graph as it was before any of this existed:
 * theme colours, straight links, no glow. Styles are opt-in.
 */

export type GradientScale = 'linear' | 'log'
export type NodeShape = 'dot' | 'ring'

/**
 * Colour is edited the same way everywhere in the app - up to three colours on
 * a pad and a strength (see `ColorEditor`) - so every coloured part of the
 * graph is described the same way too.
 */
export type Paint = {
  /** 0-3 hex colours. None means the theme's own colour. */
  colors: string[]
  /** How much of the colour shows over the theme's, 0-100. */
  strength: number
}

export type GraphLook = {
  /** Notes. With colours, few-links → most-links runs along them. */
  dots: Paint & {
    /** One colour per top-level folder instead. */
    byFolder: boolean
    /** 'log' spreads the colours when a few hubs dwarf everything else. */
    scale: GradientScale
  }
  node: {
    /** Multiplier on every node's size. */
    size: number
    /** How much a node grows with its links; 0 makes every node the same. */
    growth: number
    /** Soft light around each node, 0-1. */
    glow: number
    opacity: number
    shape: NodeShape
  }
  /** Links. */
  links: Paint & {
    /** Take each link's colour from the notes it joins. */
    matchDots: boolean
  }
  edge: {
    /** Screen pixels. */
    width: number
    opacity: number
    /** 0 is straight; 1 bows each link into an arc. */
    curve: number
    arrows: boolean
    /** Signals travelling along the links. */
    pulses: boolean
    pulseSpeed: number
  }
  label: {
    size: number
    /** Zoom below which ordinary labels are hidden. */
    fadeZoom: number
    /** How many notes get a label in a crowded graph: 0 hubs only … 3 every note. */
    density: number
  }
  /** Behind the graph. The only part that takes grain - texture on a dot is noise. */
  background: Paint & { grain: number }
}

/** The graph as it looked before any of this existed: theme colours, straight links, no glow. */
export const DEFAULT_LOOK: GraphLook = {
  dots: { colors: [], strength: 100, byFolder: false, scale: 'log' },
  node: { size: 1, growth: 1, glow: 0, opacity: 1, shape: 'dot' },
  links: { colors: [], strength: 100, matchDots: false },
  edge: { width: 1, opacity: 0.55, curve: 0, arrows: false, pulses: false, pulseSpeed: 1 },
  label: { size: 11, fadeZoom: 0.55, density: 1 },
  background: { colors: [], strength: 60, grain: 0 },
}

/** Swatches under the pad. Wider than the sidebar's: dots can be white, ink or neon. */
export const GRAPH_SWATCHES: readonly { id: string; label: string; colors: string[] }[] = [
  { id: 'none', label: 'Theme', colors: [] },
  { id: 'white', label: 'White', colors: ['#f5f5f5'] },
  { id: 'ink', label: 'Ink', colors: ['#18181b'] },
  { id: 'sky', label: 'Sky', colors: ['#38bdf8'] },
  { id: 'rose', label: 'Rose', colors: ['#f472b6'] },
  { id: 'amber', label: 'Amber', colors: ['#f59e0b'] },
  { id: 'heat', label: 'Green to red', colors: ['#22c55e', '#facc15', '#ef4444'] },
  { id: 'neuron', label: 'Cyan to violet', colors: ['#22d3ee', '#818cf8', '#f0abfc'] },
  { id: 'bloom', label: 'Teal to rose', colors: ['#5eead4', '#c084fc', '#e11d48'] },
  { id: 'ocean', label: 'Blue to amber', colors: ['#60a5fa', '#f59e0b'] },
  { id: 'night', label: 'Night', colors: ['#0b1224', '#1e1b4b'] },
  { id: 'paper', label: 'Paper', colors: ['#fbfaf6'] },
]

// --- sizes --------------------------------------------------------------------

/**
 * Obsidian's own size curve, read out of its renderer:
 *
 *   getSize() { return fNodeSizeMult * Math.max(8, Math.min(3 * Math.sqrt(this.weight + 1), 30)) }
 *
 * with `weight` the number of related notes - links out plus links in. Two
 * things in it matter more than the square root: a floor, so everything up to
 * six links is drawn identically, and a ceiling at 99, so one enormous hub does
 * not flatten the rest of the scale. That is why an Obsidian graph reads as a
 * field of equal dots with a handful of obvious hubs rather than a gradient -
 * and why a note with seven links looks like a note with one.
 */
const obsidianSize = (degree: number): number => Math.max(8, Math.min(3 * Math.sqrt(degree + 1), 30))

/** Where a note sits on that curve, 0 at the floor and 1 at the ceiling. */
const sizeT = (degree: number): number => (obsidianSize(degree) - 8) / (30 - 8)

/**
 * A node's radius in world units.
 *
 * `size` sets what the smallest note is drawn at and `growth` how much a note
 * grows with its links, so the pair is exactly the two ends of the size
 * control: `[3 x size, size x (3 + 7 x growth)]`. Obsidian's curve is what runs
 * between them, so the hubs stand out in the same places its graph does.
 *
 * The worker uses the same function for collisions, so what is drawn and what
 * is kept apart agree.
 */
export const nodeRadius = (degree: number, size = 1, growth = 1): number =>
  size * (3 + growth * 7 * sizeT(degree))

/** Where a node sits between "few links" (0) and "most links" (1). */
export function degreeT(degree: number, maxDegree: number, scale: GradientScale): number {
  if (maxDegree <= 0 || degree <= 0) return 0
  const t = scale === 'log' ? Math.log1p(degree) / Math.log1p(maxDegree) : degree / maxDegree
  return Math.min(1, Math.max(0, t))
}

// --- colour -------------------------------------------------------------------

export type Rgb = [number, number, number]

export function parseHex(value: string): Rgb | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (match?.[1] === undefined) return null
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1]
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

const toHex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return [h * 60, s, l]
}

function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/**
 * Blend two colours through hue, not through RGB.
 *
 * Mixing green and red channel by channel passes through a muddy brown; going
 * round the colour wheel passes through yellow, which is what anyone picking
 * "green to red" expects to see in the middle. Greys (no saturation) take the
 * other colour's hue so a grey-to-colour ramp does not swing through the wheel.
 */
export function mixColor(a: string, b: string, t: number): string {
  const ra = parseHex(a)
  const rb = parseHex(b)
  if (ra === null || rb === null) return ra !== null ? toHex(ra) : rb !== null ? toHex(rb) : '#888888'
  const ha = rgbToHsl(ra)
  const hb = rgbToHsl(rb)
  if (ha[1] < 0.05) ha[0] = hb[0]
  if (hb[1] < 0.05) hb[0] = ha[0]
  let dh = hb[0] - ha[0]
  if (dh > 180) dh -= 360
  if (dh < -180) dh += 360
  const h = (ha[0] + dh * t + 360) % 360
  return toHex(hslToRgb([h, ha[1] + (hb[1] - ha[1]) * t, ha[2] + (hb[2] - ha[2]) * t]))
}

/** A colour along 1-3 stops. */
export function gradientAt(colors: readonly string[], t: number): string {
  if (colors.length === 0) return '#888888'
  if (colors.length === 1) return colors[0]!
  if (colors.length === 2) return mixColor(colors[0]!, colors[1]!, t)
  return t < 0.5 ? mixColor(colors[0]!, colors[1]!, t * 2) : mixColor(colors[1]!, colors[2]!, (t - 0.5) * 2)
}

/** Colours are drawn from a fixed number of steps, so nodes batch by colour. */
export const COLOR_STEPS = 24

/**
 * The steps for a paint, laid over a base colour at the paint's strength.
 *
 * Strength mixes toward the theme's colour rather than fading to transparent:
 * a half-strength dot is a muted version of its colour, not a ghost of one.
 */
export function paintSteps(paint: Paint, base: string): string[] {
  const k = Math.min(100, Math.max(0, paint.strength)) / 100
  return Array.from({ length: COLOR_STEPS }, (_, i) => {
    const colour = gradientAt(paint.colors, i / (COLOR_STEPS - 1))
    return k >= 1 || parseHex(base) === null ? colour : mixColor(base, colour, k)
  })
}

/** The average of a paint's colours, for judging how dark a background is. */
export function averageColor(colors: readonly string[]): Rgb | null {
  const parsed = colors.map(parseHex).filter((c): c is Rgb => c !== null)
  if (parsed.length === 0) return null
  return [0, 1, 2].map((i) => parsed.reduce((sum, c) => sum + c[i]!, 0) / parsed.length) as Rgb
}

/** Evenly spaced hues for folder colours, bright enough for either backdrop. */
export function groupColor(index: number, dark: boolean): string {
  const hue = (index * 137.508 + 200) % 360
  return toHex(hslToRgb([hue, 0.68, dark ? 0.64 : 0.5]))
}

/** `rgba()` from a hex colour, for canvas styles that need an alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex)
  if (rgb === null) return hex
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

// --- reading a saved look -------------------------------------------------------

const num = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

const hex = (value: unknown, fallback: string): string =>
  typeof value === 'string' && parseHex(value) !== null ? value : fallback

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const paint = (value: unknown, fallback: Paint): Paint => {
  const p = record(value)
  const colors = Array.isArray(p['colors'])
    ? p['colors'].filter((c): c is string => typeof c === 'string' && parseHex(c) !== null).slice(0, 3)
    : fallback.colors
  return { colors, strength: num(p['strength'], fallback.strength, 0, 100) }
}

/**
 * Read a saved look, field by field.
 *
 * Also reads the first version of this file, which had `color.from/via/to`,
 * `edge.mode` and a named `backdrop` - a look someone made with that version
 * comes back as close to itself as the new model allows, instead of silently
 * resetting to the theme.
 */
export function coerceLook(raw: unknown): GraphLook {
  const r = record(raw)
  const d = DEFAULT_LOOK
  const n = record(r['node'])
  const e = record(r['edge'])
  const l = record(r['label'])

  // --- first version ---
  const old = record(r['color'])
  const oldStops = ['from', 'via', 'to'].map((k) => old[k]).filter((c): c is string => typeof c === 'string' && parseHex(c) !== null)
  const legacyDots =
    r['dots'] === undefined && old['mode'] !== undefined
      ? { colors: old['mode'] === 'gradient' ? oldStops : [], strength: 100, byFolder: old['mode'] === 'folder', scale: old['scale'] }
      : undefined
  const legacyLinks =
    r['links'] === undefined && e['mode'] !== undefined
      ? {
          colors: e['mode'] === 'custom' && typeof e['color'] === 'string' && parseHex(e['color']) !== null ? [e['color']] : [],
          strength: 100,
          matchDots: e['mode'] === 'nodes',
        }
      : undefined
  const legacyBackground =
    r['background'] === undefined && typeof r['backdrop'] === 'string' && r['backdrop'] !== 'theme'
      ? { colors: [r['backdrop'] === 'space' ? '#070b16' : '#fbfaf6'], strength: 100, grain: 0 }
      : undefined

  const dotsRaw = record(r['dots'] ?? legacyDots)
  const linksRaw = record(r['links'] ?? legacyLinks)
  const backgroundRaw = record(r['background'] ?? legacyBackground)

  return {
    dots: {
      ...paint(dotsRaw, d.dots),
      byFolder: typeof dotsRaw['byFolder'] === 'boolean' ? dotsRaw['byFolder'] : d.dots.byFolder,
      scale: oneOf(dotsRaw['scale'], ['linear', 'log'] as const, d.dots.scale),
    },
    node: {
      size: num(n['size'], d.node.size, 0.3, 3),
      growth: num(n['growth'], d.node.growth, 0, 3),
      glow: num(n['glow'], d.node.glow, 0, 1),
      opacity: num(n['opacity'], d.node.opacity, 0.15, 1),
      shape: oneOf(n['shape'], ['dot', 'ring'] as const, d.node.shape),
    },
    links: {
      ...paint(linksRaw, d.links),
      matchDots: typeof linksRaw['matchDots'] === 'boolean' ? linksRaw['matchDots'] : d.links.matchDots,
    },
    edge: {
      width: num(e['width'], d.edge.width, 0.2, 5),
      opacity: num(e['opacity'], d.edge.opacity, 0.03, 1),
      curve: num(e['curve'], d.edge.curve, 0, 1),
      arrows: typeof e['arrows'] === 'boolean' ? e['arrows'] : d.edge.arrows,
      pulses: typeof e['pulses'] === 'boolean' ? e['pulses'] : d.edge.pulses,
      pulseSpeed: num(e['pulseSpeed'], d.edge.pulseSpeed, 0.2, 4),
    },
    label: {
      size: num(l['size'], d.label.size, 7, 22),
      fadeZoom: num(l['fadeZoom'], d.label.fadeZoom, 0.05, 3),
      density: Math.round(num(l['density'], d.label.density, 0, 3)),
    },
    background: {
      ...paint(backgroundRaw, d.background),
      grain: num(backgroundRaw['grain'], d.background.grain, 0, 100),
    },
  }
}
