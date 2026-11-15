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

describe('a note proposal, change by change', () => {
  const NOTE = '# Basil\n\nPinch the tops.\n\n## Harvest\n\nMorning.\n'
  const EDITED = '# Basil\n\nPinch the tops weekly.\n\n## Harvest\n\nMorning.\nDry in the shade.\n'
  const queue = (before = NOTE, after = EDITED) =>
    proposals.queue({ summary: 'edit Basil', formatted: [], files: [{ path: 'Basil.md', before, after }] }, 'recto-chat · Codex', 'propose_edit')
  const read = (): string => fs.readFileSync(file('Basil.md'), 'utf8')
  beforeEach(() => fs.writeFileSync(file('Basil.md'), NOTE))

  it('one change accepted, the other rejected: the note has only the first, the proposal is applied, each change says what it became', async () => {
    const p = queue()
    expect(await proposals.apply(p.id, [0])).toEqual({ ok: true })
    expect(read()).toBe(NOTE.replace('Pinch the tops.', 'Pinch the tops weekly.'))
    expect(proposals.proposal(p.id)).toMatchObject({ status: 'pending', files: [{ states: ['accepted', 'pending'] }] })
    proposals.discard(p.id, [1])
    expect(proposals.proposal(p.id)).toMatchObject({ status: 'applied', files: [{ states: ['accepted', 'rejected'] }] })
    expect(read()).not.toContain('Dry in the shade')
  })

  it('the person typed elsewhere in the note since: every change still goes in, around what they typed', async () => {
    const p = queue()
    fs.writeFileSync(file('Basil.md'), `Seeds from Anna.\n${NOTE}`)
    expect(await proposals.apply(p.id)).toEqual({ ok: true })
    expect(read()).toBe(`Seeds from Anna.\n${EDITED}`)
  })

  it('the person changed the very line a change is about: that one is out of date, the other goes in, and it says so', async () => {
    const p = queue()
    fs.writeFileSync(file('Basil.md'), NOTE.replace('Pinch the tops.', 'Pinch the tops in June.'))
    const result = await proposals.apply(p.id)
    expect(result).toMatchObject({ ok: false, stale: true, error: expect.stringMatching(/1 of these changes no longer fit/) })
    expect(read()).toContain('Pinch the tops in June.')
    expect(read()).toContain('Dry in the shade.')
    expect(proposals.proposal(p.id)).toMatchObject({ status: 'applied', files: [{ states: ['stale', 'accepted'] }] })
  })

  it('a second proposal on the same note still applies after the first', async () => {
    const first = queue(NOTE, NOTE.replace('Morning.', 'Morning, before the heat.'))
    const second = queue(NOTE, NOTE.replace('# Basil', '# Basil (Genovese)'))
    expect(await proposals.apply(first.id)).toEqual({ ok: true })
    expect(await proposals.apply(second.id)).toEqual({ ok: true })
    expect(read()).toBe(NOTE.replace('Morning.', 'Morning, before the heat.').replace('# Basil', '# Basil (Genovese)'))
  })
})
