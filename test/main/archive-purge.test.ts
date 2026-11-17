import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Purging goes by the archive's own ids: an id from the renderer never names a file outside it. */

let root = ''
const trashItem = vi.fn(async (p: string) => fs.rmSync(p, { recursive: true, force: true }))
vi.mock('electron', () => ({ shell: { trashItem: (p: string) => trashItem(p) } }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))

const { archive, list, purge, purgeExpired, restore } = await import('../../src/main/archive')

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-archive-'))
  trashItem.mockClear()
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('purging from the archive', () => {
  it('refuses an id the archive does not have, and trashes nothing', async () => {
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan')
    for (const id of ['../../Plan.md', '', '..']) expect((await purge(id)).ok).toBe(false)
    expect(trashItem).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(root, 'Plan.md'))).toBe(true)
  })

  it('a planted manifest id never reaches outside the archive, on open or on restore', async () => {
    fs.mkdirSync(path.join(root, 'Outside'))
    fs.writeFileSync(path.join(root, 'Outside', 'Keep.md'), '# Keep')
    fs.mkdirSync(path.join(root, '.recto', 'archive'), { recursive: true })
    const planted = (id: string): object => ({ id, originalPath: 'x.md', deletedAt: 0, kind: 'file' })
    fs.writeFileSync(
      path.join(root, '.recto', 'archive.json'),
      JSON.stringify({ retentionDays: 10, entries: [planted('../../Outside'), planted(''), planted('..')] }),
    )
    await purgeExpired()
    expect((await restore('../../Outside')).ok).toBe(false)
    expect(trashItem).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(root, 'Outside', 'Keep.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, '.recto', 'archive'))).toBe(true)
  })

  it('still purges an archived note', async () => {
    fs.writeFileSync(path.join(root, 'Old.md'), '# Old')
    const archived = await archive('Old.md')
    expect(archived.ok).toBe(true)
    if (!archived.ok) return
    expect(await purge(archived.id)).toEqual({ ok: true })
    expect(trashItem).toHaveBeenCalledTimes(1)
  })

  it('a note archived while a purge waits on the Trash stays listed', async () => {
    fs.writeFileSync(path.join(root, 'Old.md'), '# Old')
    fs.writeFileSync(path.join(root, 'New.md'), '# New')
    const old = await archive('Old.md')
    if (!old.ok) throw new Error(old.error)
    let release = (): void => undefined
    trashItem.mockImplementationOnce((p: string) => new Promise((done) => (release = () => done(fs.rmSync(p, { recursive: true, force: true })))))
    const purging = purge(old.id)
    const added = await archive('New.md')
    release()
    expect(await purging).toEqual({ ok: true })
    expect(added.ok).toBe(true)
    expect(list().entries.map((e) => e.originalPath)).toEqual(['New.md'])
  })
})

describe('an archive list that cannot be read', () => {
  it('is not read as empty and written over: nothing is archived, a copy of it is kept, the note stays where it is', async () => {
    fs.mkdirSync(path.join(root, '.recto'), { recursive: true })
    const bad = '{"retentionDays": 30, "entries": [{"id": "abc-123", "originalPath": "Old.md"'
    fs.writeFileSync(path.join(root, '.recto', 'archive.json'), bad)
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan')
    const done = await archive('Plan.md')
    expect(done).toMatchObject({ ok: false, error: expect.stringMatching(/could not be read/) })
    expect(fs.existsSync(path.join(root, 'Plan.md'))).toBe(true)
    expect(fs.readFileSync(path.join(root, '.recto', 'archive.json'), 'utf8')).toBe(bad)
    expect(fs.readdirSync(path.join(root, '.recto')).some((f) => f.startsWith('archive.json.bad-'))).toBe(true)
    // Listing it does not write over it either.
    list()
    expect(fs.readFileSync(path.join(root, '.recto', 'archive.json'), 'utf8')).toBe(bad)
  })
})
