import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A note proposal applied: once only, whatever is clicked how often, and all of its files or none. */

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

const file = (rel: string): string => path.join(root, rel)

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-note-prop-'))
  for (const k of Object.keys(state)) delete state[k]
  fs.writeFileSync(file('Plan.md'), 'one\n')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('applying a note proposal', () => {
  it('applied twice at once - a double click, or Apply beside Apply all - is written once and stays applied', async () => {
    const p = proposals.queue({ summary: 'add two', formatted: [], files: [{ path: 'Plan.md', before: 'one\n', after: 'one\ntwo\n' }] }, 'claude-code', 'propose_edit')
    const [a, b] = await Promise.all([proposals.apply(p.id), proposals.apply(p.id)])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    expect(fs.readFileSync(file('Plan.md'), 'utf8')).toBe('one\ntwo\n')
    expect(proposals.proposal(p.id)?.status).toBe('applied')
  })

  it('a later file that cannot be written puts the first back, and the proposal can be applied again', async () => {
    // A file where the new note's folder should be: the write fails.
    fs.writeFileSync(file('Blocker'), 'not a folder')
    const p = proposals.queue(
      {
        summary: 'card as a note',
        formatted: [],
        files: [
          { path: 'Plan.md', before: 'one\n', after: 'one\n[[Card]]\n' },
          { path: 'Blocker/Card.md', before: null, after: 'card' },
        ],
      },
      'claude-code',
      'propose_task',
    )
    const result = await proposals.apply(p.id)
    expect(result.ok).toBe(false)
    expect(fs.readFileSync(file('Plan.md'), 'utf8')).toBe('one\n')
    expect(proposals.proposal(p.id)?.status).toBe('pending')
  })
})
