/**
 * Tasks, as the user writes them: checkboxes anywhere ("- [ ] call the bank"),
 * plain list items under a heading named Tasks / Задачи / TODO / Option tasks,
 * and cards in tasks/ on a board. Pure, so the indexer, the bots and the tests
 * all read them the same way.
 *
 * A daily note copies yesterday's open tasks into today's; the same task in
 * several notes is one task with a history (`groupTasks`), open if its latest
 * copy is unchecked.
 */

export type TaskSource = 'checkbox' | 'list' | 'card'

export type ExtractedTask = {
  text: string
  done: boolean
  /** The heading it is under, if any. */
  heading: string | null
  line: number
  source: TaskSource
  /** A card's status (its column), as written. */
  status: string | null
}

const CHECKBOX = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s*(.*)$/
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?!\[[ xX]\])(.+)$/
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const FENCE = /^\s*(```|~~~)/
/** Headings whose plain list items are tasks too. */
const TASK_HEADING = /^(tasks?|to-?dos?|option(al)? tasks|задачи|дела|список дел|oppgaver|gjøremål)$/i

/** Folders whose notes never hold real tasks: templates (placeholders) and the bots' own chats. */
export const NO_TASK_FOLDERS = /^(templates?|шаблоны|chats)\//i

/** The text of a task as written, minus Markdown that only decorates it. */
const clean = (text: string): string =>
  text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * A note's tasks. `frontmatter` decides whether a note in tasks/ is a card;
 * the card's own text is its title.
 */
export function extractTasks(path: string, body: string, frontmatter: Record<string, unknown>, title: string): ExtractedTask[] {
  if (NO_TASK_FOLDERS.test(path)) return []
  const out: ExtractedTask[] = []
  if (/^tasks\//i.test(path) && (frontmatter['status'] !== undefined || frontmatter['board'] !== undefined)) {
    out.push({
      text: title,
      done: false,
      heading: null,
      line: 0,
      source: 'card',
      status: frontmatter['status'] == null ? null : String(frontmatter['status']),
    })
  }
  const lines = body.split('\n')
  let heading: string | null = null
  let headingLevel = 0
  let inTaskSection = false
  let inFence = false
  lines.forEach((raw, line) => {
    if (FENCE.test(raw)) inFence = !inFence
    if (inFence) return
    const h = HEADING.exec(raw)
    if (h !== null) {
      const level = h[1]!.length
      const text = h[2]!.trim()
      if (TASK_HEADING.test(text)) {
        inTaskSection = true
        headingLevel = level
      } else if (inTaskSection && level <= headingLevel) inTaskSection = false
      heading = text
      return
    }
    const box = CHECKBOX.exec(raw)
    if (box !== null) {
      const text = clean(box[2] ?? '')
      if (text !== '') out.push({ text, done: box[1] !== ' ', heading, line, source: 'checkbox', status: null })
      return
    }
    if (!inTaskSection) return
    const item = LIST_ITEM.exec(raw)
    if (item === null) return
    const text = clean(item[1]!)
    if (text !== '') out.push({ text, done: false, heading, line, source: 'list', status: null })
  })
  return out
}

/**
 * The day a note is about: the date in a daily note's name, else its
 * frontmatter date / created, else the day it was last written.
 */
export function noteDate(path: string, frontmatter: Record<string, unknown>, mtimeMs: number): string {
  const named = /(\d{4}-\d{2}-\d{2})/.exec(path.slice(path.lastIndexOf('/') + 1))?.[1]
  if (named !== undefined) return named
  for (const key of ['date', 'created', 'day']) {
    const value = frontmatter[key]
    const found = typeof value === 'string' ? /(\d{4}-\d{2}-\d{2})/.exec(value)?.[1] : undefined
    if (found !== undefined) return found
  }
  const d = new Date(mtimeMs)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A daily note: its name is a date. */
export const isDaily = (path: string): boolean =>
  /^\d{4}-\d{2}-\d{2}(\b|$)/.test(path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, ''))

/** Lowercase, no punctuation, single spaces: the form tasks are compared in. */
export const normaliseTask = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** How alike two normalised tasks are, 0..1, by edit distance. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  const longest = Math.max(a.length, b.length)
  if (longest === 0) return 1
  if (Math.abs(a.length - b.length) / longest > 0.1) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return 1 - prev[b.length]! / longest
}

/** A task row as the index keeps it. */
export type TaskRow = {
  path: string
  title: string
  text: string
  norm: string
  done: boolean
  source: TaskSource
  status: string | null
  noteDate: string
  /** When the box was checked, as far as the history shows (ms); null when unknown. */
  doneAt: number | null
  due: string | null
  /** A card's board, null for other tasks. */
  board?: string | null
}

/** One task across the notes it was copied into, oldest copy first. */
export type TaskGroup = {
  text: string
  occurrences: TaskRow[]
  /** Its latest copy is unchecked. */
  open: boolean
  /** The day it was first written. */
  since: string
  /** The day it was checked, if it was. */
  doneOn: string | null
  source: TaskSource
  due: string | null
}

const dayOf = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Tasks copied from note to note (same text, ≥ 0.9 alike) become one task with a history. */
export function groupTasks(rows: readonly TaskRow[]): TaskGroup[] {
  const sorted = [...rows].sort((a, b) => a.noteDate.localeCompare(b.noteDate) || a.path.localeCompare(b.path))
  const groups: { norm: string; rows: TaskRow[] }[] = []
  for (const row of sorted) {
    // Cards are their own task; only checkboxes and list items are copied between notes.
    const group =
      row.source === 'card' ? undefined : groups.find((g) => g.rows[0]!.source !== 'card' && similarity(g.norm, row.norm) >= 0.9)
    if (group !== undefined) group.rows.push(row)
    else groups.push({ norm: row.norm, rows: [row] })
  }
  return groups.map(({ rows: occurrences }) => {
    const latest = occurrences.at(-1)!
    const firstDone = occurrences.find((o) => o.done)
    return {
      text: latest.text,
      occurrences,
      open: !latest.done,
      since: occurrences[0]!.noteDate,
      doneOn: latest.done ? (firstDone?.doneAt != null ? dayOf(firstDone.doneAt) : (firstDone?.noteDate ?? null)) : null,
      source: latest.source,
      due: latest.due,
    }
  })
}

export type PeriodTasks = {
  open: { group: TaskGroup; note: TaskRow }[]
  done: { group: TaskGroup; note: TaskRow }[]
}

/**
 * Tasks for a period: still open - written in the period, or carried through
 * it - and done in the period. Each with the note to name for it: its first
 * copy inside the period, or the one it came from. Open cards count whenever
 * they were made before the period ended.
 */
export function tasksInPeriod(
  groups: readonly TaskGroup[],
  from: string,
  to: string,
  status: 'open' | 'done' | 'all' = 'all',
): PeriodTasks {
  const inside = (d: string): boolean => d >= from && d <= to
  const out: PeriodTasks = { open: [], done: [] }
  for (const group of groups) {
    const within = group.occurrences.filter((o) => inside(o.noteDate))
    const note = within[0] ?? group.occurrences[0]!
    if (group.open && status !== 'done') {
      const carried = within.length > 0 || (group.source === 'card' && group.since <= to)
      if (carried) out.open.push({ group, note })
    }
    if (!group.open && status !== 'open' && group.doneOn !== null && inside(group.doneOn)) {
      out.done.push({ group, note: group.occurrences.find((o) => o.done && inside(o.noteDate)) ?? note })
    }
  }
  const byDay = (a: { note: TaskRow }, b: { note: TaskRow }): number => a.note.noteDate.localeCompare(b.note.noteDate)
  out.open.sort(byDay)
  out.done.sort(byDay)
  return out
}
