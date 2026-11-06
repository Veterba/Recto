import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { boardText, parseKanban } from '../../src/shared/kanban'
import { LAYOUT_RECORD, migrateLayout, planLayout, type LayoutFile } from '../../src/main/layout-migration'

/**
 * tasks/ and chats/ into Recto/, once: boards to their own folders, cards
 * beside their board (the first by name when several list them), cards on no
 * board to Unsorted, chats to Recto/Chats. Links by name keep working as they
 * are; only a link that would end up at another file, or that spells out a
 * path that is gone, is rewritten. Run on real files in a temp folder.
 */

const board = (cards: string[], settings: Record<string, unknown> = {}): string =>
  boardText([{ title: 'To do', items: cards.map((text) => ({ text })) }], settings)

const A = board(['[[Shared]]', '[[Only A]]', '[[Basil]]'], { 'metadata-keys': [{ metadataKey: 'due' }], recto: { sort: 'due' } })
const B = board(['[[Shared]]'])

const FILES: LayoutFile[] = [
  { path: 'tasks/A.md', text: A },
  { path: 'tasks/B.md', text: B },
  { path: 'tasks/Shared.md', text: 'On two boards.\n' },
  { path: 'tasks/Only A.md', text: '' },
  { path: 'tasks/Loose.md', text: 'On no board.\n' },
  { path: 'tasks/pics/x.png' },
  { path: 'Garden/Basil.md', text: 'Outside Recto.\n' },
  { path: 'chats/recto/2026-10-01 10-00 — Pricing.md', text: 'Talked about [[Basil]].\n' },
  { path: 'Notes/Plan.md', text: 'See [[Shared]], [[tasks/Loose]] and [x](tasks/Only%20A.md).\n' },
]

const moveOf = (plan: ReturnType<typeof planLayout>, from: string): string | undefined => plan.moves.find((m) => m.from === from)?.to

describe('planLayout', () => {
  const plan = planLayout(FILES)

  it('moves each board into its own folder', () => {
    expect(moveOf(plan, 'tasks/A.md')).toBe('Recto/Boards/A/A.md')
    expect(moveOf(plan, 'tasks/B.md')).toBe('Recto/Boards/B/B.md')
  })

  it('a card on one board goes beside it; on two, beside the first by name', () => {
    expect(moveOf(plan, 'tasks/Only A.md')).toBe('Recto/Boards/A/Only A.md')
    expect(moveOf(plan, 'tasks/Shared.md')).toBe('Recto/Boards/A/Shared.md')
  })

  it('a card on no board, and anything else in tasks/, goes to Unsorted', () => {
    expect(moveOf(plan, 'tasks/Loose.md')).toBe('Recto/Unsorted/Loose.md')
    expect(moveOf(plan, 'tasks/pics/x.png')).toBe('Recto/Unsorted/pics/x.png')
  })

  it('chats go to Recto/Chats; a note outside tasks/ and chats/ never moves', () => {
    expect(moveOf(plan, 'chats/recto/2026-10-01 10-00 — Pricing.md')).toBe('Recto/Chats/recto/2026-10-01 10-00 — Pricing.md')
    expect(moveOf(plan, 'Garden/Basil.md')).toBeUndefined()
    expect(moveOf(plan, 'Notes/Plan.md')).toBeUndefined()
  })

  it('sets each moved board’s new-note-folder and changes nothing else in its settings or lines', () => {
    const edit = plan.edits.find((e) => e.path === 'Recto/Boards/A/A.md')!
    const before = parseKanban(edit.before)
    const after = parseKanban(edit.after)
    expect(after.settings).toEqual({ ...before.settings, 'new-note-folder': 'Recto/Boards/A' })
    expect(after.lanes.map((l) => l.items.map((i) => i.raw))).toEqual(before.lanes.map((l) => l.items.map((i) => i.raw)))
  })

  it('leaves links by name alone, and rewrites only path links that would no longer find their note', () => {
    const edit = plan.edits.find((e) => e.path === 'Notes/Plan.md')!
    expect(edit.after).toBe('See [[Shared]], [[Loose]] and [x](Recto/Boards/A/Only%20A.md).\n')
    expect(edit.links).toEqual([
      { from: 'tasks/Loose', to: 'Loose' },
      { from: 'tasks/Only A.md', to: 'Recto/Boards/A/Only A.md' },
    ])
    // The chat links by name: untouched.
    expect(plan.edits.some((e) => e.path.startsWith('Recto/Chats/'))).toBe(false)
  })

  it('a [[tasks/X]] link written because another X exists is written again as Obsidian would: the whole path', () => {
    const files: LayoutFile[] = [
      { path: 'tasks/Board.md', text: board(['[[tasks/X]]']) },
      { path: 'tasks/X.md', text: 'the card' },
      { path: 'Elsewhere/X.md', text: 'another X' },
      { path: 'Index.md', text: '[[tasks/X|the card]] and [[X]]\n' },
      { path: 'Other.md', text: '[[Elsewhere/X]]\n' },
    ]
    const p = planLayout(files)
    expect(moveOf(p, 'tasks/X.md')).toBe('Recto/Boards/Board/X.md')
    const index = p.edits.find((e) => e.path === 'Index.md')!
    // `[[X]]` found tasks/X before (the shorter path); after the move Elsewhere/X would win, so it is pinned too.
    expect(index.after).toBe('[[Recto/Boards/Board/X|the card]] and [[Recto/Boards/Board/X]]\n')
    expect(p.edits.find((e) => e.path === 'Recto/Boards/Board/Board.md')!.after).toContain('- [ ] [[Recto/Boards/Board/X]]')
    // A link to the other X never changes.
    expect(p.edits.some((e) => e.path === 'Other.md')).toBe(false)
  })

  it('a bare link still meaning the same note after the move is left as it is; one that would not is pinned', () => {
    const files: LayoutFile[] = [
      { path: 'tasks/Board.md', text: board(['[[X]]']) },
      { path: 'tasks/X.md', text: 'the card' },
      { path: 'Deep/er/X.md', text: 'another X' },
      { path: 'Index.md', text: '[[X]]\n' },
    ]
    const p = planLayout(files)
    // From the board's own folder its card is still nearest.
    expect(p.edits.find((e) => e.path === 'Recto/Boards/Board/Board.md')?.links ?? []).toEqual([])
    // From the vault's top, Deep/er/X.md would now be the shorter path: pinned to the card.
    expect(p.edits.find((e) => e.path === 'Index.md')!.links).toEqual([{ from: 'X', to: 'Recto/Boards/Board/X' }])
  })

  it('writes the README, as README whatever README is elsewhere', () => {
    expect(plan.creates.map((c) => c.path)).toEqual(['Recto/README.md'])
    expect(planLayout([...FILES, { path: 'README.md', text: '' }]).creates.map((c) => c.path)).toEqual(['Recto/README.md'])
  })

  it('stops, writing nothing, when a target is taken', () => {
    const p = planLayout([...FILES, { path: 'Recto/Unsorted/Loose.md', text: 'mine' }])
    expect(p.conflicts).toEqual([{ from: 'tasks/Loose.md', to: 'Recto/Unsorted/Loose.md' }])
    expect(p.moves).toEqual([])
  })
})

