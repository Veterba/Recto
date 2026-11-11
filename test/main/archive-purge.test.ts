import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Purging goes by the archive's own ids: an id from the renderer never names a file outside it. */

let root = ''
const trashItem = vi.fn(async (p: string) => fs.rmSync(p, { recursive: true, force: true }))
vi.mock('electron', () => ({ shell: { trashItem: (p: string) => trashItem(p) } }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))

const { archive, list, purge } = await import('../../src/main/archive')

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
