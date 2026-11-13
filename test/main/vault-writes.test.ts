import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Writes that used to lose text: two at once on one note, a lossy save, an undo over newer edits. */

let root = ''
vi.mock('electron', () => ({ shell: {} }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))

const { writeFile, readFile, rename, rewriteCanvasesTo, undoRelocate, rewriteLinksTo, restoreContents } = await import('../../src/main/vault-fs')

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

describe('a canvas in a folder that moves', () => {
  it('keeps the notes on it that moved with it', async () => {
    fs.mkdirSync(file('Trip'))
    fs.writeFileSync(file('Trip/Plan.md'), '# Plan')
    const canvas = { nodes: [{ id: 'n1', type: 'file', file: 'Trip/Plan.md', x: 0, y: 0, width: 200, height: 100 }], edges: [] }
    fs.writeFileSync(file('Trip/Board.canvas'), JSON.stringify(canvas))
    // The referrers are found before the move, under the old paths - as relocate does.
    const referrers = ['Trip/Board.canvas']
    const moved = await rename('Trip', 'Japan')
    expect(moved.ok).toBe(true)
    await rewriteCanvasesTo(referrers, 'Trip', 'Japan')
    const after = JSON.parse(fs.readFileSync(file('Japan/Board.canvas'), 'utf8')) as typeof canvas
    expect(after.nodes[0]?.file).toBe('Japan/Plan.md')
  })

  it('an undo of the move puts the canvas back as it was, in the old folder', async () => {
    fs.mkdirSync(file('Trip'))
    fs.writeFileSync(file('Trip/Plan.md'), '# Plan')
    const before = JSON.stringify({ nodes: [{ id: 'n1', type: 'file', file: 'Trip/Plan.md', x: 0, y: 0, width: 200, height: 100 }], edges: [] })
    fs.writeFileSync(file('Trip/Board.canvas'), before)
    await rename('Trip', 'Japan')
    const changed = await rewriteCanvasesTo(['Trip/Board.canvas'], 'Trip', 'Japan')
    expect(await undoRelocate({ from: 'Japan', to: 'Trip', entries: changed })).toMatchObject({ ok: true, path: 'Trip', restored: 1 })
    expect(fs.readFileSync(file('Trip/Board.canvas'), 'utf8')).toBe(before)
  })
})

describe('writes in flight', () => {
  it('writesSettled waits for every write already started', async () => {
    const { writesSettled } = await import('../../src/main/vault-fs')
    const big = 'x'.repeat(5_000_000)
    let written = false
    void writeFile('big.md', big).then(() => (written = true))
    await writesSettled()
    expect(written).toBe(true)
    expect(fs.statSync(file('big.md')).size).toBe(big.length)
  })
})

describe('a saved note stays the same file', () => {
  it('keeps its creation date, permissions and Finder tags', async () => {
    fs.writeFileSync(file('Kept.md'), 'old')
    fs.chmodSync(file('Kept.md'), 0o600)
    const born = fs.statSync(file('Kept.md')).birthtimeMs
    const tagged = process.platform === 'darwin'
    if (tagged) execFileSync('xattr', ['-w', 'com.recto.test', 'tag', file('Kept.md')])
    await new Promise((r) => setTimeout(r, 20))
    expect(await writeFile('Kept.md', 'new text')).toEqual({ ok: true })
    expect(fs.readFileSync(file('Kept.md'), 'utf8')).toBe('new text')
    expect(fs.statSync(file('Kept.md')).birthtimeMs).toBe(born)
    expect(fs.statSync(file('Kept.md')).mode & 0o777).toBe(0o600)
    if (tagged) expect(execFileSync('xattr', ['-p', 'com.recto.test', file('Kept.md')]).toString().trim()).toBe('tag')
    expect(fs.readdirSync(root)).toEqual(['Kept.md'])
  })

  it('a note that is a symlink stays a symlink, and its target gets the text', async () => {
    fs.mkdirSync(file('Real'))
    fs.writeFileSync(file('Real/Target.md'), 'old')
    fs.symlinkSync(file('Real/Target.md'), file('Link.md'))
    expect(await writeFile('Link.md', 'through the link')).toEqual({ ok: true })
    expect(fs.lstatSync(file('Link.md')).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(file('Real/Target.md'), 'utf8')).toBe('through the link')
  })
})
