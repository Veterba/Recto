import { parseFrontmatter, removeField } from './frontmatter'
import { addLane, boardText, insertItem, isKanban, parseKanban, rectoSettings, type NewLane } from './kanban'

/**
 * Once per vault: the boards of `.recto/boards.json` become board notes in the
 * Obsidian Kanban format, and their cards stop carrying where they are.
 *
 * Before, a board was a definition in boards.json and a card was a note with
 * `board`, `status` and `order` in its frontmatter. Now the board note lists
 * its cards, `- [ ] [[Card]]`, lane by lane, in order; a card note keeps only
 * its own fields (priority, dates, tags, completed).
 *
 * Pure: the notes in, what to write out. The runner (main/board-migration.ts)
 * backs up every file it will change first, and writes nothing when a board's
 * name is taken until the person has chosen another.
 */

/** Where migrated boards go: beside their cards, in the folder the Data tree hides. */
export const BOARDS_FOLDER = 'tasks'
/** The lane for cards whose status names no column, at the end of their board. */
export const UNKNOWN_LANE = 'Unknown status'
/** The keys a card no longer carries. */
const OLD_KEYS = ['board', 'status', 'order'] as const

/** Shown on the plugin's cards in Obsidian: priority and due, from each card's frontmatter. */
export const METADATA_KEYS = [
  { metadataKey: 'priority', label: 'Priority', shouldHideLabel: false, containsMarkdown: false },
  { metadataKey: 'due', label: 'Due', shouldHideLabel: false, containsMarkdown: false },
]

type OldColumn = { id: string; name: string; color?: string; wip?: number; start?: string; due?: string; done?: boolean }
type OldBoard = { id: string; name: string; columns: OldColumn[]; widgets?: { shown: boolean; list: string[] } }

/** The board a vault with no boards.json had: what the old app showed. */
const DEFAULT_BOARD: OldBoard = {
  id: 'main',
  name: 'Main',
  columns: [
    { id: 'todo', name: 'To do' },
    { id: 'doing', name: 'Doing' },
    { id: 'done', name: 'Done' },
  ],
}

const ID = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u
const DAY = /^\d{4}-\d{2}-\d{2}$/
const record = (raw: unknown): Record<string, unknown> | null =>
  raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null

/** boards.json, read as the old app read it: defensively, every field maybe missing. */
export function oldBoards(raw: unknown): OldBoard[] {
  const list = record(raw)?.['boards']
  if (!Array.isArray(list)) return [DEFAULT_BOARD]
  const boards: OldBoard[] = []
  for (const entry of list) {
    const b = record(entry)
    if (b === null || typeof b['id'] !== 'string' || !ID.test(b['id']) || boards.some((x) => x.id === b['id'])) continue
    const columns: OldColumn[] = []
    for (const rawColumn of Array.isArray(b['columns']) ? b['columns'] : []) {
      const c = record(rawColumn)
      if (c === null || typeof c['id'] !== 'string' || !ID.test(c['id']) || columns.some((x) => x.id === c['id'])) continue
      const column: OldColumn = { id: c['id'], name: typeof c['name'] === 'string' && c['name'] !== '' ? c['name'] : c['id'] }
      if (typeof c['color'] === 'string') column.color = c['color']
      if (typeof c['wip'] === 'number' && Number.isInteger(c['wip']) && c['wip'] > 0) column.wip = c['wip']
      if (typeof c['start'] === 'string' && DAY.test(c['start'])) column.start = c['start']
      if (typeof c['due'] === 'string' && DAY.test(c['due'])) column.due = c['due']
      if (c['done'] === true) column.done = true
      columns.push(column)
    }
    if (columns.length === 0) continue
    const board: OldBoard = { id: b['id'], name: typeof b['name'] === 'string' && b['name'] !== '' ? b['name'] : b['id'], columns }
    const w = record(b['widgets'])
    if (w !== null) {
      const ids = Array.isArray(w['list']) ? w['list'].filter((x): x is string => typeof x === 'string') : []
      board.widgets = { shown: w['shown'] !== false, list: [...new Set(ids)] }
    }
    boards.push(board)
  }
  return boards.length === 0 ? [DEFAULT_BOARD] : boards
}

/** The old app's done column: the one marked so, else the one called `done`, else the last. */
const doneOf = (columns: readonly OldColumn[]): string =>
  (columns.find((c) => c.done === true) ?? columns.find((c) => c.id === 'done') ?? columns.at(-1)!).id

export type MigrationNote = { path: string; text: string }

/** What a run came to, as main tells the app (and keeps in `.recto/boards-migration.json`). */
export type BoardMigrationResult =
  | { state: 'none' }
  | { state: 'conflicts'; conflicts: { id: string; name: string }[] }
  | { state: 'failed'; error: string }
  | { state: 'migrated'; at: string; backup: string | null; boards: { name: string; path: string; cards: number }[]; cards: number; changed: string[] }

export type MigrationPlan = {
  /** Board notes to write; none of them exists yet. */
  creates: { path: string; text: string; board: string; cards: number }[]
  /** Notes to change: cards losing their old keys, a board gaining a card it was missing. */
  edits: { path: string; before: string; after: string }[]
  /** Boards whose name a note already has: nothing is written until each has another. */
  conflicts: { id: string; name: string }[]
  /** Nothing to do: no old boards, no old cards. */
  done: boolean
}

const stem = (p: string): string => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '')
const lower = (s: string): string => s.normalize('NFC').toLowerCase()

