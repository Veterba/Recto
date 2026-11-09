import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What the vault overview keeps: `.recto/stats/` in the vault (merged with any
 * iCloud conflict copy, written whole) - edits, the vault's words, time spent -
 * and "last opened" in userData.
 */

let vault = ''
let userData = ''
let snapshotRows: { path: string; ts: number }[] = []
let words = 0
vi.mock('electron', () => ({ app: { on: () => undefined, getPath: () => userData } }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => (vault === '' ? null : { path: vault, name: 'v' }) }))
vi.mock('../../src/main/topics/storage', () => ({ readSettings: () => ({ enabled: false }), readTopics: () => ({ topics: [], deleted: [] }) }))
vi.mock('../../src/main/topics/state', () => ({ topicLink: (n: string) => n }))
vi.mock('../../src/main/topics/service', () => ({ linkSources: async () => [] }))
vi.mock('../../src/main/index-client', () => ({
  send: async (request: { kind: string }) => {
    if (request.kind === 'snapshot-times') return { kind: 'snapshot-times-result', rows: snapshotRows }
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
  words = 0
})
afterEach(async () => {
  await overview.flushStats()
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
    expect(data?.active).toEqual({})
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

  it("each read takes the vault's words now as the day's last count: words written are how far it moved", async () => {
    put('words.json', { days: { '2026-10-19': { start: 100, startAt: 1, end: 110, endAt: 2, rule: WORDS_RULE } } })
    // An AI answer, a paste, a sync: no save of yours, and still words in the vault.
    words = 130
    const data = await overview.overviewData('2026-10-19', 3)
    expect(data?.words['2026-10-19']).toEqual({ start: 100, startAt: 1, end: 130, endAt: 3, rule: WORDS_RULE })
    expect((readJson('words.json')['days'] as Record<string, { end: number }>)['2026-10-19']?.end).toBe(130)
    // Archived or deleted: the words leave the vault, and the day's count goes down with them.
    words = 90
    expect((await overview.overviewData('2026-10-19', 4))?.words['2026-10-19']?.end).toBe(90)
  })

  it('time in Recto is kept in the vault it was spent in, written in a batch', async () => {
    overview.recordActive('2026-10-19', 30)
    overview.recordActive('2026-10-19', 30)
    // Not written yet, and still counted on the page.
    expect(fs.existsSync(stats('active.json'))).toBe(false)
    expect((await overview.overviewData('2026-10-19', 1))?.active).toEqual({ '2026-10-19': 60 })
    const first = vault
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-overview-other-'))
    overview.recordActive('2026-10-19', 30)
    // The switch wrote the first vault's time there; the other vault has only its own.
    expect(JSON.parse(fs.readFileSync(path.join(first, '.recto', 'stats', 'active.json'), 'utf8'))).toEqual({ since: '2026-10-19', days: { '2026-10-19': 60 } })
    overview.flushActive()
    expect(readJson('active.json')).toEqual({ since: '2026-10-19', days: { '2026-10-19': 30 } })
    fs.rmSync(first, { recursive: true, force: true })
  })

  it("two Macs' copies of the time merge day by day by the larger, never the sum", async () => {
    put('active.json', { since: '2026-10-10', days: { '2026-10-17': 600, '2026-10-18': 60 } })
    put('active 2.json', { since: '2026-10-12', days: { '2026-10-17': 300, '2026-10-19': 120 } })
    const data = await overview.overviewData('2026-10-19', 1)
    expect(data?.active).toEqual({ '2026-10-17': 600, '2026-10-18': 60, '2026-10-19': 120 })
    expect(data?.activeSince).toBe('2026-10-10')
  })

  it("an older build's leftovers are not read: time kept for every vault at once, words kept per save", async () => {
    fs.writeFileSync(path.join(userData, 'overview-usage.json'), JSON.stringify({ active: { '2026-10-18': 9999 }, activeSince: '2026-10-01', opened: {} }))
    put('edits.json', { since: '2026-10-19', backfilled: true, days: {}, written: { '2026-10-19': { 'a.md': { hello: 1 } } }, writtenSince: '2026-10-19' })
    const data = await overview.overviewData('2026-10-19', 1)
    expect(data?.active).toEqual({})
    overview.recordEdit('a.md', '2026-10-19')
    await overview.flushEdits()
    expect(readJson('edits.json')).toEqual({ since: '2026-10-19', backfilled: true, days: { '2026-10-19': ['a.md'] } })
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
