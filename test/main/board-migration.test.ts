import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateBoards, MIGRATION_RECORD } from '../../src/main/board-migration'
import { LAYOUT_RECORD, migrateLayout } from '../../src/main/layout-migration'
import { planMigration } from '../../src/shared/board-migration'
import { parseKanban, rectoSettings } from '../../src/shared/kanban'

/** boards.json and frontmatter cards becoming board notes: on a copy of the fixture vault, and the edge cases by themselves. */

const FIXTURE = path.resolve(__dirname, '../fixtures/snapshot-vault')
/** The fixture's boards and cards as the app before boards were notes wrote them: boards.json and frontmatter. */
const BEFORE = path.resolve(__dirname, '../fixtures/boards-before-0.52')
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** A copy of the fixture vault as it was before boards were notes. */
function copy(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-boards-'))
  dirs.push(base)
  const vault = path.join(base, 'vault')
  fs.cpSync(FIXTURE, vault, { recursive: true })
  // The fixture is in today's layout; before boards were notes, the cards were in tasks/ (from BEFORE).
  fs.rmSync(path.join(vault, 'Recto'), { recursive: true, force: true })
  fs.cpSync(BEFORE, vault, { recursive: true })
  return vault
}

/** Every file under a folder with its content, for "nothing changed". */
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else out[path.relative(root, full)] = fs.readFileSync(full, 'utf8')
    }
  }
  walk(root)
  return out
}

const read = (vault: string, rel: string): string => fs.readFileSync(path.join(vault, rel), 'utf8')

describe('the boards migration on the fixture vault', () => {
  it('writes the board note, strips the cards, backs everything up first, and runs once', () => {
    // The fixture's board is what the boards migration writes, new-note-folder and all.
    const vaultBoard = fs.readFileSync(path.join(FIXTURE, 'Recto/Boards/Launch/Launch.md'), 'utf8')
    const BOARD = 'Recto/Boards/Launch/Launch.md'
    const vault = copy()
    const before = tree(vault)
    const now = new Date(2026, 9, 18, 12)
    const result = migrateBoards(vault, {}, now)
    expect(result.state).toBe('migrated')
    if (result.state !== 'migrated') return

    // The board: its lanes in order, cards by their old order, Done ticked and marked Complete.
    const board = parseKanban(read(vault, BOARD))
    expect(board.lanes.map((l) => [l.title, l.wip, l.complete])).toEqual([
      ['To do', null, false],
      ['Doing', 1, false],
      ['Done', null, true],
    ])
    const lanes = board.lanes.map((l) => l.items.map((i) => [i.link, i.checked]))
    expect(lanes[2]!.every(([, checked]) => checked === true)).toBe(true)
    expect(lanes.flat().map(([link]) => link).sort()).toEqual(
      fs
        .readdirSync(path.join(vault, 'tasks'))
        .map((f) => f.replace(/\.md$/, ''))
        .sort(),
    )
    // Lane colours and dates, and what Obsidian should show, in the settings block.
    expect(rectoSettings(board)).toMatchObject({
      migratedFrom: 'launch',
      lanes: { 'To do': { color: 'blue', start: '2026-09-16', due: '2026-09-22' }, Doing: { color: 'orange' }, Done: { color: 'green' } },
    })
    expect((board.settings['metadata-keys'] as { metadataKey: string }[]).map((k) => k.metadataKey)).toEqual(['priority', 'due'])

    // Cards keep everything but board, status and order.
    for (const file of fs.readdirSync(path.join(vault, 'tasks'))) {
      const text = read(vault, `tasks/${file}`)
      expect(text).not.toMatch(/^(board|status|order):/m)
      const old = before[`tasks/${file}`]!
      expect(text).toBe(
        old
          .split('\n')
          .filter((l) => !/^(board|status|order):/.test(l))
          .join('\n'),
      )
    }

    // Backed up at their own paths, boards.json too, and then boards.json is gone.
    expect(result.backup).toBe('.recto/backup/2026-10-18')
    for (const rel of [...fs.readdirSync(path.join(vault, 'tasks')).map((f) => `tasks/${f}`), '.recto/boards.json'])
      expect(read(vault, `${result.backup}/${rel}`)).toBe(before[rel])
    expect(fs.existsSync(path.join(vault, '.recto/boards.json'))).toBe(false)
    expect(JSON.parse(read(vault, MIGRATION_RECORD))).toMatchObject({ state: 'migrated', boards: [{ name: 'Launch', path: BOARD }] })

    // The fixture vault's own board is this run's output.
    expect(read(vault, BOARD)).toBe(vaultBoard)

    // Twice changes nothing.
    const after = tree(vault)
    expect(migrateBoards(vault, {}, now)).toEqual({ state: 'none' })
    expect(tree(vault)).toEqual(after)
  })

  it('does not run again for a note that has a `board:` key of its own', () => {
    const vault = copy()
    expect(migrateBoards(vault).state).toBe('migrated')
    const own = '---\nboard: Marketing\nstatus: draft\n---\n# Campaign\n'
    fs.writeFileSync(path.join(vault, 'Campaign.md'), own)
    expect(migrateBoards(vault)).toEqual({ state: 'none' })
    expect(read(vault, 'Campaign.md')).toBe(own)
    expect(fs.existsSync(path.join(vault, 'tasks/Main.md'))).toBe(false)
  })

  it('a vault with nothing to move is marked done on its first open', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-boards-'))
    dirs.push(base)
    fs.writeFileSync(path.join(base, 'A.md'), '# A')
    expect(migrateBoards(base)).toEqual({ state: 'none' })
    expect(JSON.parse(read(base, MIGRATION_RECORD))).toEqual({ state: 'none' })
    fs.writeFileSync(path.join(base, 'B.md'), '---\nboard: x\n---\n')
    expect(migrateBoards(base)).toEqual({ state: 'none' })
    expect(read(base, 'B.md')).toBe('---\nboard: x\n---\n')
  })

  it('asks for another name when a note has the board\'s, and writes nothing until then', () => {
    const vault = copy()
    fs.writeFileSync(path.join(vault, 'Launch.md'), '# Launch\n')
    const before = tree(vault)
    expect(migrateBoards(vault)).toEqual({ state: 'conflicts', conflicts: [{ id: 'launch', name: 'Launch' }] })
    expect(tree(vault)).toEqual(before)
    const result = migrateBoards(vault, { launch: 'Launch board' })
    expect(result.state).toBe('migrated')
    expect(fs.existsSync(path.join(vault, 'Recto/Boards/Launch board/Launch board.md'))).toBe(true)
  })
})

