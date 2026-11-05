import { describe, expect, it } from 'vitest'
import { parseCanvas, type CanvasDoc } from '../../../../src/shared/canvas'
import { align, copyOf, distribute, groupOf, pasteOf, recolor, reorder, searchText } from '../../../../src/renderer/features/canvas/canvas-edit'

const doc: CanvasDoc = parseCanvas(
  JSON.stringify({
    nodes: [
      { id: 'g', type: 'group', x: 0, y: 0, width: 400, height: 300, label: 'Garden' },
      { id: 'a', type: 'text', text: 'Compost', x: 20, y: 20, width: 100, height: 60 },
      { id: 'b', type: 'text', text: 'Loam', x: 500, y: 40, width: 100, height: 60 },
      { id: 'c', type: 'file', file: 'Garden/Soil.md', x: 900, y: 10, width: 200, height: 60 },
    ],
    edges: [
      { id: 'e1', fromNode: 'a', toNode: 'b', label: 'with' },
      { id: 'e2', fromNode: 'b', toNode: 'c' },
    ],
  }),
)

describe('editing a canvas selection', () => {
  it('copies nodes with the edges between them, a group with what is in it, and pastes with new ids', () => {
    const clip = copyOf(doc, new Set(['a', 'b']))!
    expect(clip.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(clip.edges.map((e) => e.id)).toEqual(['e1'])
    expect(copyOf(doc, new Set(['g']))!.nodes.map((n) => n.id)).toEqual(['g', 'a'])

    const { change, ids } = pasteOf(clip, { x: 1000, y: 500 })
    const after = change(doc)
    const made = ids()
    expect(made).toHaveLength(2)
    expect(made.some((id) => ['a', 'b'].includes(id))).toBe(false)
    const pasted = after.nodes.filter((n) => made.includes(n.id))
    expect(pasted.map((n) => [n.x, n.y])).toEqual([
      [1000, 500],
      [1480, 520],
    ])
    const edge = after.edges.at(-1)!
    expect([edge.fromNode, edge.toNode]).toEqual(made)
    expect(edge.label).toBe('with')
  })

  it('reorders, aligns, distributes, recolours and groups', () => {
    expect(reorder(new Set(['a']), 'front')(doc).nodes.map((n) => n.id)).toEqual(['g', 'b', 'c', 'a'])
    expect(reorder(new Set(['c']), 'back')(doc).nodes.map((n) => n.id)).toEqual(['c', 'g', 'a', 'b'])
    expect(align(new Set(['a', 'b', 'c']), 'top')(doc).nodes.filter((n) => n.id !== 'g').map((n) => n.y)).toEqual([10, 10, 10])
    // a ends at 120, c starts at 900: b goes halfway between, by its edges.
    expect(distribute(new Set(['a', 'b', 'c']), 'x')(doc).nodes.find((n) => n.id === 'b')?.x).toBe(460)
    const red = recolor(new Set(['a', 'e1']), '1')(doc)
    expect(red.nodes.find((n) => n.id === 'a')?.color).toBe('1')
    expect(red.edges.find((e) => e.id === 'e1')?.color).toBe('1')
    expect(Object.keys(recolor(new Set(['a']), null)(red).nodes.find((n) => n.id === 'a')!)).not.toContain('color')
    const { change, made } = groupOf(new Set(['b', 'c']), 'Beds')
    const grouped = change(doc)
    expect(grouped.nodes[0]).toMatchObject({ id: made(), type: 'group', label: 'Beds', x: 470, y: -20, width: 660, height: 150 })
  })

  it('searches what a node shows', () => {
    expect(searchText(doc.nodes[3]!)).toBe('Garden/Soil')
    expect(searchText(doc.nodes[0]!)).toBe('Garden')
  })
})
