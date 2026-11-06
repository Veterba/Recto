import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_ACCESS_STATE } from '../../src/shared/ai-access'
import { overlaps } from '../../src/shared/canvas-layout'
import type { CanvasOp, GhostNode } from '../../src/shared/canvas-ops'

/**
 * The canvas tools: the AI reads a canvas by short ids and proposes cards,
 * arrows, groups and moves - Recto placing them, never over what is there -
 * or a whole new canvas.
 */

let root = ''
const state: Record<string, unknown> = {}
vi.mock('electron', () => ({ app: { on: () => undefined, getPath: () => os.tmpdir() }, shell: {} }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))
vi.mock('../../src/main/state', () => ({ readState: (feature: string) => state[feature] ?? null, writeState: () => ({ ok: true }) }))

const { buildScope } = await import('../../src/main/vault-tools/scope')
const tools = await import('../../src/main/vault-tools/canvas-tools')

const put = (relative: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}
const CANVAS = 'Recto/Canvas/Plan.canvas'
const n = (id: string, x: number, y: number, rest: Record<string, unknown>) => ({ id, x, y, width: 200, height: 100, ...rest })

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-canvas-tools-'))
  state[AI_ACCESS_STATE] = { excluded: ['Private'] }
  put('Garden/Basil.md', '# Basil\n')
  put('Private/Diary.md', '# Diary\n')
  put(
    CANVAS,
    JSON.stringify({
      nodes: [
        n('aaaaaaaaaaaaaaaa', 0, 0, { type: 'text', text: 'Soil' }),
        n('bbbbbbbbbbbbbbbb', 240, 0, { type: 'text', text: 'Water' }),
        n('cccccccccccccccc', 120, 140, { type: 'text', text: 'Sun' }),
        n('dddddddddddddddd', 600, 0, { type: 'file', file: 'Private/Diary.md' }),
      ],
      edges: [{ id: 'eeeeeeeeeeeeeeee', fromNode: 'aaaaaaaaaaaaaaaa', toNode: 'bbbbbbbbbbbbbbbb' }],
    }),
  )
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('canvas tools', () => {
  it('read: nodes by short ids, arrows by them; a note AI may not see only as a place', async () => {
    const [block] = await tools.canvasRead(buildScope('t'), { canvas: 'Plan' })
    const read = (block as { data: { nodes: Record<string, unknown>[]; edges: unknown[] } }).data
    expect(read.nodes.map((x) => x['id'])).toEqual(['n1', 'n2', 'n3', 'n4'])
    expect(read.nodes[3]).toEqual({ id: 'n4', type: 'file', file: '(a file AI may not see)' })
    expect(read.edges).toEqual([{ from: 'n1', to: 'n2' }])
    expect(tools.canvasList(buildScope('t'))).toEqual([{ kind: 'data', data: { canvases: [{ path: CANVAS, name: 'Plan' }] } }])
  })

  it('cards near a node: placed clear of everything, arrows to them by "new:N"', async () => {
    const draft = await tools.proposeCanvasNodes(buildScope('t'), {
      canvas: CANVAS,
      nodes: [{ text: 'Compost', near: 'n1' }, { note: 'Basil', near: 'n1' }, { text: 'Mulch' }],
      edges: [{ from: 'n1', to: 'new:1', label: 'feeds' }, { from: 'new:2', to: 'n2' }],
    })
    const ops = draft.canvas!.ops
    const added = ops.filter((o): o is Extract<CanvasOp, { op: 'add-node' }> => o.op === 'add-node').map((o) => o.node)
    expect(added.map((g: GhostNode) => g.text ?? g.file)).toEqual(['Compost', 'Garden/Basil.md', 'Mulch'])
    const existing = [n('a', 0, 0, {}), n('b', 240, 0, {}), n('c', 120, 140, {}), n('d', 600, 0, {})]
    for (const g of added) expect(existing.some((e) => overlaps(e, g))).toBe(false)
    expect(ops.filter((o) => o.op === 'add-edge')).toEqual([
      { op: 'add-edge', from: 'aaaaaaaaaaaaaaaa', to: 'g1', label: 'feeds' },
      { op: 'add-edge', from: 'g2', to: 'bbbbbbbbbbbbbbbb' },
    ])
    // The list shows the canvas with every edit: still a canvas Obsidian reads.
    expect(JSON.parse(draft.files[0]!.after).nodes).toHaveLength(7)
  })

  it('a group whose frame would take in another node gathers its nodes first', async () => {
    const draft = await tools.proposeCanvasGroup(buildScope('t'), { canvas: CANVAS, groups: [{ label: 'Elements', nodes: ['n1', 'n3'] }] })
    const ops = draft.canvas!.ops
    expect(ops.filter((o) => o.op === 'move')).toHaveLength(2)
    expect(ops.at(-1)).toMatchObject({ op: 'add-group', label: 'Elements', members: ['aaaaaaaaaaaaaaaa', 'cccccccccccccccc'] })
  })

  it('a new canvas is a new file in Recto/Canvas; an excluded note cannot be put on it', async () => {
    const draft = await tools.proposeCanvasNew(buildScope('t'), { name: 'Ideas', nodes: [{ text: 'One' }, { note: 'Basil' }], edges: [{ from: 'new:1', to: 'new:2' }] })
    expect(draft.files[0]).toMatchObject({ path: 'Recto/Canvas/Ideas.canvas', before: null })
    expect(JSON.parse(draft.files[0]!.after).edges).toHaveLength(1)
    await expect(tools.proposeCanvasNew(buildScope('t'), { name: 'Bad', nodes: [{ note: 'Private/Diary' }] })).rejects.toThrow('No file')
    await expect(tools.proposeCanvasNodes(buildScope('t'), { canvas: CANVAS, nodes: [{ text: 'x', near: 'n9' }] })).rejects.toThrow('No node “n9”')
  })
})
