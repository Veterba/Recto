import { boardText, doneLane, parseKanban, rectoSettings, type KanbanBoard } from '@shared/kanban'

/**
 * A board, as the board view sees it: read from the board note itself, a
 * note in the Obsidian Kanban format (shared/kanban.ts).
 *
 * The note is the only source: lanes are its headings, cards its list items,
 * in the order they are written. What Obsidian has no place for - a lane's
 * colour and dates, the widgets, the sort - sits in the note's
 * settings block under `recto`, never as loose lines, which Obsidian would
 * delete on its next save.
 */

/** Colours a column can wear: names of theme tokens, never raw colours. */
export const COLUMN_COLORS = ['gray', 'blue', 'green', 'yellow', 'orange', 'red', 'purple'] as const
export type ColumnColor = (typeof COLUMN_COLORS)[number]

export type Column = {
  /** The lane's place on the board, as a string: lanes have no id in the format. */
  id: string
  index: number
  name: string
  color?: ColumnColor
  /** Work-in-progress limit, written into the lane's heading: `Doing (3)`. */
  wip?: number
  /** A date range the column is planned for, shown on the calendar. `YYYY-MM-DD`. */
  start?: string
  due?: string
  /** The lane whose cards are done (`**Complete**` in the file): entering it ticks the card and writes `completed`. */
  done?: boolean
}

/** The widget strip above a board: whether it shows, and which widgets, in order. */
export type BoardWidgets = { shown: boolean; list: string[] }

export type Board = {
  /** The board note. */
  path: string
  /** Its file name. */
  name: string
  columns: Column[]
  widgets?: BoardWidgets
  sort?: string
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The board a note's text describes. */
export function boardFrom(path: string, parsed: KanbanBoard): Board {
  const recto = rectoSettings(parsed)
  const done = doneLane(parsed.lanes)
  const columns = parsed.lanes.map((lane, index) => {
    const column: Column = { id: String(index), index, name: lane.title }
    const look = recto.lanes?.[lane.title]
    if (look?.color !== undefined && (COLUMN_COLORS as readonly string[]).includes(look.color)) column.color = look.color as ColumnColor
    if (look?.start !== undefined && DAY.test(look.start)) column.start = look.start
    if (look?.due !== undefined && DAY.test(look.due)) column.due = look.due
    if (lane.wip !== null) column.wip = lane.wip
    if (index === done) column.done = true
    return column
  })
  const board: Board = { path, name: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, ''), columns }
  if (recto.widgets !== undefined) board.widgets = recto.widgets
  if (recto.sort !== undefined) board.sort = recto.sort
  return board
}

export const parseBoard = (path: string, text: string): Board => boardFrom(path, parseKanban(text))

/** The done column's id, or null when the board has none. */
export function doneColumn(columns: readonly Column[]): string | null {
  return columns.find((c) => c.done === true)?.id ?? null
}

/** A name for a new column that no column on the board has yet: "New column", "New column 2"… */
export function newColumnName(columns: readonly Column[]): string {
  const taken = new Set(columns.map((c) => c.name.toLowerCase()))
  if (!taken.has('new column')) return 'New column'
  let n = 2
  while (taken.has(`new column ${n}`)) n++
  return `New column ${n}`
}

/** A new board's note: three lanes, the last one done - what the plugin would write. */
export const newBoardText = (): string =>
  boardText([
    { title: 'To do', items: [] },
    { title: 'Doing', items: [] },
    { title: 'Done', complete: true, items: [] },
  ])
