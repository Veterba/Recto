import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The AI's read tools against a stand-in index: a task carried from daily
 * note to daily note is one task, a folder filter reaches the index, and a
 * note reads while the index is rebuilding. Invented notes.
 */

let root = ''
const vectorOrder: string[] = []
type Request = { kind: string; paths?: string[] }
let answer: (request: Request) => Promise<unknown> = async () => ({})
const asked: Request[] = []
vi.mock('electron', () => ({ app: { on: () => undefined, getPath: () => os.tmpdir() }, shell: {} }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))
vi.mock('../../src/main/state', () => ({
  readState: (n: string) => (n.includes('ai-access') ? { excluded: ['Private'] } : null),
  writeState: () => ({ ok: true }),
}))
vi.mock('../../src/main/bots/vectors', () => ({ searchVectors: async () => { vectorOrder.push('search'); return [] }, syncVectors: async () => { vectorOrder.push('sync'); return {} } }))
vi.mock('../../src/main/index-client', () => ({
  send: async (request: Request) => {
    asked.push(request)
    return answer(request)
  },
}))

const { buildScope } = await import('../../src/main/vault-tools/scope')
const { listFolder, listTags, listTasks, readNoteTool, recentNotes, searchNotes } = await import('../../src/main/vault-tools/read')

const put = (relative: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}
const dataOf = (blocks: unknown[]): Record<string, unknown> => (blocks[0] as { data: Record<string, unknown> }).data
const row = (p: string, text: string, done: boolean, noteDate: string) => ({
  path: p,
  title: path.basename(p, '.md'),
  text,
  norm: text.toLowerCase(),
  done,
  source: 'checkbox',
  status: null,
  noteDate,
  doneAt: null,
  due: null,
  board: null,
})

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-read-tools-'))
  asked.length = 0
  for (const p of ['Daily/2026-11-10.md', 'Daily/2026-11-11.md', 'Daily/2026-11-12.md', 'Garden/Basil.md', 'Private/Diary.md'])
    put(p, '# x\n')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('list_tasks', () => {
  it('a task copied across three daily notes is one task, open or done as its latest copy says', async () => {
    answer = async () => ({
      kind: 'task-rows-result',
      rows: [
        row('Daily/2026-11-10.md', 'Call the plumber', false, '2026-11-10'),
        row('Daily/2026-11-11.md', 'Call the plumber', false, '2026-11-11'),
        row('Daily/2026-11-12.md', 'Call the plumber', true, '2026-11-12'),
        row('Daily/2026-11-12.md', 'Buy compost', false, '2026-11-12'),
      ],
    })
    const open = dataOf(await listTasks(buildScope('test'), { status: 'open', limit: 50 }))['tasks'] as { text: string }[]
    expect(open.map((t) => t.text)).toEqual(['Buy compost'])
    const all = dataOf(await listTasks(buildScope('test'), { status: 'all', limit: 50 }))['tasks'] as Record<string, unknown>[]
    expect(all).toContainEqual(
      expect.objectContaining({
        text: 'Call the plumber',
        status: 'done',
        path: 'Daily/2026-11-12.md',
        copies: 3,
        carried_since: '2026-11-10',
      }),
    )
    expect(all).toHaveLength(2)
  })
})

describe('search_notes', () => {
  it('a folder filter goes to the index with the query, as the notes it may return', async () => {
    answer = async (r) =>
      r.kind === 'vault-meta'
        ? {
            kind: 'vault-meta-result',
            meta: {
              notes: ['Garden/Basil.md', 'Daily/2026-11-10.md', 'Private/Diary.md'].map((p) => ({
                path: p,
                title: null,
                mtime: 0,
                size: 1,
              })),
              tags: [],
              properties: [],
            },
          }
        : { kind: 'search-result', hits: [] }
    await searchNotes(buildScope('test'), { query: 'water', mode: 'text', folder: 'Garden', limit: 10 })
    expect(asked.find((r) => r.kind === 'search')?.paths).toEqual(['Garden/Basil.md'])
  })
})

describe('read_note', () => {
  it('reads the note while the index is rebuilding, and says its backlinks wait', async () => {
    put('Garden/Basil.md', '# Basil\n\nPinch the tops.\n')
    answer = async () => {
      throw new Error('index not ready')
    }
    const blocks = await readNoteTool(buildScope('test'), { note: 'Garden/Basil.md', offset: 0, max_chars: 4000 })
    expect(dataOf(blocks)).toMatchObject({ path: 'Garden/Basil.md', backlinks: null, backlinks_note: expect.stringMatching(/not ready/) })
    expect((blocks[1] as { text: string }).text).toContain('Pinch the tops')
  })
})

