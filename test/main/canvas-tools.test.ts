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
vi.mock('electron', () => ({
  app: { on: () => undefined, getPath: () => os.tmpdir() },
  shell: {},
  BrowserWindow: { getAllWindows: () => [] },
  Notification: { isSupported: () => false },
}))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))
vi.mock('../../src/main/state', () => ({
  readState: (feature: string) => state[feature] ?? null,
  writeState: (feature: string, value: unknown) => {
    state[feature] = value
    return { ok: true }
  },
}))

const { buildScope } = await import('../../src/main/vault-tools/scope')
const tools = await import('../../src/main/vault-tools/canvas-tools')
const proposals = await import('../../src/main/vault-tools/proposals')

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
    expect(read.nodes[3]).toEqual({ id: 'n4', type: 'file', x: 600, y: 0, width: 200, height: 100, file: '(a file AI may not see)' })
    expect(read.nodes[0]).toMatchObject({ id: 'n1', x: 0, y: 0, width: 200, height: 100 })
    expect(read.edges).toEqual([{ from: 'n1', to: 'n2' }])
    expect(tools.canvasList(buildScope('t'))).toEqual([{ kind: 'data', data: { canvases: [{ path: CANVAS, name: 'Plan' }] } }])
  })

  it('read: a long text card is cut and says so, and the canvas is not called whole', async () => {
    const short = (await tools.canvasRead(buildScope('t'), { canvas: 'Plan' }))[0] as { data: Record<string, unknown> }
    expect(short.data['whole']).toBe(true)
    const doc = JSON.parse(fs.readFileSync(path.join(root, CANVAS), 'utf8')) as { nodes: { text?: string }[] }
    doc.nodes[0]!.text = 'Soil. '.repeat(400)
    put(CANVAS, JSON.stringify(doc))
    const long = (await tools.canvasRead(buildScope('t'), { canvas: 'Plan' }))[0] as { data: { whole: boolean; note?: string; nodes: Record<string, unknown>[] } }
    expect(long.data.whole).toBe(false)
    expect(long.data.nodes[0]).toMatchObject({ id: 'n1', cut: true, length: 2400 })
    expect(long.data.note).toMatch(/cut here/)
  })

  it('read with a waiting suggestion: the canvas as it would be, its new cards named as proposed', async () => {
    const draft = await tools.proposeCanvasNodes(buildScope('t'), { canvas: CANVAS, nodes: [{ text: 'Compost', near: 'n1' }], edges: [{ from: 'n1', to: 'new:1' }] })
    const made = proposals.queue(draft, 'claude-code', 'canvas_propose_nodes')
    const [block] = await tools.canvasRead(buildScope('t'), { canvas: 'Plan', with_proposal: made.id })
    const read = (block as { data: { nodes: { id: string; text?: string }[]; edges: unknown[]; proposed: string[] } }).data
    expect(read.nodes.map((n) => n.text)).toContain('Compost')
    expect(read.proposed).toEqual([read.nodes.find((n) => n.text === 'Compost')!.id])
    expect(read.edges).toHaveLength(2)
    // The file is as it was: only seen.
    expect(fs.readFileSync(path.join(root, CANVAS), 'utf8')).not.toContain('Compost')
    await expect(tools.canvasRead(buildScope('t'), { canvas: 'Plan', with_proposal: 'nope' })).rejects.toThrow(/No waiting suggestion/)
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

  it('arranged as a mind map from a node: every card moved along the arrows, the root kept, nothing over anything', async () => {
    const hub = n('hhhhhhhhhhhhhhhh', 0, 0, { type: 'text', text: 'Trip' })
    const spokes = ['Visa', 'Money', 'Food', 'Trains', 'Hotels', 'Phrases'].map((t, i) =>
      n(String.fromCharCode(105 + i).repeat(16), 900 + i * 37, -400 + i * 230, { type: 'text', text: t }),
    )
    put(
      CANVAS,
      JSON.stringify({
        nodes: [hub, ...spokes, n('zzzzzzzzzzzzzzzz', 30, 900, { type: 'text', text: 'Loose' })],
        edges: spokes.map((s, i) => ({ id: `edge${i}`.padEnd(16, 'x'), fromNode: hub.id, toNode: s.id, ...(i === 0 ? { label: 'first of all' } : {}) })),
      }),
    )
    const draft = await tools.proposeCanvasArrange(buildScope('t'), { canvas: 'Plan', root: 'n1' })
    const after = JSON.parse(draft.files[0]!.after) as { nodes: { id: string; x: number; y: number; width: number; height: number }[] }
    const at = (id: string) => after.nodes.find((x) => x.id === id)!
    expect(at(hub.id)).toMatchObject({ x: 0, y: 0 })
    expect(after.nodes.every((a, i) => !after.nodes.some((b, j) => j !== i && overlaps(a, b)))).toBe(true)
    // Half the branches each side of the hub; the card on no arrow, in rows below.
    expect(spokes.filter((s) => at(s.id).x > 200)).toHaveLength(3)
    expect(spokes.filter((s) => at(s.id).x < 0)).toHaveLength(3)
    expect(at('zzzzzzzzzzzzzzzz').y).toBeGreaterThan(Math.max(...spokes.map((s) => at(s.id).y)))
    expect(draft.canvas!.ops.every((o) => o.op === 'move')).toBe(true)
    // Its arrows pinned from the hub's side to each card's facing side, so none passes through a card.
    const edges = (JSON.parse(draft.files[0]!.after) as { edges: { toNode: string; fromSide: string; toSide: string; styleAttributes: Record<string, string> }[] }).edges
    for (const e of edges) {
      const right = at(e.toNode).x > 0
      expect(e).toMatchObject({ fromSide: right ? 'right' : 'left', toSide: right ? 'left' : 'right' })
      expect(e.styleAttributes).toEqual(right ? { fromAnchor: '1,0.5', toAnchor: '0,0.5' } : { fromAnchor: '0,0.5', toAnchor: '1,0.5' })
    }
  })

  it('arranged in columns: named cards stacked, a labelled column framed', async () => {
    const draft = await tools.proposeCanvasArrange(buildScope('t'), {
      canvas: 'Plan',
      columns: [{ label: 'Elements', nodes: ['n1', 'n2'] }, { nodes: ['n3'] }],
    })
    const ops = draft.canvas!.ops
    const moved = new Map(ops.flatMap((o) => (o.op === 'move' ? [[o.id, o] as const] : [])))
    const soil = moved.get('aaaaaaaaaaaaaaaa') ?? { x: 0, y: 0 }
    const water = moved.get('bbbbbbbbbbbbbbbb')!
    expect(water.x).toBe(soil.x)
    expect(water.y).toBeGreaterThan(soil.y + 100)
    expect(ops.at(-1)).toMatchObject({ op: 'add-group', label: 'Elements', members: ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'] })
    await expect(tools.proposeCanvasArrange(buildScope('t'), { canvas: 'Plan' })).rejects.toThrow(/either root/)
  })

  it('frames stay whole: arranging moves a frame with all it holds, never a card out of it', async () => {
    // A frame round Soil and Water; Sun outside it.
    const doc = JSON.parse(fs.readFileSync(path.join(root, CANVAS), 'utf8')) as { nodes: Record<string, unknown>[] }
    doc.nodes.unshift(n('ffffffffffffffff', -30, -50, { type: 'group', label: 'Bed', width: 500, height: 180 }))
    put(CANVAS, JSON.stringify(doc))
    // Named by a card in it: the frame goes, and both cards with it, kept where they are in it.
    const draft = await tools.proposeCanvasArrange(buildScope('t'), { canvas: 'Plan', columns: [{ nodes: ['n4'] }, { nodes: ['n2'] }] })
    const after = JSON.parse(draft.files[0]!.after) as { nodes: { id: string; x: number; y: number; width: number; height: number }[] }
    const at = (id: string) => after.nodes.find((x) => x.id === id)!
    const frame = at('ffffffffffffffff')
    for (const id of ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']) {
      const card = at(id)
      expect(card.x >= frame.x && card.y >= frame.y && card.x + card.width <= frame.x + frame.width && card.y + card.height <= frame.y + frame.height).toBe(true)
    }
    expect(at('bbbbbbbbbbbbbbbb').x - at('aaaaaaaaaaaaaaaa').x).toBe(240)
  })

  it('moved into a frame: under what it holds, the frame grown to fit; a frame moved takes what it holds', async () => {
    const doc = JSON.parse(fs.readFileSync(path.join(root, CANVAS), 'utf8')) as { nodes: Record<string, unknown>[] }
    doc.nodes.unshift(n('ffffffffffffffff', -30, -50, { type: 'group', label: 'Bed', width: 500, height: 180 }))
    put(CANVAS, JSON.stringify(doc))
    // n4 is Sun now (the frame is n1); near Water, in the frame, is into it.
    const into = await tools.proposeCanvasLayout(buildScope('t'), { canvas: 'Plan', moves: [{ node: 'n4', near: 'n3' }] })
    const after = JSON.parse(into.files[0]!.after) as { nodes: { id: string; x: number; y: number; width: number; height: number }[] }
    const at = (id: string) => after.nodes.find((x) => x.id === id)!
    expect(at('cccccccccccccccc')).toMatchObject({ x: 0, y: 140 })
    expect(at('ffffffffffffffff')).toMatchObject({ x: -30, y: -50, width: 500, height: 100 + 140 + 30 + 50 })

    const moved = await tools.proposeCanvasLayout(buildScope('t'), { canvas: 'Plan', moves: [{ node: 'n1', near: 'n5' }] })
    const ops = moved.canvas!.ops.filter((o): o is Extract<CanvasOp, { op: 'move' }> => o.op === 'move')
    expect(ops.map((o) => o.id).sort()).toEqual(['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'ffffffffffffffff'])
    const dx = ops.find((o) => o.id === 'ffffffffffffffff')!.x + 30
    expect(ops.find((o) => o.id === 'bbbbbbbbbbbbbbbb')!.x).toBe(240 + dx)
    await expect(tools.proposeCanvasLayout(buildScope('t'), { canvas: 'Plan', moves: [{ node: 'n2', into: 'n3' }] })).rejects.toThrow(/not a frame/)
  })

  it('removed: a card with its arrows, an arrow alone; a note AI may not see stays', async () => {
    const draft = await tools.proposeCanvasRemove(buildScope('t'), { canvas: 'Plan', nodes: ['n1'], edges: [{ from: 'n2', to: 'n1' }] })
    // The arrow goes with its card: one removal, not two.
    expect(draft.canvas!.ops).toEqual([{ op: 'remove-node', id: 'aaaaaaaaaaaaaaaa' }])
    const after = JSON.parse(draft.files[0]!.after) as { nodes: unknown[]; edges: unknown[] }
    expect(after.nodes).toHaveLength(3)
    expect(after.edges).toHaveLength(0)
    const arrow = await tools.proposeCanvasRemove(buildScope('t'), { canvas: 'Plan', edges: [{ from: 'n2', to: 'n1' }] })
    expect(arrow.canvas!.ops).toEqual([{ op: 'remove-edge', id: 'eeeeeeeeeeeeeeee', from: 'aaaaaaaaaaaaaaaa', to: 'bbbbbbbbbbbbbbbb' }])
    await expect(tools.proposeCanvasRemove(buildScope('t'), { canvas: 'Plan', nodes: ['n4'] })).rejects.toThrow(/may not see/)
  })

  it('a new canvas is a new file in Recto/Canvas; an excluded note cannot be put on it', async () => {
    const draft = await tools.proposeCanvasNew(buildScope('t'), { name: 'Ideas', nodes: [{ text: 'One' }, { note: 'Basil' }], edges: [{ from: 'new:1', to: 'new:2' }] })
    expect(draft.files[0]).toMatchObject({ path: 'Recto/Canvas/Ideas.canvas', before: null })
    expect(JSON.parse(draft.files[0]!.after).edges).toHaveLength(1)
    await expect(tools.proposeCanvasNew(buildScope('t'), { name: 'Bad', nodes: [{ note: 'Private/Diary' }] })).rejects.toThrow('No file')
    await expect(tools.proposeCanvasNodes(buildScope('t'), { canvas: CANVAS, nodes: [{ text: 'x', near: 'n9' }] })).rejects.toThrow('No node “n9”')
  })
})
