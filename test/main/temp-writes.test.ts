import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Atomic writes go through a temp file the watcher must skip. Only that temp
 * file: the watcher used to skip any name containing ".tmp-", so a note called
 * `notes.tmp-ideas.md` never reached the tree or the index.
 */

let root = ''
vi.mock('electron', () => ({ shell: {}, app: { on: () => undefined, getPath: () => os.tmpdir() } }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))

const vaultFs = await import('../../src/main/vault-fs')

describe('temp files of atomic writes', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-temp-writes-'))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('the temp file a write goes through is one the watcher skips, and nothing is left behind', async () => {
    const rename = vi.spyOn(fsp, 'rename')
    await vaultFs.writeFile('Note.md', '# Note\n')
    const temp = path.basename(String(rename.mock.calls[0]![0]))
    expect(vaultFs.isTempWrite(temp)).toBe(true)
    expect(fs.readdirSync(root)).toEqual(['Note.md'])
  })

  it('a note whose name merely contains ".tmp-" is not a temp file', () => {
    expect(vaultFs.isTempWrite('notes.tmp-ideas.md')).toBe(false)
    expect(vaultFs.isTempWrite('Plan.tmp-draft')).toBe(false)
    expect(vaultFs.isTempWrite('Note.md.tmp-123-4')).toBe(true)
  })
})
