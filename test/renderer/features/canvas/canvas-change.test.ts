import { describe, expect, it } from 'vitest'
import { parseCanvas, patchNode, type CanvasDoc } from '../../../../src/shared/canvas'
import { inverse } from '../../../../src/renderer/features/canvas/canvas-change'
import { autoSides, childrenOf, toFlowEdges } from '../../../../src/renderer/features/canvas/canvas-flow'

/**
 * Undo on a canvas is a change too: it puts back only what one step touched,
 * so an edit made since (in Obsidian, say) to anything else stays.
 */

const doc: CanvasDoc = parseCanvas(
  JSON.stringify({
    nodes: [
      { id: 'g', type: 'group', x: 0, y: 0, width: 400, height: 300, label: 'G' },
      { id: 'a', type: 'text', text: 'A', x: 20, y: 20, width: 100, height: 60 },
      { id: 'b', type: 'text', text: 'B', x: 500, y: 20, width: 100, height: 60 },
    ],
    edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }],
  }),
)

describe('canvas undo', () => {
  it('undoes a move, an add and a delete, keeping what changed elsewhere since', () => {
    const moved = { ...doc, nodes: doc.nodes.map((n) => (n.id === 'a' ? patchNode(n, { x: 40 }) : n)) }
    const undo = inverse(doc, moved)!
    // Meanwhile b was edited somewhere else: undoing the move leaves b alone.
    const elsewhere = { ...moved, nodes: moved.nodes.map((n) => (n.id === 'b' ? patchNode(n, { text: 'B2' }) : n)) }
    const back = undo(elsewhere)
    expect(back.nodes.find((n) => n.id === 'a')?.x).toBe(20)
    expect(back.nodes.find((n) => n.id === 'b')?.text).toBe('B2')

    const added = { ...doc, nodes: [...doc.nodes, { id: 'c', type: 'text', text: 'C', x: 0, y: 400, width: 100, height: 60 }] }
    expect(inverse(doc, added)!(added).nodes.map((n) => n.id)).toEqual(['g', 'a', 'b'])

    const removed = { ...doc, nodes: doc.nodes.filter((n) => n.id !== 'a'), edges: [] }
    const restored = inverse(doc, removed)!(removed)
    expect(restored.nodes.map((n) => n.id)).toEqual(['g', 'a', 'b'])
    expect(restored.edges.map((e) => e.id)).toEqual(['e'])
    expect(inverse(doc, doc)).toBeNull()
  })
})

describe('canvas drawing', () => {
  it('finds a group’s nodes by where they are, and the sides edges use when the file does not say', () => {
    expect(childrenOf(doc, doc.nodes[0]!).map((n) => n.id)).toEqual(['a'])
    expect(autoSides(doc.nodes[1]!, doc.nodes[2]!)).toEqual({ from: 'right', to: 'left' })
    expect(toFlowEdges(doc, new Set())[0]).toMatchObject({ sourceHandle: 'right', targetHandle: 'left' })
    // An edge to a node that is not there is kept in the file, not drawn.
    expect(toFlowEdges({ ...doc, edges: [{ id: 'x', fromNode: 'a', toNode: 'gone' }] }, new Set())).toEqual([])
  })
})
