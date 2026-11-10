import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_ACCESS_STATE, AI_PROPOSALS_STATE, type Proposal } from '../../src/shared/ai-access'

/**
 * Quick ask on a canvas: its session may suggest changes to that canvas -
 * waiting as ghosts, whatever the write mode - and to nothing else.
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
vi.mock('../../src/main/index-client', () => ({ send: async () => ({ kind: 'error', message: 'no index' }) }))

const { callTool, openSession, closeSession } = await import('../../src/main/vault-tools')
const { QUICK_CANVAS_TOOLS } = await import('../../src/main/providers/quick-ask')

const CANVAS = 'Recto/Canvas/Plan.canvas'

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-qa-canvas-'))
  for (const k of Object.keys(state)) delete state[k]
  // Even in Write directly mode, a chat inside Recto suggests.
  state[AI_ACCESS_STATE] = { writeMode: 'write' }
  fs.mkdirSync(path.join(root, 'Recto/Canvas'), { recursive: true })
  fs.writeFileSync(path.join(root, CANVAS), JSON.stringify({ nodes: [{ id: 'aaaaaaaaaaaaaaaa', type: 'text', text: 'Soil', x: 0, y: 0, width: 200, height: 100 }], edges: [] }))
  fs.writeFileSync(path.join(root, 'Idea.md'), '# Idea\n')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('Quick ask on a canvas', () => {
  it('suggests cards on its canvas, as ghosts to accept; the canvas file is untouched until then; it changes no note', async () => {
    const before = fs.readFileSync(path.join(root, CANVAS), 'utf8')
    const session = openSession({ client: 'quick-ask · Codex', tools: new Set(QUICK_CANVAS_TOOLS), notes: new Set([CANVAS]), writable: new Set([CANVAS]), cloud: false })
    try {
      const made = await callTool('canvas_propose_nodes', { canvas: CANVAS, nodes: [{ text: 'Compost', near: 'n1' }] }, 'recto', session.id)
      expect(made).toMatchObject({ ok: true })
      const pending = ((state[AI_PROPOSALS_STATE] as { proposals: Proposal[] }).proposals ?? []).filter((p) => p.status === 'pending')
      expect(pending).toHaveLength(1)
      expect(pending[0]!.canvas?.ops[0]).toMatchObject({ op: 'add-node', node: { text: 'Compost' } })
      expect(fs.readFileSync(path.join(root, CANVAS), 'utf8')).toBe(before)

      const refused = await callTool('propose_append', { note: 'Idea', text: 'more' }, 'recto', session.id)
      expect(refused).toMatchObject({ ok: false })
    } finally {
      closeSession(session.id)
    }
  })
})
