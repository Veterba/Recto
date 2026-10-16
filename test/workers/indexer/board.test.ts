import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDb, open, requireDb } from '../../../src/workers/indexer/db'
import { writeNote } from '../../../src/workers/indexer/index'
import { board } from '../../../src/workers/indexer/queries'

/** A board's cards out of a real index: frontmatter, description, checklist and links. */

const dirs: string[] = []
afterEach(() => {
  closeDb()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function vault(notes: Record<string, string>): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-board-'))
  dirs.push(root)
  open(root, path.join(root, '.recto', 'index.db'))
  const db = requireDb()
  for (const [relative, content] of Object.entries(notes)) db.transaction(() => writeNote(relative, content, 1, content.length))()
}

describe('board cards from the index', () => {
  it('reads every card field from the note', () => {
    vault({
      'tasks/Ship it.md': [
        '---',
        'board: main',
        'status: todo',
        'order: 2',
        'priority: High',
        'start: 2026-10-12',
        'due: 2026-10-16T09:00',
        'completed: 2026-10-15',
        'tags: [ui, "#docs"]',
        '---',
        '',
        '# Ship it',
        '',
        'Glass **columns** and [[Settings|the panel]].',
        '',
        '- [x] one',
        '- [ ] two',
        '- [ ] three see [[Other]]',
      ].join('\n'),
      'tasks/Elsewhere.md': '---\nboard: other\n---\n# Elsewhere\n',
    })
    const [card, ...rest] = board('main')
    expect(rest).toEqual([])
    expect(card).toEqual({
      path: 'tasks/Ship it.md',
      title: 'Ship it',
      status: 'todo',
      order: 2,
      priority: 'High',
      start: '2026-10-12',
      due: '2026-10-16T09:00',
      completed: '2026-10-15',
      tags: expect.stringContaining('ui'),
      description: 'Glass columns and the panel.',
      checklist: { done: 1, total: 3 },
      links: 2,
    })
  })

  it('a bare card has empty fields, not missing ones', () => {
    vault({ 'tasks/Bare.md': '---\nboard: main\n---\n# Bare\n' })
    expect(board('main')[0]).toMatchObject({
      status: null,
      start: null,
      due: null,
      completed: null,
      priority: null,
      tags: null,
      description: '',
      checklist: { done: 0, total: 0 },
      links: 0,
    })
  })
})
