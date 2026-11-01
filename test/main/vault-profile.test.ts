import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexRequest } from '../../src/shared/indexer-protocol'

/**
 * The vault profile: read from the vault's own settings and index, nothing
 * assumed - folders, templates, periodic notes, properties, tags, boards;
 * topics described only while they are on; excluded notes never counted.
 */

let root = ''
let topicsOn = false
const state: Record<string, unknown> = {}

vi.mock('electron', () => ({ app: { on: () => undefined, getPath: () => os.tmpdir() } }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))
vi.mock('../../src/main/state', () => ({ readState: (feature: string) => state[feature] ?? null, writeState: () => ({ ok: true }) }))
vi.mock('../../src/main/bots/vectors', () => ({ searchVectors: async () => [] }))
vi.mock('../../src/main/topics/storage', () => ({
  readSettings: () => ({ enabled: topicsOn }),
  readTopics: () => ({ topics: [{ id: 't1', name: 'Gardening' }], deleted: [] }),
}))
vi.mock('../../src/main/index-client', () => ({
  send: async (request: IndexRequest) => {
    if (request.kind === 'vault-meta')
      return {
        kind: 'vault-meta-result',
        meta: {
          notes: [
            'Garden/Basil.md',
            'Garden/Soil.md',
            'Private/Diary.md',
            'Daily/2026/10/W44/2026-10-30.md',
            'Template/Day.md',
            'Recto/Boards/B/B.md',
          ].map((p) => ({ path: p, title: null, mtime: 0, size: 1 })),
          tags: [{ path: 'Private/Diary.md', tag: 'secret' }],
          properties: [
            { path: 'Garden/Basil.md', key: 'tags', value: 'garden, herbs' },
            { path: 'Garden/Soil.md', key: 'tags', value: 'garden' },
            { path: 'Garden/Basil.md', key: 'status', value: 'growing' },
            { path: 'Private/Diary.md', key: 'mood', value: 'fine' },
          ],
        },
      }
    if (request.kind === 'boards') return { kind: 'boards-result', boards: [{ path: 'Recto/Boards/B/B.md', name: 'B', cards: 1 }] }
    if (request.kind === 'link-sources') return { kind: 'link-sources-result', paths: ['Garden/Basil.md', 'Private/Diary.md'] }
    throw new Error(`unexpected ${request.kind}`)
  },
}))

const { buildScope } = await import('../../src/main/vault-tools/scope')
const { vaultProfile, draftGuide } = await import('../../src/main/vault-tools/profile')

const put = (rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-profile-'))
  for (const p of ['Garden/Basil.md', 'Garden/Soil.md', 'Private/Diary.md', 'Daily/2026/10/W44/2026-10-30.md', 'Template/Day.md'])
    put(p, 'x\n')
  put('Recto/Boards/B/B.md', '---\nkanban-plugin: board\n---\n\n## To do\n\n- [ ] [[Soil]]\n\n## Done\n\n**Complete**\n')
  state['templates'] = { folder: 'Template', periodic: { folder: 'Daily', daily: { enabled: true } } }
  state['ai-access'] = { excluded: ['Private'], formatting: { listMarker: '-' } }
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
beforeEach(() => {
  topicsOn = false
})

describe('the vault profile', () => {
  it('says how the vault is kept, from its settings and index', async () => {
    type Profile = {
      notes: number
      folders: { folder: string; holds?: string }[]
      periodic_notes: Record<string, unknown>
      links: { style: string }
      [key: string]: unknown
    }
    const p = (await vaultProfile(buildScope('test'))) as Profile
    expect(p.notes).toBe(5)
    expect(p.folders.map((f) => f.folder)).toEqual(['Garden/', 'Daily/', 'Template/', 'Recto/'])
    expect(p.folders[1]).toMatchObject({ holds: 'periodic notes' })
    expect(p['templates']).toEqual({ folder: 'Template', templates: ['Day'] })
    expect(p.periodic_notes['daily']).toMatchObject({ on: true, last_note: '2026-10-30' })
    expect(p.periodic_notes['weekly']).toEqual({ on: false })
    expect(p.links.style).toMatch(/\[\[Note name\]\]/)
    expect(p['properties']).toContainEqual({ key: 'status', notes: 1, examples: ['growing'] })
    expect(p['tags']).toEqual([
      { tag: 'garden', notes: 2 },
      { tag: 'herbs', notes: 1 },
    ])
    expect(p['boards']).toEqual([
      {
        name: 'B',
        lanes: [
          { title: 'To do', cards: 1 },
          { title: 'Done', cards: 0 },
        ],
      },
    ])
    expect(p['formatting']).toEqual([{ rule: 'List marker', value: '-' }])
  })

  it('never counts an excluded note: not its folder, tags or properties - and names the exclusion', async () => {
    const text = JSON.stringify(await vaultProfile(buildScope('test')))
    expect(text).not.toContain('Private/')
    expect(text).not.toContain('secret')
    expect(text).not.toContain('mood')
    expect(text).toContain('"excluded_from_ai":["Private"]')
  })

  it('topics: left out while off; described, with counts that skip excluded notes, while on', async () => {
    expect(await vaultProfile(buildScope('test'))).not.toHaveProperty('topics')
    topicsOn = true
    const p = (await vaultProfile(buildScope('test'))) as { topics: { how: string; topics: unknown[] } }
    expect(p.topics.how).toMatch(/Topics are written by Recto/)
    expect(p.topics.topics).toEqual([{ name: 'Gardening', notes: 1 }])
  })

  it('the guide draft is a template from the profile, no model', async () => {
    const draft = await draftGuide(buildScope('test'))
    expect(draft).toMatch(/^# AI guide\n/)
    expect(draft).toContain('- Garden/ (2 notes)')
    expect(draft).toContain('Periodic notes: daily')
    expect(draft).toContain('#garden')
  })
})
