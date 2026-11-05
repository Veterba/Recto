import { styleOf, type CanvasNode } from '@shared/canvas'

/**
 * Shapes: text nodes drawn as a figure, the text inside it. A shape is
 * `styleAttributes.shape` on a text node, as the Advanced Canvas plugin keeps
 * it; the names it has (circle, diamond, pill, parallelogram) are its names,
 * so Obsidian with that plugin draws those the same. The rest are Recto's,
 * and a plain box anywhere else.
 *
 * Figures are drawn in a 100 × 100 box stretched to the node, the line kept
 * its width; the two with round ends (rectangle, pill) are drawn to the
 * node's real size, so their corners stay round.
 */

export const SHAPES = [
  'rectangle',
  'circle',
  'triangle',
  'diamond',
  'hexagon',
  'pill',
  'parallelogram',
  'star',
  'cloud',
  'heart',
  'x-box',
  'check-box',
  'arrow-left',
  'arrow-up',
  'arrow-down',
  'arrow-right',
] as const
export type Shape = (typeof SHAPES)[number]

export const SHAPE_LABELS: Readonly<Record<Shape, string>> = {
  rectangle: 'Rectangle',
  circle: 'Ellipse',
  triangle: 'Triangle',
  diamond: 'Diamond',
  hexagon: 'Hexagon',
  pill: 'Pill',
  parallelogram: 'Parallelogram',
  star: 'Star',
  cloud: 'Cloud',
  heart: 'Heart',
  'x-box': 'X box',
  'check-box': 'Check box',
  'arrow-left': 'Arrow left',
  'arrow-up': 'Arrow up',
  'arrow-down': 'Arrow down',
  'arrow-right': 'Arrow right',
}

export const isShape = (value: string): value is Shape => (SHAPES as readonly string[]).includes(value)

/** A text node's shape, or null for a text card. */
export function shapeOf(node: CanvasNode): Shape | null {
  if (node.type !== 'text') return null
  const shape = styleOf(node)['shape']
  return shape !== undefined && isShape(shape) ? shape : null
}

/** A figure: its outline (filled) and, for the two boxes, the mark inside (a line only). */
export type Figure = { outline: string; mark?: string; unit: boolean }

const roundRect = (w: number, h: number, r: number, s: number): string =>
  `M${s + r} ${s}H${w - s - r}A${r} ${r} 0 0 1 ${w - s} ${s + r}V${h - s - r}A${r} ${r} 0 0 1 ${w - s - r} ${h - s}` +
  `H${s + r}A${r} ${r} 0 0 1 ${s} ${h - s - r}V${s + r}A${r} ${r} 0 0 1 ${s + r} ${s}Z`

function star(): string {
  const points: string[] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 48 : 20
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    points.push(`${(50 + r * Math.cos(a)).toFixed(1)} ${(52 + r * Math.sin(a)).toFixed(1)}`)
  }
  return `M${points.join('L')}Z`
}

const BOX = 'M6 6H94V94H6Z'

const UNIT: Readonly<Record<Exclude<Shape, 'rectangle' | 'pill'>, Omit<Figure, 'unit'>>> = {
  circle: { outline: 'M50 2A48 48 0 1 1 50 98A48 48 0 1 1 50 2Z' },
  triangle: { outline: 'M50 3L98 97H2Z' },
  diamond: { outline: 'M50 2L98 50L50 98L2 50Z' },
  hexagon: { outline: 'M25 3H75L98 50L75 97H25L2 50Z' },
  parallelogram: { outline: 'M22 3H98L78 97H2Z' },
  star: { outline: star() },
  cloud: {
    outline:
      'M26 86C12 86 3 76 3 63C3 51 11 42 22 40C22 24 35 12 50 12C63 12 73 20 77 32C89 33 97 44 97 57C97 73 85 86 70 86Z',
  },
  heart: {
    outline: 'M50 92C20 72 3 55 3 32C3 16 15 5 29 5C39 5 46 11 50 19C54 11 61 5 71 5C85 5 97 16 97 32C97 55 80 72 50 92Z',
  },
  'x-box': { outline: BOX, mark: 'M28 28L72 72M72 28L28 72' },
  'check-box': { outline: BOX, mark: 'M26 52L43 69L75 32' },
  'arrow-left': { outline: 'M97 32H42V8L3 50L42 92V68H97Z' },
  'arrow-up': { outline: 'M32 97V42H8L50 3L92 42H68V97Z' },
  'arrow-down': { outline: 'M32 3V58H8L50 97L92 58H68V3Z' },
  'arrow-right': { outline: 'M3 32H58V8L97 50L58 92V68H3Z' },
}

/** The figure of a shape drawn `w` × `h`. */
export function figureOf(shape: Shape, w: number, h: number): Figure {
  if (shape === 'rectangle') return { outline: roundRect(w, h, Math.min(8, w / 4, h / 4), 1), unit: false }
  if (shape === 'pill') return { outline: roundRect(w, h, Math.min(w, h) / 2 - 1, 1), unit: false }
  return { ...UNIT[shape], unit: true }
}
