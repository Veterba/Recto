/**
 * The graph's colours, read from the theme's custom properties.
 */

const css = (name: string, fallback: string): string => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

export type Palette = {
  edge: string
  edgeActive: string
  node: string
  nodeActive: string
  nodeOrphan: string
  label: string
  labelActive: string
  /** Whether the app's own background is dark. */
  dark?: boolean
  /** The app's background, for working out what a tinted background comes to. */
  background?: string
}

/** Rough luminance of a CSS colour string, 0-1; unknown formats count as dark. */
function luminance(colour: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour)
  let rgb: number[] | null = null
  if (hex?.[1] !== undefined) rgb = [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16))
  const fn = /rgba?\(([^)]+)\)/.exec(colour)
  if (fn?.[1] !== undefined)
    rgb = fn[1]
      .split(/[ ,/]+/)
      .slice(0, 3)
      .map(Number)
  if (rgb === null || rgb.some((v) => !Number.isFinite(v))) return 0
  return (0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!) / 255
}

export function readPalette(): Palette {
  const accent = css('--accent', '#8b7cf8')
  return {
    edge: css('--border-strong', '#3d3d48'),
    edgeActive: accent,
    node: css('--text-muted', '#6f6f7d'),
    nodeActive: accent,
    // A step quieter than a linked note, not invisible: `--border` all but
    // vanished against the dark page, and a note you cannot see in the graph
    // reads as one the graph has lost.
    nodeOrphan: css('--border-strong', '#3d3d48'),
    label: css('--text-secondary', '#a6a6b2'),
    labelActive: accent,
    dark: luminance(css('--bg-primary', '#171717')) < 0.5,
    background: css('--bg-primary', '#171717'),
  }
}
