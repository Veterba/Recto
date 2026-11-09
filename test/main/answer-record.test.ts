import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What a Quick ask answer really did, as its session records it from the tool
 * calls: a note given whole is a read, a summary is a skim, a write that made
 * a suggestion leaves its id. The notes are invented for the demo.
 */

let root = ''
let saved: unknown = null
vi.mock('electron', () => ({
  app: { on: () => undefined, getPath: () => os.tmpdir() },
  shell: {},
  BrowserWindow: { getAllWindows: () => [] },
  Notification: { isSupported: () => false },
}))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))
vi.mock('../../src/main/state', () => ({
  readState: (name: string) => (name.includes('proposals') ? saved : null),
  writeState: (name: string, value: unknown) => {
    if (name.includes('proposals')) saved = value
    return { ok: true }
  },
}))
vi.mock('../../src/main/index-client', () => ({ send: async () => ({ kind: 'backlinks-result', links: [] }) }))

const { callTool, openSession, closeSession, recordOf } = await import('../../src/main/vault-tools')

const TRIP = 'Projects/Japan trip'
const PLAN = `${TRIP}/Japan trip plan.md`
const put = (relative: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-record-'))
  saved = null
  put(
    PLAN,
    '*A note about how the trip hangs together*\n\nThe middle stretch is in [[Kyoto]]; the day-by-day lives in [[Itinerary]].\n\n## Still open\n\n- Nara\n',
  )
  put(`${TRIP}/Kyoto.md`, '*A note about the heart of the trip*\n\n## Where to go\n\nFushimi Inari at dawn.\n')
  put(`${TRIP}/Itinerary.md`, '| Day | Base |\n| --- | --- |\n| 6 | [[Kyoto]] |\n')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const session = () =>
  openSession({
    client: 'quick-ask · Test',
    tools: null,
    notes: new Set([PLAN, `${TRIP}/Kyoto.md`, `${TRIP}/Itinerary.md`]),
    writable: new Set([PLAN]),
  })

describe('the record of an answer', () => {
  it('the context alone: the open note given whole is read, its links only skimmed', async () => {
    const s = session()
    await callTool('get_note_context', { note: PLAN, budget_tokens: 3000 }, s.client, s.id)
    expect(recordOf(s)).toEqual({ read: [PLAN], skimmed: [`${TRIP}/Kyoto.md`, `${TRIP}/Itinerary.md`], proposals: [] })
    closeSession(s.id)
  })

  it('a note opened in full is a read and no longer a skim; a suggestion leaves its id', async () => {
    const s = session()
    await callTool('get_note_context', { note: PLAN, budget_tokens: 3000 }, s.client, s.id)
    await callTool('read_note', { note: 'Kyoto' }, s.client, s.id)
    await callTool('get_ai_guide', {}, s.client, s.id)
    const made = await callTool('propose_append', { note: PLAN, text: '- Osaka hotel' }, s.client, s.id)
    expect(made.ok).toBe(true)
    const record = recordOf(s)
    expect(record.read).toEqual([PLAN, `${TRIP}/Kyoto.md`])
    expect(record.skimmed).toEqual([`${TRIP}/Itinerary.md`])
    expect(record.proposals).toHaveLength(1)
    closeSession(s.id)
  })

  it('a call that fails leaves nothing', async () => {
    const s = session()
    await callTool('read_note', { note: 'Osaka hotel' }, s.client, s.id)
    expect(recordOf(s)).toEqual({ read: [], skimmed: [], proposals: [] })
    closeSession(s.id)
  })
})
