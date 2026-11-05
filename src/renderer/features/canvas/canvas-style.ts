import { patchEdge, styleOf, withStyle, type CanvasDoc, type CanvasEdge, type CanvasNode } from '@shared/canvas'
import type { CanvasChange } from './canvas-change'

/**
 * The looks the style bar sets, beyond JSON Canvas's colour. Each is a style
 * key kept as the Advanced Canvas plugin keeps it where that plugin has one
 * (`border`, `textAlign`, `path`), so Obsidian with it draws the same; the
 * others (`fill`, `fontSize`, `width`, `labelAt`) are Recto's. A key left out is the
 * default, so a canvas never styled has none.
 */

export type StyleKey = 'fill' | 'border' | 'textAlign' | 'fontSize' | 'path' | 'width' | 'labelAt'

export type Option = { value: string | undefined; label: string }

export const NODE_OPTIONS: Readonly<Record<'fill' | 'border' | 'textAlign' | 'fontSize', readonly Option[]>> = {
  fill: [
    { value: 'none', label: 'No fill' },
    { value: undefined, label: 'Tint' },
    { value: 'solid', label: 'Solid' },
  ],
  border: [
    { value: undefined, label: 'Solid' },
    { value: 'dashed', label: 'Dashed' },
    { value: 'dotted', label: 'Dotted' },
    { value: 'invisible', label: 'None' },
  ],
  textAlign: [
    { value: undefined, label: 'Left' },
    { value: 'center', label: 'Centre' },
    { value: 'right', label: 'Right' },
  ],
  fontSize: [
    { value: 's', label: 'S' },
    { value: undefined, label: 'M' },
    { value: 'l', label: 'L' },
    { value: 'xl', label: 'XL' },
  ],
}

/** Where a shape's text is: under it, or over it. The square keeps its text inside. */
export const LABEL_OPTIONS: readonly Option[] = [
  { value: undefined, label: 'Text below' },
  { value: 'top', label: 'Text above' },
]

export const EDGE_OPTIONS: Readonly<Record<'path' | 'width', readonly Option[]>> = {
  path: [
    { value: undefined, label: 'Solid' },
    { value: 'long-dashed', label: 'Dashed' },
    { value: 'short-dashed', label: 'Short dashes' },
    { value: 'dotted', label: 'Dotted' },
  ],
  width: [
    { value: 'thin', label: 'Thin' },
    { value: undefined, label: 'Normal' },
    { value: 'thick', label: 'Thick' },
  ],
}

/** The value a key has on all of these, or null when they differ. */
export function common(items: readonly (CanvasNode | CanvasEdge)[], key: StyleKey): string | undefined | null {
  const values = new Set(items.map((i) => styleOf(i)[key]))
  return values.size === 1 ? [...values][0] : null
}

/** A style key set (or put back to the default, `undefined`) on the nodes and edges in `ids`. */
export const restyle =
  (ids: ReadonlySet<string>, key: StyleKey, value: string | undefined): CanvasChange =>
  (doc: CanvasDoc) => ({
    ...doc,
    nodes: doc.nodes.map((n) => (ids.has(n.id) ? withStyle(n, { [key]: value }) : n)),
    edges: doc.edges.map((e) => (ids.has(e.id) ? withStyle(e, { [key]: value }) : e)),
  })

/** An arrowhead put on or taken off one end of the edges in `ids`; the spec's defaults are left out of the file. */
export const setHead =
  (ids: ReadonlySet<string>, end: 'from' | 'to', on: boolean): CanvasChange =>
  (doc) => ({
    ...doc,
    edges: doc.edges.map((e) => {
      if (!ids.has(e.id)) return e
      // The spec: no head at the start, a head at the end - written only when it is not that.
      const value = end === 'from' ? (on ? 'arrow' : undefined) : on ? undefined : 'none'
      return patchEdge(e, end === 'from' ? { fromEnd: value } : { toEnd: value })
    }),
  })

/** The data attributes a node is drawn with, for the CSS: one per style key it has. */
export function styleData(node: CanvasNode | CanvasEdge): Record<string, string> {
  const style = styleOf(node)
  const out: Record<string, string> = {}
  for (const key of ['fill', 'border', 'textAlign', 'fontSize', 'labelAt'] as const) if (style[key] !== undefined) out[`data-${key.toLowerCase()}`] = style[key]
  return out
}