describe('no tasks/ folder in the root, ever', () => {
  /** A vault in today's layout: both migrations ran in it long ago. */
  function today(): string {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-boards-'))
    dirs.push(base)
    fs.cpSync(FIXTURE, base, { recursive: true })
    fs.mkdirSync(path.join(base, '.recto'), { recursive: true })
    fs.writeFileSync(path.join(base, LAYOUT_RECORD), '{"state":"none"}\n')
    return base
  }
  const card = '---\nboard: main\nstatus: doing\n---\nA note of the old kind.\n'

  it("its record lost, a note with an old board: key makes the board in Recto/Boards - where the layout migration, long done, never looks", () => {
    const vault = today()
    fs.mkdirSync(path.join(vault, 'Daily'))
    fs.writeFileSync(path.join(vault, 'Daily/x.md'), card)
    expect(migrateBoards(vault).state).toBe('migrated')
    expect(migrateLayout(vault)).toEqual({ state: 'none' })
    expect(fs.existsSync(path.join(vault, 'tasks'))).toBe(false)
    expect(parseKanban(read(vault, 'Recto/Boards/Main/Main.md')).settings['new-note-folder']).toBe('Recto/Boards/Main')
  })

  it('boards.json come back from an old copy: the same, in Recto/Boards', () => {
    const vault = today()
    fs.writeFileSync(path.join(vault, MIGRATION_RECORD), '{"state":"none"}\n')
    fs.writeFileSync(path.join(vault, '.recto/boards.json'), JSON.stringify({ boards: [{ id: 'side', name: 'Side', columns: [{ id: 'a', name: 'A' }] }] }))
    expect(migrateBoards(vault).state).toBe('migrated')
    expect(fs.existsSync(path.join(vault, 'tasks'))).toBe(false)
    expect(fs.existsSync(path.join(vault, 'Recto/Boards/Side/Side.md'))).toBe(true)
  })

  it("a record iCloud moved aside ('boards-migration 2.json') still counts: nothing runs, the note keeps its keys", () => {
    const vault = today()
    fs.writeFileSync(path.join(vault, '.recto/boards-migration 2.json'), '{"state":"none"}\n')
    fs.writeFileSync(path.join(vault, 'x.md'), card)
    expect(migrateBoards(vault)).toEqual({ state: 'none' })
    expect(read(vault, 'x.md')).toBe(card)
    // The layout record the same way: an old tasks/ folder of the person's own is left where it is.
    fs.rmSync(path.join(vault, LAYOUT_RECORD))
    fs.writeFileSync(path.join(vault, '.recto/layout-migration 2.json'), '{"state":"none"}\n')
    fs.mkdirSync(path.join(vault, 'tasks'))
    fs.writeFileSync(path.join(vault, 'tasks/Mine.md'), '# Mine\n')
    expect(migrateLayout(vault)).toEqual({ state: 'none' })
    expect(fs.existsSync(path.join(vault, 'tasks/Mine.md'))).toBe(true)
  })

  it('a vault from before boards were notes: both migrations in one open leave the cards beside their board', () => {
    const vault = copy()
    expect(migrateBoards(vault).state).toBe('migrated')
    expect(migrateLayout(vault).state).toBe('migrated')
    expect(fs.existsSync(path.join(vault, 'tasks'))).toBe(false)
    const board = parseKanban(read(vault, 'Recto/Boards/Launch/Launch.md'))
    for (const link of board.lanes.flatMap((l) => l.items.map((i) => i.link)))
      expect(fs.existsSync(path.join(vault, `Recto/Boards/Launch/${link}.md`))).toBe(true)
  })
})

