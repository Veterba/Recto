import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What the vault overview keeps: `.recto/stats/` in the vault (merged with any
 * iCloud conflict copy, written whole), and the usage file in userData.
 */

let vault = ''
let userData = ''
let snapshotRows: { path: string; ts: number }[] = []
let snapshotContents: { path: string; ts: number; content: string }[] = []
let words = 0
vi.mock('electron', () => ({ app: { on: () => undefined, getPath: () => userData } }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => (vault === '' ? null : { path: vault, name: 'v' }) }))
vi.mock('../../src/main/topics/storage', () => ({ readSettings: () => ({ enabled: false }), readTopics: () => ({ topics: [], deleted: [] }) }))
vi.mock('../../src/main/topics/state', () => ({ topicLink: (n: string) => n }))
vi.mock('../../src/main/topics/service', () => ({ linkSources: async () => [] }))
vi.mock('../../src/main/index-client', () => ({
  send: async (request: { kind: string }) => {
    if (request.kind === 'snapshot-times') return { kind: 'snapshot-times-result', rows: snapshotRows }
    if (request.kind === 'snapshot-contents') return { kind: 'snapshot-contents-result', rows: snapshotContents }
    if (request.kind === 'words-total') return { kind: 'words-total-result', words }
    if (request.kind === 'overview') return { kind: 'overview-result', overview: { words, written: [], linked: [] } }
    throw new Error(`unexpected ${request.kind}`)
  },
}))

const overview = await import('../../src/main/overview')
const { WORDS_RULE } = await import('../../src/shared/overview')

const stats = (name: string): string => path.join(vault, '.recto', 'stats', name)
const readJson = (name: string): Record<string, unknown> => JSON.parse(fs.readFileSync(stats(name), 'utf8'))
const put = (name: string, data: unknown): void => {
  fs.mkdirSync(path.dirname(stats(name)), { recursive: true })
  fs.writeFileSync(stats(name), JSON.stringify(data))
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-overview-vault-'))
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-overview-user-'))
  snapshotRows = []
  snapshotContents = []
  words = 0
})
afterEach(async () => {
  await overview.flushEdits()
  for (const dir of [vault, userData]) fs.rmSync(dir, { recursive: true, force: true })
})