describe('migrateLayout', () => {
  let root = ''
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  const make = (files: readonly LayoutFile[]): string => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-layout-'))
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(root, f.path)), { recursive: true })
      fs.writeFileSync(path.join(root, f.path), f.text ?? 'bytes')
    }
    return root
  }
  const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8')

  it('backs up, moves, rewrites, removes the empty old folders and records what it did', () => {
    make(FILES)
    const result = migrateLayout(root, new Date(2026, 9, 31, 12))
    expect(result.state).toBe('migrated')
    if (result.state !== 'migrated') return
    expect(fs.existsSync(path.join(root, 'tasks'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'chats'))).toBe(false)
    expect(read('Recto/Boards/A/Shared.md')).toBe('On two boards.\n')
    expect(read('Recto/README.md')).toMatch(/managed by Recto/)
    expect(read('Notes/Plan.md')).toBe('See [[Shared]], [[Loose]] and [x](Recto/Boards/A/Only%20A.md).\n')
    // The backup has every moved and changed file at its old path, untouched.
    expect(result.backup).toBe('.recto/backup/layout-2026-10-31')
    expect(read('.recto/backup/layout-2026-10-31/tasks/A.md')).toBe(A)
    expect(read('.recto/backup/layout-2026-10-31/Notes/Plan.md')).toBe(FILES.find((f) => f.path === 'Notes/Plan.md')!.text)
    expect(JSON.parse(read(LAYOUT_RECORD)).state).toBe('migrated')
  })

  it('runs once: a second open changes nothing, even with a new tasks/ folder', () => {
    make(FILES)
    migrateLayout(root)
    fs.mkdirSync(path.join(root, 'tasks'))
    fs.writeFileSync(path.join(root, 'tasks/Mine.md'), 'my own folder now')
    expect(migrateLayout(root)).toEqual({ state: 'none' })
    expect(read('tasks/Mine.md')).toBe('my own folder now')
  })

  it('a vault without tasks/ or chats/ only gets its record', () => {
    make([{ path: 'Note.md', text: 'x' }])
    expect(migrateLayout(root)).toEqual({ state: 'none' })
    expect(fs.existsSync(path.join(root, 'Recto'))).toBe(false)
    expect(fs.existsSync(path.join(root, LAYOUT_RECORD))).toBe(true)
  })

  it('a conflict writes nothing and does not record, so it runs again once cleared', () => {
    make([...FILES, { path: 'Recto/Unsorted/Loose.md', text: 'mine' }])
    expect(migrateLayout(root).state).toBe('conflicts')
    expect(read('tasks/Loose.md')).toBe('On no board.\n')
    expect(fs.existsSync(path.join(root, LAYOUT_RECORD))).toBe(false)
  })
})