describe('planning the migration', () => {
  const boardsJson = {
    boards: [
      { id: 'main', name: 'Main', columns: [{ id: 'todo', name: 'To do' }, { id: 'done', name: 'Done' }] },
      { id: 'side', name: 'Side', columns: [{ id: 'a', name: 'A' }] },
    ],
  }
  const card = (board: string, status: string | null, order?: number): string =>
    `---\nboard: ${board}\n${status === null ? '' : `status: ${status}\n`}${order === undefined ? '' : `order: ${order}\n`}priority: high\n---\n\nBody.\n`

  it('orders cards by their old order, unknown statuses in their own lane, lost boards onto the first', () => {
    const plan = planMigration(boardsJson, [
      { path: 'tasks/B.md', text: card('main', 'todo', 2) },
      { path: 'tasks/A.md', text: card('main', 'todo', 1) },
      { path: 'tasks/Unordered.md', text: card('main', 'todo') },
      { path: 'tasks/New.md', text: card('main', null) },
      { path: 'tasks/Lost.md', text: card('main', 'shipped-maybe') },
      { path: 'tasks/Orphan.md', text: card('gone', 'todo', 5) },
      { path: 'Note.md', text: '---\nstatus: draft\n---\nNot a card.' },
    ])
    expect(plan.conflicts).toEqual([])
    const main = parseKanban(plan.creates.find((c) => c.board === 'main')!.text)
    expect(main.lanes.map((l) => [l.title, l.items.map((i) => i.link)])).toEqual([
      ['To do', ['A', 'B', 'Orphan', 'New', 'Unordered']],
      ['Done', []],
      ['Unknown status', ['Lost']],
    ])
    // Each board in its own folder in Recto/Boards, never the old flat tasks/.
    expect(plan.creates.find((c) => c.board === 'side')!.path).toBe('Recto/Boards/Side/Side.md')
    // A note with `status` but no board is not a card, and is not touched.
    expect(plan.edits.map((e) => e.path)).not.toContain('Note.md')
    expect(plan.edits.find((e) => e.path === 'tasks/A.md')!.after).toBe('---\npriority: high\n---\n\nBody.\n')
  })

  it('links a card by its path when another note shares its name', () => {
    const plan = planMigration(boardsJson, [
      { path: 'tasks/Plan.md', text: card('main', 'todo') },
      { path: 'Work/Plan.md', text: '# Plan' },
    ])
    expect(parseKanban(plan.creates[0]!.text).lanes[0]!.items[0]!.link).toBe('tasks/Plan')
  })

  it('nothing to do in a vault that never had boards', () => {
    expect(planMigration(undefined, [{ path: 'A.md', text: '# A' }]).done).toBe(true)
  })

  it('a card left behind by an interrupted run is added to the board made before', () => {
    const first = planMigration(boardsJson, [{ path: 'tasks/A.md', text: card('main', 'todo', 1) }])
    const made = first.creates.map((c) => ({ path: c.path, text: c.text }))
    const again = planMigration(boardsJson, [...made, { path: 'tasks/A.md', text: card('main', 'todo', 1) }, { path: 'tasks/Late.md', text: card('main', 'done') }])
    expect(again.creates).toEqual([])
    const main = again.edits.find((e) => e.path === 'Recto/Boards/Main/Main.md')!
    expect(parseKanban(main.after).lanes.map((l) => l.items.map((i) => [i.link, i.checked]))).toEqual([[['A', false]], [['Late', true]]])
  })
})
