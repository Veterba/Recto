import { newCanvasId, patchEdge, withStyle, type CanvasDoc, type CanvasEdge, type CanvasNode } from '@shared/canvas'
import { anchorsOf, anchorText, CENTRE, facingSides, isPointNode, POINT_SIZE, type Anchor, type Point, type Rect } from './arrow-geometry'

/**
 * Arrows made, re-pinned and bent, as changes to the canvas. An end is pinned
 * to a node, or left free: then it ends at a point node made for it, which
 * goes when no arrow ends there any more.
 */

export type EndTarget = { node: string; anchor: Anchor } | { point: Point }

export const rectOf = (n: CanvasNode): Rect => ({ x: n.x, y: n.y, width: n.width, height: n.height })

/** The node under a point: the top one, a group only when nothing else is there. Free ends are not hit. */
export function nodeAt(doc: CanvasDoc, p: Point, exclude: ReadonlySet<string> = new Set()): CanvasNode | null {
  let group: CanvasNode | null = null
  for (let i = doc.nodes.length - 1; i >= 0; i--) {
    const n = doc.nodes[i]!
    if (exclude.has(n.id) || isPointNode(n)) continue
    if (p.x < n.x || p.x > n.x + n.width || p.y < n.y || p.y > n.y + n.height) continue
    if (n.type !== 'group') return n
    group ??= n
  }
  return group
}

/** The node an end is at: the one it is pinned to, or a new point node for a free end. */
function nodeFor(doc: CanvasDoc, end: EndTarget): { doc: CanvasDoc; id: string; anchor: Anchor } {
  if ('node' in end) return { doc, id: end.node, anchor: end.anchor }
  const id = newCanvasId(doc)
  const point: CanvasNode = {
    id,
    type: 'text',
    text: '',
    x: Math.round(end.point.x - POINT_SIZE / 2),
    y: Math.round(end.point.y - POINT_SIZE / 2),
    width: POINT_SIZE,
    height: POINT_SIZE,
    styleAttributes: { shape: 'point' },
  }
  return { doc: { ...doc, nodes: [...doc.nodes, point] }, id, anchor: CENTRE }
}

/** The sides Obsidian draws the edge between: the ones that face each other. */
function sidesFor(doc: CanvasDoc, from: string, to: string): Pick<CanvasEdge, 'fromSide' | 'toSide'> {
  const a = doc.nodes.find((n) => n.id === from)
  const b = doc.nodes.find((n) => n.id === to)
  if (a === undefined || b === undefined) return {}
  const sides = facingSides(rectOf(a), rectOf(b))
  return { fromSide: sides.from, toSide: sides.to }
}

/** A new arrow from one end to the other; the id it has. */
export function connect(doc: CanvasDoc, from: EndTarget, to: EndTarget): { doc: CanvasDoc; id: string } {
  const a = nodeFor(doc, from)
  const b = nodeFor(a.doc, to)
  const id = newCanvasId(b.doc)
  const edge = withStyle(
    { id, fromNode: a.id, ...sidesFor(b.doc, a.id, b.id), toNode: b.id } as CanvasEdge,
    { fromAnchor: anchorText(a.anchor), toAnchor: anchorText(b.anchor) },
  )
  return { doc: { ...b.doc, edges: [...b.doc.edges, edge] }, id }
}

/** Point nodes no arrow ends at any more, gone. */
export function dropLoosePoints(doc: CanvasDoc): CanvasDoc {
  const used = new Set(doc.edges.flatMap((e) => [e.fromNode, e.toNode]))
  const nodes = doc.nodes.filter((n) => !isPointNode(n) || used.has(n.id))
  return nodes.length === doc.nodes.length ? doc : { ...doc, nodes }
}

/** An arrow's end moved: to a pin on a node, or out into the open. The arrow is pinned the tldraw way from now on. */
export function setEnd(doc: CanvasDoc, edgeId: string, which: 'from' | 'to', end: EndTarget): CanvasDoc {
  const edge = doc.edges.find((e) => e.id === edgeId)
  if (edge === undefined) return doc
  const other = which === 'from' ? edge.toNode : edge.fromNode
  if ('node' in end && end.node === other) return doc
  // A free end dragged into the open again: its point moves, no new one.
  const current = doc.nodes.find((n) => n.id === (which === 'from' ? edge.fromNode : edge.toNode))
  let next = doc
  let id: string
  let anchor: Anchor
  if ('point' in end && current !== undefined && isPointNode(current)) {
    id = current.id
    anchor = CENTRE
    next = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.id === id ? { ...n, x: Math.round(end.point.x - POINT_SIZE / 2), y: Math.round(end.point.y - POINT_SIZE / 2) } : n,
      ),
    }
  } else {
    const made = nodeFor(doc, end)
    next = made.doc
    id = made.id
    anchor = made.anchor
  }
  const pins = anchorsOf(edge)
  const fromNode = which === 'from' ? id : edge.fromNode
  const toNode = which === 'to' ? id : edge.toNode
  const patched = withStyle(patchEdge(edge, { fromNode, toNode, ...sidesFor(next, fromNode, toNode) }), {
    fromAnchor: anchorText(which === 'from' ? anchor : (pins.from ?? CENTRE)),
    toAnchor: anchorText(which === 'to' ? anchor : (pins.to ?? CENTRE)),
  })
  return dropLoosePoints({ ...next, edges: next.edges.map((e) => (e.id === edgeId ? patched : e)) })
}

/** An arrow bent (or straightened, with 0) by dragging its middle. */
export function setBend(doc: CanvasDoc, edgeId: string, bend: number): CanvasDoc {
  return {
    ...doc,
    edges: doc.edges.map((e) => {
      if (e.id !== edgeId) return e
      const pins = anchorsOf(e)
      return withStyle(e, {
        fromAnchor: anchorText(pins.from ?? CENTRE),
        toAnchor: anchorText(pins.to ?? CENTRE),
        bend: bend === 0 ? undefined : String(bend),
      })
    }),
  }
}
