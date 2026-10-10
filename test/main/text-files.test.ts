import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Files that are not notes: the code editor gets their text, with the size
 * limits applied in main; the index - and so the bots, which read only what
 * the index lists - never sees them.
 */

let root = ''
vi.mock('electron', () => ({ shell: {}, app: { on: () => undefined, getPath: () => os.tmpdir() } }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))

const vaultFs = await import('../../src/main/vault-fs')
const indexer = await import('../../src/workers/indexer/index')
const indexDb = await import('../../src/workers/indexer/db')

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-files-'))
  fs.writeFileSync(path.join(root, 'data.json'), '{"a": [1, 2]}\n')
  fs.writeFileSync(path.join(root, 'tool.ts'), 'export const x = 1 // [[Note]] #tag\n')
  fs.writeFileSync(path.join(root, 'rows.jsonl'), '{"a":1}\n{"a":2}\n')
  fs.writeFileSync(path.join(root, 'Note.md'), '# Note\n\nSee [[Other]] #tag\n')
  fs.writeFileSync(path.join(root, 'shot.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]))
  fs.writeFileSync(path.join(root, 'big.log'), 'x'.repeat(6 * 1024 * 1024))
})
afterAll(() => {
  indexDb.closeDb()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('reading a file that is not a note', () => {
  it('gives the text of a json or ts file, editable', async () => {
    expect(await vaultFs.readText('data.json')).toEqual({ ok: true, content: '{"a": [1, 2]}\n', size: 14, readOnly: false })
    expect((await vaultFs.readText('tool.ts')).ok).toBe(true)
  })

  it('saves it back like a note', async () => {
    expect(await vaultFs.writeFile('data.json', '{\n  "a": [1, 2]\n}\n')).toEqual({ ok: true })
    expect(fs.readFileSync(path.join(root, 'data.json'), 'utf8')).toBe('{\n  "a": [1, 2]\n}\n')
  })

  it('opens a file over 5 MB read-only', async () => {
    const result = await vaultFs.readText('big.log')
    expect(result.ok && result.readOnly).toBe(true)
  })

  it('refuses a file over 50 MB without reading it', async () => {
    const huge = path.join(root, 'huge.log')
    fs.writeFileSync(huge, '')
    fs.truncateSync(huge, 51 * 1024 * 1024)
    expect(await vaultFs.readText('huge.log')).toMatchObject({ ok: false, reason: 'too-large' })
    fs.rmSync(huge)
  })

  it('says binary for binary bytes, whatever the name', async () => {
    expect(await vaultFs.readText('shot.bin')).toMatchObject({ ok: false, reason: 'binary' })
  })
})

describe('the index and files that are not notes', () => {
  it('indexes only the note: no rows, links or tags from json, jsonl or ts', async () => {
    indexDb.open(root, path.join(root, '.recto', 'index.db'))
    await indexer.reindex(true)
    const db = indexDb.requireDb()
    expect((db.prepare('SELECT path FROM notes').all() as { path: string }[]).map((r) => r.path)).toEqual(['Note.md'])
    expect((db.prepare('SELECT DISTINCT source_path FROM links').all() as { source_path: string }[]).map((r) => r.source_path)).toEqual([
      'Note.md',
    ])
    expect((db.prepare('SELECT DISTINCT path FROM tags').all() as { path: string }[]).map((r) => r.path)).toEqual(['Note.md'])
  })
})
