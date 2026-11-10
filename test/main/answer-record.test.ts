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
/** The vault's AI settings (Settings → AI): the guide, the excluded folders. */
let access: unknown = null
vi.mock('electron', () => ({
  app: { on: () => undefined, getPath: () => os.tmpdir() },
  shell: {},
  BrowserWindow: { getAllWindows: () => [] },
  Notification: { isSupported: () => false },
}))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))
vi.mock('../../src/main/state', () => ({
  readState: (name: string) => (name.includes('proposals') ? saved : name.includes('ai-access') ? access : null),
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
  access = null
  put(
    PLAN,
    '*A note about how the trip hangs together*\n\nThe middle stretch is in [[Kyoto]]; the day-by-day lives in [[Itinerary]].\n\n## Still open\n\n- Nara\n',
  )
  put(`${TRIP}/Kyoto.md`, '*A note about the heart of the trip*\n\n## Where to go\n\nFushimi Inari at dawn.\n')
  put(`${TRIP}/Itinerary.md`, '| Day | Base |\n| --- | --- |\n| 6 | [[Kyoto]] |\n')
  put(`${TRIP}/Packing.txt`, 'Passport\nRail pass\nAdapter\n')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const session = () =>
  openSession({
    client: 'quick-ask · Test',
    tools: null,
    notes: new Set([PLAN, `${TRIP}/Kyoto.md`, `${TRIP}/Itinerary.md`, `${TRIP}/Packing.txt`]),
    writable: new Set([PLAN]),
    cloud: false,
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

  it('a note given only in part - cut short, or from an offset - is a skim, not a read', async () => {
    const s = session()
    put(`${TRIP}/Kyoto.md`, `## Where to go\n\n${'Fushimi Inari at dawn. '.repeat(40)}`)
    await callTool('read_note', { note: 'Kyoto', max_chars: 500 }, s.client, s.id)
    await callTool('read_note', { note: 'Itinerary', offset: 5 }, s.client, s.id)
    expect(recordOf(s)).toEqual({ read: [], skimmed: [`${TRIP}/Kyoto.md`, `${TRIP}/Itinerary.md`], proposals: [] })
    closeSession(s.id)
  })

  it('a file says whether it was given whole: all of it is a read, from an offset a skim', async () => {
    const whole = session()
    await callTool('read_file', { file: `${TRIP}/Packing.txt` }, whole.client, whole.id)
    expect(recordOf(whole).read).toEqual([`${TRIP}/Packing.txt`])
    closeSession(whole.id)
    const part = session()
    await callTool('read_file', { file: `${TRIP}/Packing.txt`, offset: 9 }, part.client, part.id)
    expect(recordOf(part)).toEqual({ read: [], skimmed: [`${TRIP}/Packing.txt`], proposals: [] })
    closeSession(part.id)
  })

  it('the AI guide is not a note the answer read; one in an excluded folder is not given at all', async () => {
    access = { guide: `${TRIP}/Kyoto.md`, excluded: [] }
    const s = session()
    const given = await callTool('get_ai_guide', {}, s.client, s.id)
    expect(given.ok && given.blocks.some((b) => b.kind === 'note')).toBe(true)
    expect(recordOf(s)).toEqual({ read: [], skimmed: [], proposals: [] })
    closeSession(s.id)
    access = { guide: `${TRIP}/Kyoto.md`, excluded: [TRIP] }
    const hidden = await callTool('get_ai_guide', {}, 'claude-code')
    expect(hidden.ok && hidden.blocks.some((b) => b.kind === 'note')).toBe(false)
  })

  it('a session stops calling once cloud is turned off, or another vault is open', async () => {
    access = { excluded: [], cloud: true }
    const cloud = openSession({ client: 'quick-ask · Codex', tools: null, notes: null, writable: null, cloud: true })
    expect((await callTool('read_note', { note: 'Kyoto' }, cloud.client, cloud.id)).ok).toBe(true)
    access = { excluded: [], cloud: false }
    const off = await callTool('read_note', { note: 'Kyoto' }, cloud.client, cloud.id)
    expect(off).toMatchObject({ ok: false, error: expect.stringMatching(/turned off/) })
    closeSession(cloud.id)
    // A local model's session is not held by the cloud switch - but by the vault, it is.
    const local = session()
    const before = root
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-record-other-'))
    const moved = await callTool('read_note', { note: 'Kyoto' }, local.client, local.id)
    expect(moved).toMatchObject({ ok: false, error: expect.stringMatching(/Another vault/) })
    fs.rmSync(root, { recursive: true, force: true })
    root = before
    closeSession(local.id)
  })

  it("an excluded folder takes no new note or canvas, and the refusal says nothing about what it holds", async () => {
    put('Private/Diary.md', '# Diary\n')
    access = { excluded: ['Private', 'Recto/Canvas'], cloud: true }
    const note = await callTool('propose_new_note', { name: 'Diary', folder: 'Private', text: 'x' }, 'claude-code')
    expect(note).toMatchObject({ ok: false, error: expect.stringMatching(/excluded/) })
    expect(note.ok ? '' : note.error).not.toMatch(/already/)
    const canvas = await callTool('canvas_propose_new', { name: 'Ideas', nodes: [{ text: 'A card' }] }, 'claude-code')
    expect(canvas).toMatchObject({ ok: false, error: expect.stringMatching(/excluded/) })
  })

  it('a call that fails leaves nothing', async () => {
    const s = session()
    await callTool('read_note', { note: 'Osaka hotel' }, s.client, s.id)
    expect(recordOf(s)).toEqual({ read: [], skimmed: [], proposals: [] })
    closeSession(s.id)
  })
})
