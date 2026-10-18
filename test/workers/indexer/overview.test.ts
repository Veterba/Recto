import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDb, open, requireDb } from '../../../src/workers/indexer/db'
import { resolveAllLinks, writeNote } from '../../../src/workers/indexer/index'
import { overview } from '../../../src/workers/indexer/queries'

/** The vault overview's figures out of a real index: totals, orphans, broken links, overdue cards, on this day. */

const dirs: string[] = []
afterEach(() => {
  closeDb()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function vault(notes: Record<string, string>): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-overview-'))
  dirs.push(root)
  open(root, path.join(root, '.recto', 'index.db'))
  const db = requireDb()
  for (const [relative, content] of Object.entries(notes)) db.transaction(() => writeNote(relative, content, 1, content.length))()
  resolveAllLinks()
}

describe('vault overview from the index', () => {
  it('finds notes with no links either way, and links to notes that are not there', () => {
    vault({
      'Hub.md': '# Hub\n\nSee [[Leaf]] and [[Missing]].',
      'Leaf.md': '# Leaf\n\nNothing out.',
      'Alone.md': '# Alone\n\nOnly [[Alone]] itself, and [[Nowhere]].',
      'Island.md': '# Island\n\nNo links at all.',
      'tasks/Card.md': '# Card',
      'Main.md': '---\nkanban-plugin: board\n---\n\n## To do\n\n- [ ] [[Card]]\n',
    })
    const o = overview([])
    // A link to itself or to nothing is no link; a card is a task, not a note, and a board is neither.
    expect(o.orphans.map((n) => n.path)).toEqual(['Alone.md', 'Island.md'])
    expect(o.broken.map((b) => `${b.path} -> ${b.target}`)).toEqual(['Alone.md -> Nowhere', 'Hub.md -> Missing'])
    expect(o.hubs).toEqual([
      { path: 'Hub.md', name: 'Hub', links: 1 },
      { path: 'Leaf.md', name: 'Leaf', links: 1 },
    ])
    expect(o.linked.map((n) => n.path)).toEqual(['Hub.md', 'Leaf.md'])
  })

  it('counts notes, words, links and tags', () => {
    vault({
      'A.md': '---\nstatus: draft\n---\n# A\n\nOne two three #x [[B]]',
      'B.md': '# B\n\nfour #y #x',
    })
    // Frontmatter is not words; a heading, a tag and a link's text are.
    expect(overview([])).toMatchObject({ notes: 2, words: 6 + 4, links: 1, tags: 2 })
  })

  it('lists cards with a due date, done when their board has them in its done lane', () => {
    vault({
      'tasks/Late.md': '---\ndue: 2026-10-01T09:00\n---\n',
      'tasks/Finished.md': '---\ndue: 2026-09-01\n---\n',
      'tasks/Undated.md': '# Undated',
      'Plain note.md': '---\ndue: 2026-10-01\n---\n# Not a card\n',
      'tasks/Main.md':
        '---\nkanban-plugin: board\n---\n\n## To do\n\n- [ ] [[Undated]]\n\n## Doing\n\n- [ ] [[Late]]\n\n## Done\n\n**Complete**\n- [x] [[Finished]]\n',
    })
    expect(overview([]).dueCards).toEqual([
      { path: 'tasks/Finished.md', name: 'Finished', due: '2026-09-01', done: true, board: 'Main' },
      { path: 'tasks/Late.md', name: 'Late', due: '2026-10-01', done: false, board: 'Main' },
    ])
  })

  it('on this day reads the date a note gives itself, never its mtime', () => {
    vault({
      'Daily/2026-09-18.md': '# Then',
      'Essay.md': '---\ncreated: 2025-10-18\n---\n# Essay',
      'Undated.md': '# Undated',
    })
    expect(overview(['2026-09-18', '2025-10-18']).written.map((n) => [n.path, n.date])).toEqual([
      ['Daily/2026-09-18.md', '2026-09-18'],
      ['Essay.md', '2025-10-18'],
    ])
  })
})
