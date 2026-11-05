import { describe, expect, it } from 'vitest'
import type { GraphInfo } from '../../../../src/shared/index-results'
import { ALL_LINKS } from '../../../../src/renderer/features/graph/degree-bins'
import { visibleGraph } from '../../../../src/renderer/features/graph/view-model'

/** Which notes the graph draws: chats only when asked for, Recto's README never. */

const node = (path: string): GraphInfo['nodes'][number] => ({ path, name: path, title: null, degree: 0, topic: false })
const graph: GraphInfo = {
  nodes: ['A.md', 'Recto/README.md', 'Recto/Recto README.md', 'Recto/Chats/recto/t.md'].map(node),
  edges: [],
}
const filters = { showOrphans: true, showBoards: true, showTasks: true, showChats: false, showCanvases: true, linkRange: ALL_LINKS, localOnly: false, activePath: null }

describe('visibleGraph', () => {
  it('leaves out Recto’s README, and chats unless they are switched on', () => {
    expect(visibleGraph(graph, filters).paths).toEqual(['A.md'])
    expect(visibleGraph(graph, { ...filters, showChats: true }).paths).toEqual(['A.md', 'Recto/Chats/recto/t.md'])
  })

  it('shows canvases as diamonds unless switched off, their lines to notes thin and dashed', () => {
    const withCanvas: GraphInfo = {
      nodes: [node('A.md'), { ...node('Plan.canvas'), degree: 1, canvas: true }],
      edges: [{ source: 'Plan.canvas', target: 'A.md', auto: false, member: true }],
    }
    const shown = visibleGraph(withCanvas, filters)
    expect(shown.nodes.find((n) => n.path === 'Plan.canvas')?.canvas).toBe(true)
    expect(shown.auto).toEqual([0])
    expect(visibleGraph(withCanvas, { ...filters, showCanvases: false }).paths).toEqual(['A.md'])
  })
})
