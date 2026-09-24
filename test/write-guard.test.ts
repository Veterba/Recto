import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Writing a note's own bytes back must not touch the file. A rewrite of the
 * same content still moves the mtime - which sync reads as an edit, and which
 * restarts the auto-links quiet period on a note nobody changed.
 */

let root = ''
vi.mock('electron', () => ({ shell: {} }))
vi.mock('../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))

const { writeFile } = await import('../src/main/vault-fs')

describe('the write guard', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-guard-'))
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  const OLD = new Date('2026-01-01T00:00:00Z')

  it('leaves bytes and mtime alone when nothing changed', async () => {
    const file = path.join(root, 'note.md')
    // No trailing newline, Cyrillic, frontmatter: the shape of the note that was rewritten.
    const content = '---\ntags: []\nlinks:\n---\n# Слепой набор\n- https://rata-type.com - тренажёр'
    fs.writeFileSync(file, content)
    fs.utimesSync(file, OLD, OLD)
    expect(await writeFile('note.md', content)).toEqual({ ok: true })
    expect(fs.readFileSync(file, 'utf8')).toBe(content)
    expect(fs.statSync(file).mtimeMs).toBe(OLD.getTime())
  })

  it('still writes a real change', async () => {
    const file = path.join(root, 'note.md')
    fs.writeFileSync(file, 'a')
    fs.utimesSync(file, OLD, OLD)
    expect(await writeFile('note.md', 'a\n')).toEqual({ ok: true })
    expect(fs.readFileSync(file, 'utf8')).toBe('a\n')
    expect(fs.statSync(file).mtimeMs).toBeGreaterThan(OLD.getTime())
  })

  it('creates a missing file', async () => {
    expect(await writeFile('new.md', 'x')).toEqual({ ok: true })
    expect(fs.readFileSync(path.join(root, 'new.md'), 'utf8')).toBe('x')
  })
})
