import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What an AI may see and where it may write, through the tool layer: a bot's
 * own excluded folders hold in a cloud chat, an app connected from outside is
 * paused while Cloud is off, an error never carries a path on this Mac, and a
 * symlinked folder is no way into an excluded one. Invented notes.
 */

let root = ''
let saved: unknown = null
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

const { callTool, openSession, closeSession } = await import('../../src/main/vault-tools')
const proposals = await import('../../src/main/vault-tools/proposals')

const put = (relative: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-privacy-'))
  saved = null
  access = { excluded: ['Private'], cloud: true }
  put('Garden/Basil.md', '# Basil\n\nPinch the tops.\n')
  put('Work/Salary.md', '# Salary\n\nThe offer.\n')
  put('Private/Diary.md', '# Diary\n')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('an AI’s reach', () => {
  it('a bot’s own excluded folders hold for its cloud chat’s tools, as the vault’s do', async () => {
    const s = openSession({ client: 'recto-chat · Codex', tools: null, notes: null, exclude: ['Work'], writable: null, cloud: true })
    expect(await callTool('read_note', { note: 'Salary' }, s.client, s.id)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/No note/),
    })
    expect((await callTool('read_note', { note: 'Basil' }, s.client, s.id)).ok).toBe(true)
    closeSession(s.id)
  })

  it('an app connected from outside is paused while Cloud is off, and works again the moment it is on', async () => {
    access = { excluded: ['Private'], cloud: false }
    const off = await callTool('read_note', { note: 'Basil' }, 'claude-code')
    expect(off).toMatchObject({ ok: false, error: expect.stringMatching(/Cloud AI is off .* nothing needs reconnecting/) })
    expect(JSON.stringify(off)).not.toContain('Pinch')
    access = { excluded: ['Private'], cloud: true }
    expect((await callTool('read_note', { note: 'Basil' }, 'claude-code')).ok).toBe(true)
  })

  it('an error never carries a path on this Mac', async () => {
    // A note this user cannot read: the system's error names its full path.
    fs.chmodSync(path.join(root, 'Garden/Basil.md'), 0o000)
    const failed = await callTool('read_note', { note: 'Basil' }, 'claude-code')
    fs.chmodSync(path.join(root, 'Garden/Basil.md'), 0o644)
    expect(failed).toMatchObject({ ok: false, error: expect.stringMatching(/could not be read/) })
    expect(JSON.stringify(failed)).not.toContain(root)
    expect(JSON.stringify(failed)).not.toContain(os.homedir())
  })

  it('a folder that is a symlink into an excluded one takes no new note', async () => {
    fs.symlinkSync(path.join(root, 'Private'), path.join(root, 'Shortcut'))
    const made = await callTool('propose_new_note', { name: 'Plans', folder: 'Shortcut', text: 'x' }, 'claude-code')
    expect(made).toMatchObject({ ok: false, error: expect.stringMatching(/excluded/) })
    expect(fs.existsSync(path.join(root, 'Private/Plans.md'))).toBe(false)
    expect((await callTool('propose_new_note', { name: 'Plans', folder: 'Garden', text: 'x' }, 'claude-code')).ok).toBe(true)
  })

  it('a folder newly excluded: settled suggestions about its notes and Write directly’s copies of them go; waiting ones and others stay', async () => {
    put('Work/Plan.md', '# Plan\n')
    access = { excluded: [], cloud: true, writeMode: 'write' }
    expect((await callTool('propose_append', { note: 'Work/Salary.md', text: 'Raise.' }, 'claude-code')).ok).toBe(true)
    access = { excluded: [], cloud: true }
    const waiting = await callTool('propose_append', { note: 'Work/Plan.md', text: 'Later.' }, 'claude-code')
    const other = await callTool('propose_append', { note: 'Garden/Basil.md', text: 'Water.' }, 'claude-code')
    const copies = path.join(root, '.recto/backup/ai')
    const [copy] = fs.readdirSync(copies)
    expect(fs.readFileSync(path.join(copies, copy!, 'Work/Salary.md'), 'utf8')).toContain('The offer')
    // A settled one about Work, by hand: the AI's own Discard.
    const list = (saved as { proposals: { id: string; status: string; files: { path: string }[] }[] }).proposals
    list.push({ ...list[0]!, id: 'old', status: 'discarded', files: [{ path: 'Work/Salary.md' }] })

    proposals.forgetExcluded(['Work'])
    const ids = (saved as { proposals: { id: string }[] }).proposals.map((p) => p.id)
    expect(ids).not.toContain('old')
    expect(ids).toContain((waiting as { blocks: { data: { proposal_id: string } }[] }).blocks[0]!.data.proposal_id)
    expect(ids).toContain((other as { blocks: { data: { proposal_id: string } }[] }).blocks[0]!.data.proposal_id)
    expect(fs.existsSync(path.join(copies, copy!, 'Work'))).toBe(false)
    // And an AI asking after the waiting one hears of no such suggestion.
    access = { excluded: ['Work'], cloud: true }
    const id = (waiting as { blocks: { data: { proposal_id: string } }[] }).blocks[0]!.data.proposal_id
    expect(await callTool('get_proposal', { id }, 'claude-code')).toMatchObject({ ok: false, error: expect.stringMatching(/No proposal/) })
  })

  it('one client has at most 30 suggestions waiting; past that it is told to stop', async () => {
    for (let i = 0; i < proposals.MAX_PENDING_PER_CLIENT; i++)
      expect((await callTool('propose_append', { note: 'Basil', text: `Line ${i}.` }, 'cursor')).ok).toBe(true)
    expect(await callTool('propose_append', { note: 'Basil', text: 'One more.' }, 'cursor')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/already wait/),
    })
    expect((await callTool('propose_append', { note: 'Basil', text: 'Mine.' }, 'codex')).ok).toBe(true)
  })
})
