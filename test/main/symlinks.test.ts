import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { realPath, resolveInVault } from '../../src/main/paths'

/**
 * A symlink inside the vault that points outside it (notes/linked -> ~/.ssh)
 * must never be read, listed or indexed: the bots send what they read to a
 * model. Real files and real symlinks in a temp folder - path text alone is
 * exactly what the old check trusted.
 */

let base = ''
let root = ''
vi.mock('electron', () => ({ shell: {}, app: { on: () => undefined, getPath: () => os.tmpdir() } }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))

const vaultFs = await import('../../src/main/vault-fs')
const indexer = await import('../../src/workers/indexer/index')
const indexDb = await import('../../src/workers/indexer/db')
const { runTool } = await import('../../src/main/bots/model-tools')

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-symlinks-'))
  root = path.join(base, 'vault')
  const outside = path.join(base, 'outside')
  fs.mkdirSync(path.join(outside, 'secret'), { recursive: true })
  fs.writeFileSync(path.join(outside, 'secret', 'id_rsa.md'), 'PRIVATE KEY')
  fs.writeFileSync(path.join(outside, 'passwd.md'), 'root:x:0:0')
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true })
  fs.mkdirSync(path.join(root, 'real'))
  fs.writeFileSync(path.join(root, 'real', 'note.md'), '# Real note')
  fs.writeFileSync(path.join(root, 'plain.md'), '# Plain')
  fs.writeFileSync(path.join(root, '..notes.md'), '# Dot dot')
  fs.symlinkSync(path.join(outside, 'secret'), path.join(root, 'notes', 'linked'))
  fs.symlinkSync(path.join(outside, 'passwd.md'), path.join(root, 'pw.md'))
  fs.symlinkSync(path.join(outside, 'not-yet.md'), path.join(root, 'dangling.md'))
  fs.symlinkSync(path.join(root, 'real', 'note.md'), path.join(root, 'inside.md'))
  fs.symlinkSync(path.join(root, 'real'), path.join(root, 'inner'))
  fs.symlinkSync(root, path.join(base, 'vault-link'))
})
afterAll(() => {
  indexDb.closeDb()
  fs.rmSync(base, { recursive: true, force: true })
})

describe('resolveInVault and symlinks', () => {
  it('refuses a symlinked file and a symlinked folder pointing outside', () => {
    expect(() => resolveInVault(root, 'pw.md')).toThrow(/points outside the vault/)
    expect(() => resolveInVault(root, 'notes/linked')).toThrow(/points outside the vault/)
    expect(() => resolveInVault(root, 'notes/linked/id_rsa.md')).toThrow(/points outside the vault/)
    // A file that does not exist yet, under the outside folder: still outside.
    expect(() => resolveInVault(root, 'notes/linked/new/deep.md')).toThrow(/points outside the vault/)
  })

  it('refuses a dangling symlink, since writing through it would create its target outside', () => {
    expect(() => resolveInVault(root, 'dangling.md')).toThrow(/points outside the vault/)
  })

  it('keeps symlinks that stay inside the vault working', () => {
    expect(resolveInVault(root, 'inside.md')).toBe(path.join(root, 'inside.md'))
    expect(resolveInVault(root, 'inner/note.md')).toBe(path.join(root, 'inner', 'note.md'))
  })

  it('accepts "..notes.md", a legal name, and still refuses ".."', () => {
    expect(resolveInVault(root, '..notes.md')).toBe(path.join(root, '..notes.md'))
    expect(() => resolveInVault(root, '..')).toThrow(/escapes vault/)
    expect(() => resolveInVault(root, '../outside/passwd.md')).toThrow(/escapes vault/)
  })

  it('accepts a new file in a missing subfolder', () => {
    expect(resolveInVault(root, 'a/b/c/new.md')).toBe(path.join(root, 'a', 'b', 'c', 'new.md'))
    expect(realPath(path.join(root, 'a', 'b', 'new.md'))).toBe(path.join(fs.realpathSync(root), 'a', 'b', 'new.md'))
  })

  it('works for a vault opened through a symlinked path', () => {
    const viaLink = path.join(base, 'vault-link')
    expect(resolveInVault(viaLink, 'plain.md')).toBe(path.join(viaLink, 'plain.md'))
    expect(resolveInVault(viaLink, 'new/x.md')).toBe(path.join(viaLink, 'new', 'x.md'))
    expect(() => resolveInVault(viaLink, 'pw.md')).toThrow(/points outside the vault/)
  })
})

describe('vault files and symlinks', () => {
  it('does not open a file through an outside symlink, and says why', async () => {
    const read = await vaultFs.readFile('notes/linked/id_rsa.md')
    expect(read).toEqual({ ok: false, error: expect.stringMatching(/points outside the vault/) })
    expect((await vaultFs.readFile('pw.md')).ok).toBe(false)
    expect(await vaultFs.readFile('inside.md')).toEqual({ ok: true, content: '# Real note' })
  })

  it('does not write through a dangling symlink', async () => {
    expect((await vaultFs.writeFile('dangling.md', 'x')).ok).toBe(false)
    expect(fs.existsSync(path.join(base, 'outside', 'not-yet.md'))).toBe(false)
  })

  it('writes a new note in a missing subfolder', async () => {
    expect(await vaultFs.writeFile('fresh/sub/new.md', 'hi')).toEqual({ ok: true })
    expect(fs.readFileSync(path.join(root, 'fresh', 'sub', 'new.md'), 'utf8')).toBe('hi')
  })

  it('leaves outside symlinks out of the tree and reports them once', () => {
    const paths: string[] = []
    const collect = (nodes: ReturnType<typeof vaultFs.listTree>): void => {
      for (const n of nodes) {
        paths.push(n.path)
        if (n.children) collect(n.children)
      }
    }
    collect(vaultFs.listTree())
    expect(paths).not.toContain('pw.md')
    expect(paths).not.toContain('notes/linked')
    expect(vaultFs.takeOutsideLinks().sort()).toEqual(['dangling.md', 'notes/linked', 'pw.md'])
    vaultFs.listTree()
    expect(vaultFs.takeOutsideLinks()).toEqual([])
  })
})

describe('the index and symlinks', () => {
  it('never indexes a note through an outside symlink', async () => {
    indexDb.open(root, path.join(root, '.recto', 'index.db'))
    await indexer.reindex(true)
    const indexed = (indexDb.requireDb().prepare('SELECT path FROM notes').all() as { path: string }[]).map((r) => r.path)
    expect(indexed).toContain('plain.md')
    expect(indexed.some((p) => p.startsWith('notes/linked') || p === 'pw.md')).toBe(false)
    // What the watcher's note-changed path reads through.
    expect(() => indexer.notePath('pw.md')).toThrow(/outside the vault/)
    expect(() => indexer.notePath('notes/linked/id_rsa.md')).toThrow(/outside the vault/)
    expect(indexer.notePath('inside.md')).toBe(path.join(root, 'inside.md'))
  })
})

describe('bot retrieval and symlinks', () => {
  it('read_note cannot read a note through an outside symlink', async () => {
    const note = { path: 'pw.md', title: 'pw', mtime: 0, size: 0, noteDate: null, linksOut: 0, linksIn: 0, properties: {} }
    const context = {
      catalog: [note],
      vaultNotes: [{ path: 'pw.md', title: 'pw', aliases: [] }],
      budget: 10_000,
    } as unknown as Parameters<typeof runTool>[2]
    const result = await runTool('read_note', { title: 'pw' }, context)
    expect(result.text).not.toContain('root:x')
    expect(result.text).toMatch(/could not be read/)
  })
})
