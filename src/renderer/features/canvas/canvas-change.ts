import type { CanvasDoc, CanvasEdge, CanvasNode } from '@shared/canvas'

/**
 * A change to a canvas, as a function of the canvas it is made to - so the
 * same change can be made again to what is on disk when the file changed
 * underneath (Obsidian, sync), the way board writes are.
 */
export type CanvasChange = (doc: CanvasDoc) => CanvasDoc

/** What changed between two canvases, item by item: what undo puts back. */
type Diff<T> = { before: Map<string, { item: T; index: number }>; after: Map<string, T> }

function diff<T extends { id: string }>(before: readonly T[], after: readonly T[]): Diff<T> {
  const old = new Map(before.map((item, index) => [item.id, { item, index }]))
  const now = new Map(after.map((item) => [item.id, item]))
  const out: Diff<T> = { before: new Map(), after: new Map() }
  for (const [id, { item, index }] of old) if (now.get(id) !== item) out.before.set(id, { item, index })
  for (const [id, item] of now) if (old.get(id)?.item !== item) out.after.set(id, item)
  return out
}

/** Items with these ones put back as they were: removed ones where they stood, added ones taken out. */
function restore<T extends { id: string }>(items: readonly T[], d: Diff<T>): T[] {
  const out = items.filter((item) => !(d.after.has(item.id) && !d.before.has(item.id)))
  const next = out.map((item) => d.before.get(item.id)?.item ?? item)
  const present = new Set(next.map((item) => item.id))
  for (const [id, { item, index }] of [...d.before].sort((a, b) => a[1].index - b[1].index))
    if (!present.has(id)) next.splice(Math.min(index, next.length), 0, item)
  return next
}

/**
 * The change that undoes going from `before` to `after`: only the nodes and
 * edges that change touched go back, so an edit made since to anything else
 * stays. `null` when nothing changed.
 */
export function inverse(before: CanvasDoc, after: CanvasDoc): CanvasChange | null {
  const nodes = diff<CanvasNode>(before.nodes, after.nodes)
  const edges = diff<CanvasEdge>(before.edges, after.edges)
  if (nodes.before.size + nodes.after.size + edges.before.size + edges.after.size === 0) return null
  return (doc) => ({ ...doc, nodes: restore(doc.nodes, nodes), edges: restore(doc.edges, edges) })
}