/** The index's view of the vault: every note, its tags and properties (as vault-meta answers). */
const meta = () => ({
  kind: 'vault-meta-result',
  meta: {
    notes: [
      { path: 'Books/Dune.md', title: 'Dune', mtime: Date.parse('2026-11-14'), size: 1 },
      { path: 'Books/Emma.md', title: 'Emma', mtime: Date.parse('2026-11-12'), size: 1 },
      { path: 'Garden/Basil.md', title: 'Basil', mtime: Date.parse('2026-11-13'), size: 1 },
      { path: 'Private/Diary.md', title: 'Diary', mtime: Date.parse('2026-11-15'), size: 1 },
    ],
    tags: [
      { path: 'Books/Dune.md', tag: 'book/scifi' },
      { path: 'Books/Emma.md', tag: 'book' },
      { path: 'Garden/Basil.md', tag: 'bookish' },
      { path: 'Private/Diary.md', tag: 'book' },
    ],
    properties: [
      { path: 'Books/Dune.md', key: 'status', value: 'reading' },
      { path: 'Books/Emma.md', key: 'status', value: '["done", "loved"]' },
    ],
  },
})

describe('finding notes without words to search for', () => {
  beforeEach(() => {
    for (const p of ['Books/Dune.md', 'Books/Emma.md', 'Books/cover.png', 'Books/Notes.pdf']) put(p, 'x')
    answer = async (r) => (r.kind === 'vault-meta' ? meta() : {})
  })
  const notes = async (a: Record<string, unknown>): Promise<string[]> =>
    (dataOf(await searchNotes(buildScope('test'), { mode: 'both', limit: 20, ...a }))['notes'] as { path: string }[]).map((n) => n.path)

  it('a tag lists its notes, newest first, its nested tags with it - never a tag that only starts the same, never an excluded note', async () => {
    expect(await notes({ tag: 'book' })).toEqual(['Books/Dune.md', 'Books/Emma.md'])
  })

  it('a property lists the notes that have it, or that value of it - a list’s items each', async () => {
    expect(await notes({ property: 'status' })).toEqual(['Books/Dune.md', 'Books/Emma.md'])
    expect(await notes({ property: 'Status', value: 'loved' })).toEqual(['Books/Emma.md'])
  })

  it('no query and no filter is asked for again, plainly', async () => {
    await expect(searchNotes(buildScope('test'), { mode: 'both', limit: 20 })).rejects.toThrow(/Give a query, or a filter/)
  })

  it('a folder’s other files when asked for; lists say how many there are in all', async () => {
    const entries = (dataOf(await listFolder(buildScope('test'), { folder: 'Books', files: true, limit: 100 }))['entries'] as { path: string; type: string }[]).map((e) => `${e.type}:${e.path}`)
    expect(entries).toEqual(['note:Books/Dune.md', 'note:Books/Emma.md', 'file:Books/Notes.pdf', 'file:Books/cover.png'])
    const tags = dataOf(await listTags(buildScope('test'), { limit: 1 }))
    expect(tags).toMatchObject({ total: 3, next_cursor: '1' })
    const recent = dataOf(await recentNotes(buildScope('test'), { folder: 'Books', limit: 20 }))
    expect((recent['notes'] as { path: string }[]).map((n) => n.path)).toEqual(['Books/Dune.md', 'Books/Emma.md'])
  })
})

describe('list_tasks gives what changing a task takes', () => {
  it('a note’s task its line; a card its name', async () => {
    put('Daily/2026-11-12.md', '# Today\n\n- [x] Water basil\n- [ ] Buy compost\n')
    answer = async () => ({ kind: 'task-rows-result', rows: [row('Daily/2026-11-12.md', 'Buy compost', false, '2026-11-12'), { ...row('Recto/Boards/Launch/Ship it.md', 'Ship it', false, '2026-11-12'), source: 'card', board: 'Launch' }] })
    put('Recto/Boards/Launch/Ship it.md', '---\npriority: high\n---\n')
    const tasks = dataOf(await listTasks(buildScope('test'), { status: 'open', limit: 50 }))['tasks'] as Record<string, unknown>[]
    expect(tasks).toContainEqual(expect.objectContaining({ text: 'Buy compost', path: 'Daily/2026-11-12.md', line: 4 }))
    expect(tasks).toContainEqual(expect.objectContaining({ text: 'Ship it', card: 'Ship it', board: 'Launch', priority: 'high' }))
  })
})

describe('search by meaning', () => {
  it('brings the notes changed since up to date before it searches', async () => {
    vectorOrder.length = 0
    answer = async (r) => (r.kind === 'vault-meta' ? meta() : r.kind === 'search' ? { kind: 'search-result', hits: [] } : {})
    await searchNotes(buildScope('test'), { query: 'soil', mode: 'semantic', limit: 10 })
    expect(vectorOrder).toEqual(['sync', 'search'])
  })
})
