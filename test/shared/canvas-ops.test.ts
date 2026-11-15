import { describe, expect, it } from 'vitest'
import type { CanvasDoc } from '../../src/shared/canvas'
import { acceptOps, rejectOps, type CanvasProposal } from '../../src/shared/canvas-ops'
import { statusOf } from '../../src/shared/text-changes'

/** An AI's canvas changes as edits: each accepted or rejected on its own, on the canvas as it is then. */

const doc = (): CanvasDoc => ({
  nodes: [{ id: 'a', type: 'text', text: 'Soil', x: 0, y: 0, width: 200, height: 100 }],
  edges: [],
  rest: {},
  order: ['nodes', 'edges'],
})

const proposal = (): CanvasProposal => ({
  path: 'Recto/Canvas/Plan.canvas',
  ops: [
    { op: 'add-node', node: { ref: 'g1', type: 'text', text: 'Compost', x: 300.4, y: 0, width: 200, height: 100 } },
    { op: 'add-edge', from: 'a', to: 'g1', label: 'feeds' },
    { op: 'add-group', ref: 'g2', label: 'Garden', members: ['a', 'g1'], x: -30, y: -30, width: 560, height: 160 },
    { op: 'move', id: 'a', x: 0, y: 40 },
  ],
  states: ['pending', 'pending', 'pending', 'pending'],
  refs: {},
})

describe('canvas edits', () => {
  it('an arrow accepted brings the new node it needs; ids are real, positions whole', () => {
    const done = acceptOps(doc(), proposal(), [1])
    expect(done.states).toEqual(['accepted', 'accepted', 'pending', 'pending'])
    const added = done.doc.nodes.find((n) => n.text === 'Compost')!
    expect(added.id).toMatch(/^[0-9a-f]{16}$/)
    expect(added.x).toBe(300)
    expect(done.doc.edges).toEqual([expect.objectContaining({ fromNode: 'a', toNode: added.id, label: 'feeds' })])
    expect(done.refs['g1']).toBe(added.id)
  })

  it('an AI’s arrow is drawn as the Arrow tool draws one: pinned at both centres, straight, its sides kept for Obsidian', () => {
    const done = acceptOps(doc(), proposal(), [1])
    expect(done.doc.edges[0]).toMatchObject({ fromSide: 'right', toSide: 'left', styleAttributes: { fromAnchor: '0.5,0.5', toAnchor: '0.5,0.5' } })
  })

  it('a group goes first in the file, under what it holds', () => {
    const done = acceptOps(doc(), proposal(), [2])
    expect(done.doc.nodes[0]).toMatchObject({ type: 'group', label: 'Garden' })
  })

  it('an edit whose node is gone since is stale; the others still apply', () => {
    const gone = { ...doc(), nodes: [] }
    const done = acceptOps(gone, proposal(), [0, 3])
    expect(done.states).toEqual(['accepted', 'pending', 'pending', 'stale'])
  })

  it('a node rejected takes the arrows and groups that needed it; all decided, the proposal is settled', () => {
    const p = proposal()
    const states = rejectOps(p, [0])
    expect(states).toEqual(['rejected', 'rejected', 'rejected', 'pending'])
    expect(statusOf(states)).toBe('pending')
    expect(statusOf(['rejected', 'rejected', 'rejected', 'accepted'])).toBe('applied')
    expect(statusOf(['rejected', 'stale'])).toBe('discarded')
    // None of them could go in: out of date, not "discarded".
    expect(statusOf(['stale', 'stale'])).toBe('stale')
  })
})
