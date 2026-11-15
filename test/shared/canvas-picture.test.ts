import { describe, expect, it } from 'vitest'
import type { CanvasDoc } from '../../src/shared/canvas'
import { canvasSvg } from '../../src/shared/canvas-picture'

/** A canvas drawn for a model to look at. Invented cards. */

const doc: CanvasDoc = {
  nodes: [
    { id: 'g', type: 'group', label: 'Garden', x: -40, y: -60, width: 700, height: 300 },
    { id: 'a', type: 'text', text: '# Soil\n\nCompost, loam & grit.', x: 0, y: 0, width: 260, height: 120 },
    { id: 'b', type: 'file', file: 'Private/Diary.md', x: 360, y: 0, width: 260, height: 120 },
    { id: 'c', type: 'text', text: 'Mulch', x: 0, y: 400, width: 200, height: 80 },
  ],
  edges: [{ id: 'e', fromNode: 'a', toNode: 'c', label: 'feeds <roots>' }],
  rest: {},
  order: ['nodes', 'edges'],
}
const ids = new Map([
  ['g', 'n1'],
  ['a', 'n2'],
  ['b', 'n3'],
  ['c', 'n4'],
])

describe('a canvas as a picture', () => {
  const { svg, width, height } = canvasSvg(
    doc,
    ids,
    (n) =>
      n.id === 'b'
        ? { title: '', lines: [], hidden: true }
        : {
            title: n.text?.split('\n')[0]!.replace(/^#+\s*/, '') ?? '',
            lines: (n.text ?? '')
              .split('\n')
              .slice(1)
              .filter((l) => l !== ''),
          },
    new Set(['c']),
  )

  it('each node with its short id and the start of its text; groups and arrows with their labels; text escaped', () => {
    for (const id of ['n1 Garden', '>n2<', '>n3<', '>n4<', '>Soil<', 'Compost, loam &amp; grit.', '>Mulch<', 'feeds &lt;roots&gt;'])
      expect(svg).toContain(id)
    expect(svg.match(/<line /g)).toHaveLength(1)
  })

  it('a note AI may not see is an empty box: no name, no text', () => {
    expect(svg).not.toContain('Diary')
    expect(svg).toContain('fill="#eeeeef"')
  })

  it('what a suggestion would add is dashed green; the picture is sized to the canvas, no bigger than 1600', () => {
    expect(svg).toMatch(/stroke="#30a46c"[^>]*stroke-dasharray/)
    expect(Math.max(width, height)).toBeLessThanOrEqual(1600)
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
  })
})
