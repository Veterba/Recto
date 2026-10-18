import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDb, open, requireDb } from '../../../src/workers/indexer/db'
import { resolveAllLinks, writeNote } from '../../../src/workers/indexer/index'
import { boards, cardPlaces, cards, graph } from '../../../src/workers/indexer/queries'

/** Boards as notes out of a real index: the boards, where each card stands, card fields, and the graph's board edges. */

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
  resolveAllLinks()
}

const launch = [
  '---',
  'kanban-plugin: board',
  '---',
  '',
  '## To do',
  '',
  '- [ ] [[Ship it]]',
  '- [ ] Buy stamps',
  '',
  '## Doing (2)',
  '',
  '- [ ] [[Both]]',
  '',
  '## Done',
  '',
  '**Complete**',
  '- [x] [[Shipped]]',
  '',
  '***',
  '',
  '## Archive',
  '',
  '- [x] [[Archived]]',
].join('\n')

describe('board cards from the index', () => {
  it('reads every card field from the note a link names', () => {
    vault({
      'tasks/Ship it.md': [
        '---',
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
    })
    expect(cards(['Ship it', 'Nobody'])).toEqual({
      'Ship it': {
        path: 'tasks/Ship it.md',
        title: 'Ship it',
        priority: 'High',
        start: '2026-10-12',
        due: '2026-10-16T09:00',
        completed: '2026-10-15',
        tags: '[ui, "#docs"]',
        description: 'Glass columns and the panel.',
        checklist: { done: 1, total: 3 },
        links: 2,
      },
      Nobody: null,
    })
  })

  it('lists board notes, and where each card stands; archived and plain-text cards are not notes on it', () => {
    vault({
      'tasks/Launch.md': launch,
      'tasks/Later.md': '---\nkanban-plugin: basic\n---\n\n## Someday\n\n- [ ] [[Both]]\n',
      'tasks/Ship it.md': '# Ship it',
      'tasks/Both.md': '# Both',
      'tasks/Shipped.md': '# Shipped',
      'tasks/Archived.md': '# Archived',
      'Plain.md': '# Plain\n\n## To do\n\n- [ ] [[Ship it]]',
    })
    expect(boards()).toEqual([
      { path: 'tasks/Later.md', name: 'Later', cards: 1 },
      { path: 'tasks/Launch.md', name: 'Launch', cards: 4 },
    ])
    expect(cardPlaces()).toEqual([
      { path: 'tasks/Both.md', board: 'tasks/Later.md', lane: 'Someday', stage: 'open' },
      { path: 'tasks/Ship it.md', board: 'tasks/Launch.md', lane: 'To do', stage: 'open' },
      { path: 'tasks/Both.md', board: 'tasks/Launch.md', lane: 'Doing', stage: 'doing' },
      { path: 'tasks/Shipped.md', board: 'tasks/Launch.md', lane: 'Done', stage: 'done' },
    ])
  })

  it('a card created after its board resolves once it exists', () => {
    vault({ 'tasks/Launch.md': launch })
    expect(cardPlaces()).toEqual([])
    requireDb().transaction(() => writeNote('tasks/Ship it.md', '# Ship it', 1, 9))()
    resolveAllLinks()
    expect(cardPlaces().map((p) => p.path)).toEqual(['tasks/Ship it.md'])
  })

  it('marks boards and cards in the graph, and the line that puts a card on its board', () => {
    vault({
      'tasks/Launch.md': launch,
      'tasks/Later.md': '---\nkanban-plugin: board\n---\n\n## Someday\n\n- [ ] [[Both]]\n',
      'tasks/Ship it.md': '---\ndue: 2026-10-20\n---\n# Ship it\n\nSee [[Notes]].',
      'tasks/Both.md': '# Both',
      'tasks/Shipped.md': '# Shipped',
      'Notes.md': 'About [[Launch]].',
    })
    const g = graph(null)
    const node = (p: string) => g.nodes.find((n) => n.path === p)!
    expect(node('tasks/Launch.md')).toMatchObject({ board: true })
    expect(node('tasks/Ship it.md')).toMatchObject({ stage: 'open', due: '2026-10-20', lane: 'To do' })
    expect(node('tasks/Both.md')).toMatchObject({ stage: 'mixed' })
    expect(node('tasks/Shipped.md')).toMatchObject({ stage: 'done' })
    expect(node('Notes.md').board).toBeUndefined()
    const edge = (a: string, b: string) => g.edges.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a))!
    expect(edge('tasks/Launch.md', 'tasks/Ship it.md').member).toBe(true)
    // A link anyone wrote stays a link.
    expect(edge('Notes.md', 'tasks/Launch.md').member).toBeFalsy()
    expect(edge('tasks/Ship it.md', 'Notes.md').member).toBeFalsy()
  })
})
