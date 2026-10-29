import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Writes that used to lose text: two at once on one note, a lossy save, an undo over newer edits. */

let root = ''
vi.mock('electron', () => ({ shell: {} }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))

const { writeFile, readFile, rename, rewriteLinksTo, restoreContents } = await import('../../src/main/vault-fs')

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-writes-'))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const file = (rel: string): string => path.join(root, rel)

describe('vault writes', () => {
  it('two writes to one note at once both succeed and leave one of them whole', async () => {
    fs.writeFileSync(file('note.md'), 'start')
    const a = 'a'.repeat(200_000)
    const b = 'b'.repeat(200_000)
    const results = await Promise.all([writeFile('note.md', a), writeFile('note.md', b)])
    expect(results).toEqual([{ ok: true }, { ok: true }])
    expect([a, b]).toContain(fs.readFileSync(file('note.md'), 'utf8'))
    expect(fs.readdirSync(root)).toEqual(['note.md'])
  })

  it('neither opens nor overwrites a file whose bad bytes start after the first 8 KB', async () => {
    const bytes = Buffer.concat([Buffer.from('a'.repeat(9000)), Buffer.from([0xff, 0xfe]), Buffer.from('tail')])
    fs.writeFileSync(file('legacy.md'), bytes)
    expect((await readFile('legacy.md')).ok).toBe(false)
    expect((await writeFile('legacy.md', 'replaced')).ok).toBe(false)
    expect(fs.readFileSync(file('legacy.md')).equals(bytes)).toBe(true)
  })

  it('undoing a link rewrite leaves a note edited since alone', async () => {
    fs.writeFileSync(file('a.md'), 'See [[Old]].')
    fs.writeFileSync(file('b.md'), 'Also [[Old]].')
    const { changed } = await rewriteLinksTo(['a.md', 'b.md'], 'Old.md', 'New.md')
    expect(changed.map((c) => c.path)).toEqual(['a.md', 'b.md'])
    // Edited after the rename, before the undo.
    fs.writeFileSync(file('b.md'), 'Also [[New]]. And a new line.')
    expect(await restoreContents(changed)).toEqual({ restored: 1, skipped: 1 })
    expect(fs.readFileSync(file('a.md'), 'utf8')).toBe('See [[Old]].')
    expect(fs.readFileSync(file('b.md'), 'utf8')).toBe('Also [[New]]. And a new line.')
  })

  it('renames a note when only the case of its name changes', async () => {
    fs.writeFileSync(file('ideas.md'), 'x')
    expect(await rename('ideas.md', 'Ideas.md')).toEqual({ ok: true, path: 'Ideas.md' })
    expect(fs.readdirSync(root)).toEqual(['Ideas.md'])
  })

  it('still refuses a name another file has', async () => {
    fs.mkdirSync(file('a'))
    fs.mkdirSync(file('b'))
    expect((await rename('a', 'b')).ok).toBe(false)
  })
})
