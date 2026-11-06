import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseCanvas } from '../../src/shared/canvas'
import type { CanvasOp } from '../../src/shared/canvas-ops'

/**
 * A canvas proposal: its edits wait as ghosts; settled one by one from the
 * canvas, or all at once from Suggested edits - onto the canvas as it is
 * then, an edit whose node is gone since left out.
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

const proposals = await import('../../src/main/vault-tools/proposals')

const CANVAS = 'Recto/Canvas/Plan.canvas'
const text = (nodes: object[]): string => JSON.stringify({ nodes, edges: [] })
const read = (): ReturnType<typeof parseCanvas> => parseCanvas(fs.readFileSync(path.join(root, CANVAS), 'utf8'))
const ops: CanvasOp[] = [
  { op: 'add-node', node: { ref: 'g1', type: 'text', text: 'Compost', x: 300, y: 0, width: 200, height: 100 } },
  { op: 'add-edge', from: 'a', to: 'g1' },
  { op: 'move', id: 'b', x: 0, y: 500 },
]

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-canvas-prop-'))
  for (const k of Object.keys(state)) delete state[k]
  fs.mkdirSync(path.join(root, 'Recto/Canvas'), { recursive: true })
  fs.writeFileSync(
    path.join(root, CANVAS),
    text([
      { id: 'a', type: 'text', text: 'Soil', x: 0, y: 0, width: 200, height: 100 },
      { id: 'b', type: 'text', text: 'Water', x: 0, y: 200, width: 200, height: 100 },
    ]),
  )
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const draft = () => ({ summary: '3 changes to Plan', files: [], formatted: [], canvas: { path: CANVAS, ops } })

describe('canvas proposals', () => {
  it('wait with every edit pending; settled from the canvas, edit by edit', () => {
    const made = proposals.queue(draft(), 'claude-code', 'canvas_propose_nodes')
    expect(made.canvas?.states).toEqual(['pending', 'pending', 'pending'])
    expect(proposals.updateCanvas(made.id, ['accepted', 'pending', 'rejected'], { g1: 'x' })).toEqual({ ok: true })
    expect(proposals.proposal(made.id)?.status).toBe('pending')
    proposals.updateCanvas(made.id, ['accepted', 'rejected', 'rejected'], { g1: 'x' })
    expect(proposals.proposal(made.id)?.status).toBe('applied')
  })

  it('Apply from Suggested edits writes them onto the canvas as it is now; one whose node is gone since is left out', async () => {
    const made = proposals.queue(draft(), 'claude-code', 'canvas_propose_nodes')
    // Water deleted since the proposal was made.
    fs.writeFileSync(path.join(root, CANVAS), text([{ id: 'a', type: 'text', text: 'Soil', x: 0, y: 0, width: 200, height: 100 }]))
    expect(await proposals.apply(made.id)).toEqual({ ok: true })
    const after = read()
    expect(after.nodes.map((n) => n.text)).toEqual(['Soil', 'Compost'])
    expect(after.edges).toHaveLength(1)
    expect(proposals.proposal(made.id)?.canvas?.states).toEqual(['accepted', 'accepted', 'stale'])
  })

  it('Write directly applies them at once, with a backup of the canvas', async () => {
    expect(await proposals.applyNow(draft())).toEqual({ ok: true })
    expect(read().nodes.find((n) => n.id === 'b')).toMatchObject({ y: 500 })
  })
})
