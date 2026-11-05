import type { Edge, Node } from '@xyflow/react'
import { isKnownNodeType, type CanvasDoc, type CanvasEdge, type CanvasNode, type CanvasSide } from '@shared/canvas'
import { isPointNode } from './arrow-geometry'

/**
 * A canvas as the drawing library takes it, and back.
 *
 * The file is the truth: these are made from it on every change and carry the
 * canvas node itself in `data`, so a node drawn is the node as read - keys
 * Recto does not know included. Groups are drawn under everything else, as in
 * Obsidian; among the rest, the file's order is the order on screen.
 */

/** `folded`: a group shut to its label, or a note to its name and first lines. `holds`: how many nodes a shut group hides. */
export type FlowNodeData = { node: CanvasNode; folded?: boolean; holds?: number }
export type FlowNode = Node<FlowNodeData>
export type FlowEdgeData = { edge: CanvasEdge }
export type FlowEdge = Edge<FlowEdgeData>

/** How each kind of node is drawn: the four the spec has, an arrow's free end, and one for the rest. */
export const flowType = (node: CanvasNode): string =>
  isPointNode(node) ? 'point' : isKnownNodeType(node.type) ? node.type : 'unknown'

/** Groups sit this far under every other node. */
const GROUP_DEPTH = 100_000

/** A shut group's height, and a folded note's at most: a bar with its name. */
export const FOLDED_GROUP = 44
export const FOLDED_NOTE = 110

/** What a shut group hides: the nodes inside it. Folding is only drawn; the file keeps every size. */
export function hiddenBy(doc: CanvasDoc, collapsed: ReadonlySet<string>): Set<string> {
  const hidden = new Set<string>()
  for (const n of doc.nodes) if (n.type === 'group' && collapsed.has(n.id)) for (const c of childrenOf(doc, n)) hidden.add(c.id)
  return hidden
}

export function toFlowNodes(doc: CanvasDoc, selected: ReadonlySet<string>, collapsed: ReadonlySet<string> = new Set()): FlowNode[] {
  const hidden = hiddenBy(doc, collapsed)
  return doc.nodes.map((node, index) => {
    const folded = collapsed.has(node.id)
    const height = !folded ? node.height : node.type === 'group' ? FOLDED_GROUP : Math.min(node.height, FOLDED_NOTE)
    return {
      id: node.id,
      type: flowType(node),
      position: { x: node.x, y: node.y },
      width: node.width,
      height,
      zIndex: node.type === 'group' ? index - GROUP_DEPTH : index,
      selected: selected.has(node.id),
      hidden: hidden.has(node.id),
      // An arrow's free end is moved by its arrow, not picked up on its own.
      ...(isPointNode(node) ? { selectable: false, draggable: false, connectable: false } : {}),
      data: folded ? { node, folded, ...(node.type === 'group' ? { holds: childrenOf(doc, node).length } : {}) } : { node },
    }
  })
}

const centre = (n: CanvasNode): { x: number; y: number } => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 })

/**
 * The sides an edge leaves and arrives on when the file does not say: the
 * ones that face each other, along whichever axis the two nodes are further
 * apart on.
 */
export function autoSides(from: CanvasNode, to: CanvasNode): { from: CanvasSide; to: CanvasSide } {
  const a = centre(from)
  const b = centre(to)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' }
  return dy >= 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' }
}

export function toFlowEdges(doc: CanvasDoc, selected: ReadonlySet<string>, collapsed: ReadonlySet<string> = new Set()): FlowEdge[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const hidden = hiddenBy(doc, collapsed)
  const out: FlowEdge[] = []
  for (const edge of doc.edges) {
    const from = byId.get(edge.fromNode)
    const to = byId.get(edge.toNode)
    // An edge to a node that is not there (a hand-edited file) is kept in the file, not drawn.
    if (from === undefined || to === undefined) continue
    const sides = autoSides(from, to)
    out.push({
      id: edge.id,
      type: 'canvas',
      source: edge.fromNode,
      target: edge.toNode,
      sourceHandle: edge.fromSide ?? sides.from,
      targetHandle: edge.toSide ?? sides.to,
      selected: selected.has(edge.id),
      hidden: hidden.has(edge.fromNode) || hidden.has(edge.toNode),
      data: { edge },
    })
  }
  return out
}

/** The nodes a group holds: the ones wholly inside its frame, as Obsidian decides it - by where they are, not by a list. */
export function childrenOf(doc: CanvasDoc, group: CanvasNode): CanvasNode[] {
  return doc.nodes.filter(
    (n) =>
      n.id !== group.id &&
      n.x >= group.x &&
      n.y >= group.y &&
      n.x + n.width <= group.x + group.width &&
      n.y + n.height <= group.y + group.height,
  )
}
