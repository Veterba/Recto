/**
 * Board and column definitions, from `.recto/boards.json`.
 *
 * Columns live here rather than in the notes for one reason: an empty column
 * has to be able to exist. If the set of columns were derived from the
 * `status` values present in the vault, dragging the last card out of "Done"
 * would delete the column, which is absurd.
 *
 * What is NOT here: the cards. A card is a note, found by querying the property
 * index for `board: <id>`. That asymmetry is the whole design - structure is
 * app state, content is files.
 *
 * Read defensively, like every other file in `.recto/`: a person is
 * invited to edit it, so every field may be missing or the wrong type.
 */

/** Colours a column can wear: names of theme tokens, never raw colours. */
export const COLUMN_COLORS = ['gray', 'blue', 'green', 'yellow', 'orange', 'red', 'purple'] as const
export type ColumnColor = (typeof COLUMN_COLORS)[number]

export type Column = {
  id: string
  name: string
  color?: ColumnColor
  /** Work-in-progress limit: the count is shown against it and warns when reached. */
  wip?: number
  /** A date range the column is planned for, shown on the calendar. `YYYY-MM-DD`. */
  start?: string
  due?: string
  /** The column that means finished: entering it writes `completed` on the card. */
  done?: boolean
}

/** The widget strip above a board: whether it shows, and which widgets, in order. */
export type BoardWidgets = { shown: boolean; list: string[] }

export type Board = { id: string; name: string; columns: Column[]; widgets?: BoardWidgets }
export type BoardsFile = { boards: Board[] }

/** A sensible first board, so the Tasks section is never an empty room. */
export const DEFAULT_BOARDS: BoardsFile = {
  boards: [
    {
      id: 'main',
      name: 'Main',
      columns: [
        { id: 'todo', name: 'To do' },
        { id: 'doing', name: 'Doing' },
        { id: 'done', name: 'Done' },
      ],
    },
  ],
}

/** Ids go into frontmatter and filenames, so keep them boring and portable. */
const ID = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u

const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value)

const DAY = /^\d{4}-\d{2}-\d{2}$/

function parseColumn(raw: unknown): Column | null {
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (!isId(record['id'])) return null
  const name = record['name']
  const column: Column = { id: record['id'], name: typeof name === 'string' && name !== '' ? name : record['id'] }
  const { color, wip, start, due, done } = record
  if (typeof color === 'string' && (COLUMN_COLORS as readonly string[]).includes(color)) column.color = color as ColumnColor
  if (typeof wip === 'number' && Number.isInteger(wip) && wip > 0) column.wip = wip
  if (typeof start === 'string' && DAY.test(start)) column.start = start
  if (typeof due === 'string' && DAY.test(due)) column.due = due
  if (done === true) column.done = true
  return column
}

function parseWidgets(raw: unknown): BoardWidgets | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const list = Array.isArray(record['list']) ? record['list'].filter((id): id is string => typeof id === 'string') : []
  return { shown: record['shown'] !== false, list: [...new Set(list)] }
}

function parseBoard(raw: unknown): Board | null {
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (!isId(record['id'])) return null

  const rawColumns = Array.isArray(record['columns']) ? record['columns'] : []
  const columns: Column[] = []
  for (const entry of rawColumns) {
    const column = parseColumn(entry)
    // A duplicate column id would make two columns claim the same cards.
    if (column !== null && !columns.some((existing) => existing.id === column.id)) columns.push(column)
  }
  if (columns.length === 0) return null

  const name = record['name']
  const board: Board = {
    id: record['id'],
    name: typeof name === 'string' && name !== '' ? name : record['id'],
    columns,
  }
  const widgets = parseWidgets(record['widgets'])
  if (widgets !== undefined) board.widgets = widgets
  return board
}

export function parseBoards(raw: unknown): BoardsFile {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_BOARDS
  const list = (raw as Record<string, unknown>)['boards']
  if (!Array.isArray(list)) return DEFAULT_BOARDS

  const boards: Board[] = []
  for (const entry of list) {
    const board = parseBoard(entry)
    if (board !== null && !boards.some((existing) => existing.id === board.id)) boards.push(board)
  }
  return boards.length === 0 ? DEFAULT_BOARDS : { boards }
}

/**
 * The column for cards whose `status` names no column. Not a real id - ids
 * cannot start with `?` - so it can never collide with one.
 */
export const UNKNOWN_COLUMN = '?unknown'

/**
 * Which column a card belongs to.
 *
 * A card with no `status` yet starts in the first column. One whose status
 * matches no column - hand-typed, left behind by a deleted column, or a
 * boards.json that was lost or edited - goes to "Unknown status" at the end
 * rather than vanishing or passing for a card in the first column. A card
 * that cannot be seen cannot be fixed.
 */
export function columnOf(status: string | null, columns: readonly Column[]): string {
  if (status === null) return columns[0]?.id ?? UNKNOWN_COLUMN
  return columns.some((column) => column.id === status) ? status : UNKNOWN_COLUMN
}

/** The column that means done: the one marked so, else the one called `done`, else the last. */
export function doneColumn(columns: readonly Column[]): string | null {
  return (columns.find((c) => c.done === true) ?? columns.find((c) => c.id === 'done') ?? columns.at(-1))?.id ?? null
}

/** A name for a new column that no column on the board has yet: "New column", "New column 2"… */
export function newColumnName(columns: readonly Column[]): string {
  const taken = new Set(columns.map((c) => c.name.toLowerCase()))
  if (!taken.has('new column')) return 'New column'
  let n = 2
  while (taken.has(`new column ${n}`)) n++
  return `New column ${n}`
}

/** A unique column id derived from a display name the user typed. */
export function columnId(name: string, existing: readonly Column[]): string {
  const base =
    name
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'column'

  if (!existing.some((column) => column.id === base)) return base
  let n = 2
  while (existing.some((column) => column.id === `${base}-${n}`)) n++
  return `${base}-${n}`
}
