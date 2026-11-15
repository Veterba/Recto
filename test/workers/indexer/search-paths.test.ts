import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDb, open, requireDb } from '../../../src/workers/indexer/db'
import { writeNote } from '../../../src/workers/indexer/index'
import { search } from '../../../src/workers/indexer/queries'

/** Search limited to some notes: the limit counts only them, so a folder's notes are found past the vault's best hits. Real SQLite. */

let root = ''
afterEach(() => {
  closeDb()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('search within some notes', () => {
  it('finds the allowed notes even when many better hits elsewhere come first', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-search-paths-'))
    open(root, path.join(root, '.recto', 'index.db'))
    const db = requireDb()
    const notes: Record<string, string> = { 'Garden/Basil.md': '# Basil\n\nWater once.' }
    for (let i = 0; i < 30; i++) notes[`Elsewhere/Water ${i}.md`] = `# Water ${i}\n\nWater water water.`
    for (const [p, text] of Object.entries(notes)) db.transaction(() => writeNote(p, text, 1, text.length))()
    expect(search('water', 5).map((h) => h.path)).not.toContain('Garden/Basil.md')
    expect(search('water', 5, ['Garden/Basil.md']).map((h) => h.path)).toEqual(['Garden/Basil.md'])
    expect(search('water', 5, [])).toEqual([])
  })
})
