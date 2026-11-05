import { describe, expect, it } from 'vitest'
import { parseCanvas, serializeCanvas, type CanvasDoc } from '../../../../src/shared/canvas'
import { common, restyle, setHead } from '../../../../src/renderer/features/canvas/canvas-style'

const doc: CanvasDoc = parseCanvas(
  JSON.stringify({
    nodes: [
      { id: 'a', type: 'text', text: 'A', x: 0, y: 0, width: 100, height: 60, styleAttributes: { shape: 'pill' } },
      { id: 'b', type: 'text', text: 'B', x: 200, y: 0, width: 100, height: 60 },
    ],
    edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }],
  }),
)

describe('canvas style', () => {
  it('sets a style key next to the ones there, and taking it back off leaves the node as it was', () => {
    const styled = restyle(new Set(['a', 'b']), 'fill', 'solid')(doc)
    expect(styled.nodes[0]!['styleAttributes']).toEqual({ shape: 'pill', fill: 'solid' })
    expect(styled.nodes[1]!['styleAttributes']).toEqual({ fill: 'solid' })
    expect(common(styled.nodes, 'fill')).toBe('solid')
    const back = restyle(new Set(['a', 'b']), 'fill', undefined)(styled)
    expect(serializeCanvas(back)).toBe(serializeCanvas(doc))
  })

  it('says null when the selection differs', () => {
    expect(common(restyle(new Set(['a']), 'border', 'dashed')(doc).nodes, 'border')).toBeNull()
  })

  it('arrowheads: the spec’s defaults stay out of the file', () => {
    const both = setHead(new Set(['e']), 'from', true)(doc)
    expect(both.edges[0]).toMatchObject({ fromEnd: 'arrow' })
    expect(both.edges[0]!.toEnd).toBeUndefined()
    const none = setHead(new Set(['e']), 'to', false)(setHead(new Set(['e']), 'from', false)(both))
    expect(none.edges[0]).toMatchObject({ toEnd: 'none' })
    expect('fromEnd' in none.edges[0]!).toBe(false)
  })
})