/** A frontmatter value as a string, or null. */
function field(text: string, key: string): string | number | null {
  const value = parseFrontmatter(text).fields.find((f) => f.key === key)?.value
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

/**
 * What the migration would do, from boards.json (`undefined` when there is
 * none) and every note in the vault. `names` are the names chosen for boards
 * whose own was taken.
 */
export function planMigration(boardsJson: unknown, notes: readonly MigrationNote[], names: Readonly<Record<string, string>> = {}): MigrationPlan {
  const cards = notes.filter((n) => n.text.startsWith('---') && field(n.text, 'board') !== null)
  const plan: MigrationPlan = { creates: [], edits: [], conflicts: [], done: false }
  if (boardsJson === undefined && cards.length === 0) return { ...plan, done: true }

  const boards = oldBoards(boardsJson)
  // Boards already made by an earlier run, by the id they came from.
  const made = new Map<string, MigrationNote>()
  for (const note of notes) {
    if (!isKanban(note.text)) continue
    const from = rectoSettings(parseKanban(note.text)).migratedFrom
    if (from !== undefined) made.set(from, note)
  }

  // A link is the card's name, unless another note shares it: then its path.
  const byName = new Map<string, number>()
  for (const note of notes) byName.set(lower(stem(note.path)), (byName.get(lower(stem(note.path))) ?? 0) + 1)
  const linkOf = (p: string): string => ((byName.get(lower(stem(p))) ?? 0) > 1 ? p.replace(/\.md$/i, '') : stem(p))

  // Cards per board; a card whose board is gone goes to the first.
  const of = new Map<string, MigrationNote[]>()
  for (const card of cards) {
    const id = String(field(card.text, 'board'))
    const board = boards.find((b) => b.id === id) ?? boards[0]!
    of.set(board.id, [...(of.get(board.id) ?? []), card])
  }

  const taken = new Set(notes.map((n) => lower(stem(n.path))))
  for (const board of boards) {
    const list = of.get(board.id) ?? []
    const existing = made.get(board.id)
    if (existing !== undefined) {
      // Made before: only cards it does not list yet are added, at the end of their lane.
      let text = existing.text
      for (const card of list) {
        const parsed = parseKanban(text)
        const listed = parsed.lanes.some((lane) => lane.items.some((i) => i.link !== null && lower(i.link) === lower(linkOf(card.path))))
        if (listed) continue
        const status = field(card.text, 'status')
        const column = board.columns.find((c) => c.id === String(status ?? board.columns[0]!.id))
        let lane = parsed.lanes.findIndex((l) => l.title === (column?.name ?? UNKNOWN_LANE))
        if (lane === -1) {
          text = addLane(text, UNKNOWN_LANE)
          lane = parseKanban(text).lanes.length - 1
        }
        const done = column !== undefined && column.id === doneOf(board.columns)
        text = insertItem(text, lane, Number.MAX_SAFE_INTEGER, `[[${linkOf(card.path)}]]`, done)
      }
      if (text !== existing.text) plan.edits.push({ path: existing.path, before: existing.text, after: text })
      continue
    }

    const name = (names[board.id] ?? board.name).trim()
    if (taken.has(lower(name)) || name === '' || /[\\/:]/.test(name)) {
      plan.conflicts.push({ id: board.id, name })
      continue
    }
    taken.add(lower(name))

    const done = doneOf(board.columns)
    const order = (card: MigrationNote): number => {
      const value = Number(field(card.text, 'order') ?? Number.NaN)
      return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
    }
    const sorted = [...list].sort((a, b) => order(a) - order(b) || stem(a.path).localeCompare(stem(b.path)))
    const lanes: NewLane[] = board.columns.map((column) => ({
      title: column.name,
      wip: column.wip ?? null,
      complete: column.id === done,
      items: sorted
        .filter((card) => String(field(card.text, 'status') ?? board.columns[0]!.id) === column.id)
        .map((card) => ({ text: `[[${linkOf(card.path)}]]`, checked: column.id === done })),
    }))
    const lost = sorted.filter((card) => {
      const status = field(card.text, 'status')
      return status !== null && !board.columns.some((c) => c.id === String(status))
    })
    if (lost.length > 0) lanes.push({ title: UNKNOWN_LANE, items: lost.map((card) => ({ text: `[[${linkOf(card.path)}]]` })) })

    const laneLooks: Record<string, { color?: string; start?: string; due?: string }> = {}
    for (const c of board.columns) {
      const look = { ...(c.color === undefined ? {} : { color: c.color }), ...(c.start === undefined ? {} : { start: c.start }), ...(c.due === undefined ? {} : { due: c.due }) }
      if (Object.keys(look).length > 0) laneLooks[c.name] = look
    }
    const recto = {
      migratedFrom: board.id,
      ...(Object.keys(laneLooks).length > 0 ? { lanes: laneLooks } : {}),
      ...(board.widgets === undefined ? {} : { widgets: board.widgets }),
    }
    plan.creates.push({
      path: `${BOARDS_FOLDER}/${name}.md`,
      text: boardText(lanes, { 'metadata-keys': METADATA_KEYS, recto }),
      board: board.id,
      cards: list.length,
    })
  }

  if (plan.conflicts.length > 0) return { ...plan, creates: [], edits: [] }

  for (const card of cards) {
    let after = card.text
    for (const key of OLD_KEYS) after = removeField(after, key)
    if (after !== card.text) plan.edits.push({ path: card.path, before: card.text, after })
  }
  plan.done = plan.creates.length === 0 && plan.edits.length === 0 && boardsJson === undefined
  return plan
}