describe('the vault stats files', () => {
  it('folds iCloud conflict copies back in and removes them', async () => {
    put('edits.json', { since: '2026-10-10', backfilled: true, days: { '2026-10-17': ['a.md'] } })
    put('edits 2.json', { since: '2026-10-05', backfilled: false, days: { '2026-10-17': ['b.md'], '2026-10-06': ['c.md'] } })
    put('words.json', { days: { '2026-10-17': { start: 10, startAt: 1, end: 20, endAt: 5 } } })
    put('words 3.json', { days: { '2026-10-17': { start: 12, startAt: 2, end: 25, endAt: 9 } } })
    const data = await overview.overviewData('2026-10-18', Date.now())
    expect(data?.edits).toEqual({ '2026-10-17': ['a.md', 'b.md'], '2026-10-06': ['c.md'] })
    expect(data?.editsSince).toBe('2026-10-05')
    expect(data?.words['2026-10-17']).toEqual({ start: 10, startAt: 1, end: 25, endAt: 9 })
    expect(fs.readdirSync(path.dirname(stats('x'))).sort()).toEqual(['edits.json', 'words.json'])
    expect(readJson('edits.json')['backfilled']).toBe(true)
  })

  it('a fresh vault starts counting today: edits from today, the day’s first word count taken', async () => {
    words = 321
    const data = await overview.overviewData('2026-10-18', 1000)
    expect(data?.editsSince).toBe('2026-10-18')
    expect(data?.words).toEqual({ '2026-10-18': { start: 321, startAt: 1000, end: 321, endAt: 1000, rule: WORDS_RULE } })
    // Words written are counted from today: nothing yet, and no net change of any total.
    expect(data?.written).toEqual({})
    expect(data?.writtenSince).toBe('2026-10-18')
    expect(data?.activeSince).toBe('2026-10-18')
  })

  it('backfills edits from version history once, and keeps them in the vault', async () => {
    const at = (s: string): number => new Date(s).getTime()
    snapshotRows = [
      { path: 'a.md', ts: at('2026-10-01T09:00:00') },
      { path: 'a.md', ts: at('2026-10-02T09:00:00') },
    ]
    await overview.backfillEdits()
    expect(readJson('edits.json')).toMatchObject({ since: '2026-10-02', backfilled: true, days: { '2026-10-02': ['a.md'] } })
    snapshotRows = [...snapshotRows, { path: 'a.md', ts: at('2026-10-03T09:00:00') }]
    await overview.backfillEdits()
    expect(Object.keys(readJson('edits.json')['days'] as object)).toEqual(['2026-10-02'])
  })

  it('writes edits in a batch, to the vault they were made in, then counts words', async () => {
    words = 50
    overview.recordEdit('a.md', '2026-10-18')
    overview.recordEdit('b.md', '2026-10-18')
    overview.recordEdit('picture.png', '2026-10-18')
    const first = vault
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-overview-other-'))
    overview.recordEdit('c.md', '2026-10-18')
    // The switch flushed the first vault's edits there, not here.
    const firstEdits = JSON.parse(fs.readFileSync(path.join(first, '.recto', 'stats', 'edits.json'), 'utf8'))
    expect(firstEdits.days).toEqual({ '2026-10-18': ['a.md', 'b.md'] })
    await overview.flushEdits()
    expect(readJson('edits.json')['days']).toEqual({ '2026-10-18': ['c.md'] })
    expect((readJson('words.json')['days'] as Record<string, { end: number }>)['2026-10-18']?.end).toBe(50)
    fs.rmSync(first, { recursive: true, force: true })
  })

  it('saves keep the words you added that day; deleting them takes them off; a save with none is still an edit', async () => {
    overview.recordEdit('a.md', '2026-10-19', { added: ['one', 'two', 'three'], removed: [] })
    overview.recordEdit('a.md', '2026-10-19', { added: [], removed: ['two'] })
    overview.recordEdit('tasks/Board.md', '2026-10-19')
    await overview.flushEdits()
    overview.recordEdit('a.md', '2026-10-19', { added: ['four'], removed: ['old'] })
    await overview.flushEdits()
    const edits = readJson('edits.json')
    expect(edits['days']).toEqual({ '2026-10-19': ['a.md', 'tasks/Board.md'] })
    expect(edits['written']).toEqual({ '2026-10-19': { 'a.md': { one: 1, three: 1, four: 1 } } })
  })

  it("backfills words written once from version history: your notes' versions only, boards left out, then counts from there", async () => {
    const at = (h: number): number => new Date(`2026-10-19T${String(h).padStart(2, '0')}:00:00`).getTime()
    put('edits.json', { since: '2026-10-19', backfilled: true, days: { '2026-10-19': ['a.md', 'tasks/B.md'] } })
    snapshotContents = [
      { path: 'a.md', ts: at(9), content: '---\nx: 1\n---\nhello' },
      { path: 'a.md', ts: at(10), content: '---\nx: 2\n---\nhello there world' },
      { path: 'tasks/B.md', ts: at(9), content: '---\nkanban-plugin: board\n---\n## A' },
      { path: 'tasks/B.md', ts: at(10), content: '---\nkanban-plugin: board\n---\n## A\n- [ ] [[Lots of words here]]' },
    ]
    await overview.backfillWritten('2026-10-19')
    expect(readJson('edits.json')).toMatchObject({
      written: { '2026-10-19': { 'a.md': { there: 1, world: 1 } } },
      writtenSince: '2026-10-19',
      writtenBackfilled: true,
    })
    snapshotContents = [{ path: 'a.md', ts: at(11), content: 'many many more words that must not be read in twice' }]
    await overview.backfillWritten('2026-10-19')
    expect(readJson('edits.json')['written']).toEqual({ '2026-10-19': { 'a.md': { there: 1, world: 1 } } })
  })

  it("an earlier build's plain numbers are read in again, word by word, once", async () => {
    const at = (h: number): number => new Date(`2026-10-19T${String(h).padStart(2, '0')}:00:00`).getTime()
    put('edits.json', { since: '2026-10-19', backfilled: true, writtenBackfilled: true, days: { '2026-10-19': ['a.md'] }, written: { '2026-10-19': { 'a.md': 12 } } })
    snapshotContents = [
      { path: 'a.md', ts: at(9), content: 'hello' },
      { path: 'a.md', ts: at(10), content: 'hello there' },
    ]
    await overview.backfillWritten('2026-10-19')
    expect(readJson('edits.json')).toMatchObject({ written: { '2026-10-19': { 'a.md': { there: 1 } } }, writtenFormat: 2 })
  })

  it('a rename carries the note’s days and its last opening with it', async () => {
    put('edits.json', { since: '2026-10-01', backfilled: true, days: { '2026-10-17': ['Notes/a.md'] } })
    overview.recordOpened('Notes/a.md', 5000)
    overview.moved('Notes', 'Archive')
    expect(readJson('edits.json')['days']).toEqual({ '2026-10-17': ['Archive/a.md'] })
    const usage = JSON.parse(fs.readFileSync(path.join(userData, 'overview-usage.json'), 'utf8'))
    expect(usage.opened[vault].notes).toEqual({ 'Archive/a.md': 5000 })
  })
})
