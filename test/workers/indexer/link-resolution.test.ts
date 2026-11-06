import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDb, open, requireDb } from '../../../src/workers/indexer/db'
import { resolveAllLinks, writeNote } from '../../../src/workers/indexer/index'
import { backlinks, overview, resolveOne } from '../../../src/workers/indexer/queries'

/**
 * The index resolves each link from the note it is in, as Obsidian does
 * (docs/dev/obsidian-link-rules.md): the same `[[Idea]]` means a different
 * Idea in another folder, and a tie is broken by when each note was made.
 */

const dirs: string[] = []
afterEach(() => {
  closeDb()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** Notes written in this order, each made a moment after the one before. */
function vault(notes: Record<string, string>): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-links-'))
  dirs.push(root)
  open(root, path.join(root, '.recto', 'index.db'))
  const db = requireDb()
  let made = 0
  for (const [relative, content] of Object.entries(notes)) db.transaction(() => writeNote(relative, content, 1, content.length, ++made))()
  resolveAllLinks()
}

const targetOf = (source: string): (string | null)[] =>
  (requireDb().prepare('SELECT target_path FROM links WHERE source_path = ? ORDER BY line').all(source) as { target_path: string | null }[]).map(
    (r) => r.target_path,
  )

describe('links in the index', () => {
  it('a bare name means the note in the linking note’s folder or below first', () => {
    vault({
      'B/Idea.md': '# B idea',
      'A/Idea.md': '# A idea',
      'A/From A.md': '[[Idea]]',
      'B/From B.md': '[[Idea]]',
      'A/sub/From sub.md': '[[Idea]]',
    })
    expect(targetOf('A/From A.md')).toEqual(['A/Idea.md'])
    expect(targetOf('B/From B.md')).toEqual(['B/Idea.md'])
    // Neither is inside A/sub: the shorter path, then the one made first.
    expect(targetOf('A/sub/From sub.md')).toEqual(['B/Idea.md'])
  })

  it('a note at the top takes a bare name everywhere, from any folder; a path, ./ or ../ picks one', () => {
    vault({
      'A/Idea.md': '# A idea',
      'Idea.md': '# Top idea',
      'A/From A.md': '[[Idea]]\n[[A/Idea]]\n[[./Idea]]\n[[../Idea]]\n[[/Idea]]',
    })
    expect(targetOf('A/From A.md')).toEqual(['Idea.md', 'A/Idea.md', 'A/Idea.md', 'Idea.md', 'Idea.md'])
  })

  it('backlinks follow what each link means, not its text', () => {
    vault({
      'A/Idea.md': '# A idea',
      'B/Idea.md': '# B idea',
      'A/Note.md': '[[Idea]]',
      'B/Note.md': '[[Idea]]',
    })
    expect(backlinks('A/Idea.md').map((l) => l.path)).toEqual(['A/Note.md'])
    expect(backlinks('B/Idea.md').map((l) => l.path)).toEqual(['B/Note.md'])
  })

  it('a link clicked is read from the note it is in; from none, from the vault’s top', () => {
    vault({
      'B/Idea.md': '# B idea',
      'A/Idea.md': '# A idea',
    })
    expect(resolveOne('Idea', 'A/Note.md')).toBe('A/Idea.md')
    expect(resolveOne('Idea', 'B/Note.md')).toBe('B/Idea.md')
    // Equally near and long: the one made first.
    expect(resolveOne('Idea', '')).toBe('B/Idea.md')
  })

  it('a link only the files’ dates decide is marked, and listed in the overview', () => {
    vault({
      'B/Idea.md': '# B idea',
      'A/Idea.md': '# A idea',
      'A/sub/From sub.md': '[[Idea]]',
      'A/From A.md': '[[Idea]]',
    })
    const flags = requireDb().prepare('SELECT source_path, by_date FROM links ORDER BY source_path').all()
    // From A, its own folder decides; from A/sub, neither is nearer and both are as long.
    expect(flags).toEqual([
      { source_path: 'A/From A.md', by_date: 0 },
      { source_path: 'A/sub/From sub.md', by_date: 1 },
    ])
    expect(overview([]).byDate).toEqual([{ path: 'A/sub/From sub.md', name: 'From sub', target: 'Idea', opens: 'B/Idea.md' }])
  })
})
