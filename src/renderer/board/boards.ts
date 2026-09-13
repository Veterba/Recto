/**
 * Board and column definitions, from `.obsidian-like/boards.json`.
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
 * Read defensively, like every other file in `.obsidian-like/`: a person is
 * invited to edit it, so every field may be missing or the wrong type.
 */

export type Column = { id: string; name: string }
export type Board = { id: string; name: string; columns: Column[] }
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

function parseColumn(raw: unknown): Column | null {
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (!isId(record['id'])) return null
  const name = record['name']
  return { id: record['id'], name: typeof name === 'string' && name !== '' ? name : record['id'] }
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
  return {
    id: record['id'],
    name: typeof name === 'string' && name !== '' ? name : record['id'],
    columns,
  }
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
 * Which column a card belongs to.
 *
 * A card whose `status` matches no column - hand-typed, or left behind when a
 * column was renamed - goes into the first column rather than vanishing. A card
 * that cannot be seen cannot be fixed.
 */
export function columnOf(status: string | null, columns: readonly Column[]): string {
  const first = columns[0]?.id ?? ''
  if (status === null) return first
  return columns.some((column) => column.id === status) ? status : first
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
