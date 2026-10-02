import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDb, open, requireDb } from '../../../src/workers/indexer/db'
import { writeNote } from '../../../src/workers/indexer/index'
import { search } from '../../../src/workers/indexer/queries'

/**
 * A bot keeps an answer's sources in an HTML comment. Searching for a note's
 * name must find the note, not every bot thread that once cited it - and a
 * link inside a comment is not a link. Real SQLite, real FTS5.
 */

const dirs: string[] = []
afterEach(() => {
  closeDb()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function vault(notes: Record<string, string>): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-comments-'))
  dirs.push(root)
  open(root, path.join(root, '.recto', 'index.db'))
  const db = requireDb()
  for (const [relative, content] of Object.entries(notes)) {
    db.transaction(() => writeNote(relative, content, 1, content.length))()
  }
}

describe('HTML comments in the index', () => {
  it('a bot thread that cited a note in its sources does not come up when searching for that note', () => {
    vault({
      'Garden/Soil.md': '# Soil\n\nCompost, loam and grit.',
      'chats/recto/2026-09-20 10-00-00.md':
        '# Mixing\n\n## You\n\nWhat goes in the mix?\n\n## Recto\n\nCompost, loam and grit.\n\n<!-- recto:sources [{"path":"Garden/Soil.md","heading":null}] -->\n',
    })
    expect(search('Soil', 20).map((hit) => hit.path)).toEqual(['Garden/Soil.md'])
    // The answer's own words are still searchable: only the comment is hidden.
    expect(
      search('loam', 20)
        .map((hit) => hit.path)
        .sort(),
    ).toEqual(['Garden/Soil.md', 'chats/recto/2026-09-20 10-00-00.md'])
  })

  it('a wikilink inside a comment draws no link', () => {
    vault({ 'Ideas.md': '# Ideas\n\n<!-- see [[Basil]] -->\nSee [[Soil]].' })
    const targets = requireDb().prepare('SELECT target_text FROM links WHERE source_path = ?').all('Ideas.md') as { target_text: string }[]
    expect(targets.map((t) => t.target_text)).toEqual(['Soil'])
  })
})
