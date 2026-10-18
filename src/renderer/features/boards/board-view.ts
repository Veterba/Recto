import type { BoardCardInfo } from '@shared/index-results'
import type { KanbanItem } from '@shared/kanban'
import { addDays, cardSpan, dateOnly, dueState, readPriority, readTags, type Priority } from '@shared/card-fields'
import type { Column } from './boards'

/**
 * What the board draws, worked out from the board file's items and the
 * index's rows for the notes they name: pure, so the filters, the sort and
 * every widget's arithmetic are tested without a screen.
 */

export type CardView = BoardCardInfo & {
  /** Who it is on this board: its note's path, or for a plain-text card its place (unique on screen). */
  key: string
  /** A plain-text card: no note behind it, only its text. */
  light: boolean
  /** The column it is in. */
  column: string
  /** Its place in that column, in the file. */
  index: number
  /** Its lines as the file has them, to find it again if the file changed. */
  raw: string
  /** The item's own text (a light card's title and description). */
  text: string
  level: Priority | null
  span: { from: string; to: string } | null
  tagList: string[]
  completedDay: string | null
}

const blank = (path: string, title: string): BoardCardInfo => ({
  path,
  title,
  description: '',
  start: null,
  due: null,
  completed: null,
  priority: null,
  tags: null,
  checklist: { done: 0, total: 0 },
  links: 0,
})

/**
 * One card: an item of the board file, and the note it names if it names one
 * (`row`). A link to a note that does not exist yet is drawn with its name,
 * like a light card, until the note is there.
 */
export function toView(item: Pick<KanbanItem, 'text' | 'link' | 'raw'>, row: BoardCardInfo | null, column: Column, index: number): CardView {
  const light = item.link === null
  const title = light ? (item.text.split('\n')[0] ?? '') : item.link!.slice(item.link!.lastIndexOf('/') + 1)
  const base = row ?? blank('', title)
  const description = light ? item.text.split('\n').slice(1).join(' ').trim() : base.description
  return {
    ...base,
    title: row?.title ?? title,
    description,
    key: row !== null ? row.path : `${light ? 'text' : 'link'}:${column.id}:${index}`,
    light,
    column: column.id,
    index,
    raw: item.raw,
    text: item.text,
    level: readPriority(base.priority),
    span: cardSpan(dateOnly(base.start), dateOnly(base.due)),
    tagList: readTags(base.tags),
    completedDay: dateOnly(base.completed),
  }
}

export type CardFilter = { query: string; priority: Priority | 'none' | null }

/** The toolbar's filters: words in the title or description, and one priority (High only, or one picked in a widget). */
export function filterCards<T extends CardView>(cards: readonly T[], filter: CardFilter): T[] {
  const words = filter.query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '')
  return cards.filter((card) => {
    if (filter.priority !== null && (card.level ?? 'none') !== filter.priority) return false
    const text = `${card.title} ${card.description}`.toLowerCase()
    return words.every((word) => text.includes(word))
  })
}

export type SortKey = 'manual' | 'priority' | 'due' | 'title'
export const SORTS: readonly { key: SortKey; label: string }[] = [
  { key: 'manual', label: 'Manual' },
  { key: 'priority', label: 'Priority' },
  { key: 'due', label: 'Due date' },
  { key: 'title', label: 'Title' },
]

const RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

export const isSortKey = (value: unknown): value is SortKey => SORTS.some((s) => s.key === value)

/** A column's cards in the chosen order. Manual is the order the board file has them in. */
export function sortCards<T extends CardView>(cards: readonly T[], key: SortKey): T[] {
  const manual = [...cards].sort((a, b) => a.index - b.index)
  if (key === 'manual') return manual
  const position = new Map(manual.map((card, i) => [card.key, i]))
  const tie = (a: T, b: T): number => position.get(a.key)! - position.get(b.key)!
  return [...manual].sort((a, b) => {
    if (key === 'title') return a.title.localeCompare(b.title) || tie(a, b)
    if (key === 'priority') return (a.level === null ? 3 : RANK[a.level]) - (b.level === null ? 3 : RANK[b.level]) || tie(a, b)
    // Due date: soonest first, undated last.
    const ad = a.span?.to ?? '9999'
    const bd = b.span?.to ?? '9999'
    return ad < bd ? -1 : ad > bd ? 1 : tie(a, b)
  })
}

/** The Monday of the ISO week a day is in. */
export function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const weekday = (new Date(y!, m! - 1, d!).getDay() + 6) % 7
  return addDays(day, -weekday)
}

export type CalendarView = 'week' | '2weeks' | 'month'
export const CALENDAR_VIEWS: readonly { key: CalendarView; label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: '2weeks', label: '2 weeks' },
  { key: 'month', label: 'Month' },
]

const firstOfMonth = (day: string): string => `${day.slice(0, 8)}01`

const daysInMonth = (day: string): number => {
  const [y, m] = day.split('-').map(Number)
  return new Date(y!, m!, 0).getDate()
}

/** How many days a view shows from its first day. A month is the month that first day is in. */
export function viewDays(view: CalendarView, from: string): number {
  return view === 'week' ? 7 : view === '2weeks' ? 14 : daysInMonth(from)
}

/** Where a view starts so that it shows a day: its week's Monday, or its month's 1st. */
export function viewStart(view: CalendarView, day: string): string {
  return view === 'month' ? firstOfMonth(day) : mondayOf(day)
}

/** The arrows: a whole view back or forward. A month steps to the 1st of the next or previous one. */
export function stepView(view: CalendarView, from: string, direction: 1 | -1): string {
  if (view !== 'month') return addDays(from, direction * viewDays(view, from))
  const first = firstOfMonth(from)
  return direction === 1 ? addDays(first, daysInMonth(first)) : firstOfMonth(addDays(first, -1))
}

export type CalendarBar = {
  kind: 'card' | 'column'
  key: string
  label: string
  /** Day columns it covers in the visible range, 0 based, inclusive. */
  from: number
  to: number
  level: Priority | null
  path: string | null
  /** Its whole range, which may run past the visible days. */
  span: { from: string; to: string }
  /** It goes on before or after the visible days. */
  before: boolean
  after: boolean
}

/**
 * The calendar's bars for `days` days from `first`: each card with dates, and
 * each column with a date range, cut to those days. Columns first, then cards
 * by start.
 */
export function calendarBars(cards: readonly CardView[], columns: readonly Column[], first: string, days: number): CalendarBar[] {
  const last = addDays(first, days - 1)
  const index = (day: string): number => {
    for (let i = 0; i < days; i++) if (addDays(first, i) === day) return i
    return -1
  }
  const clip = (span: { from: string; to: string }): Pick<CalendarBar, 'from' | 'to' | 'before' | 'after' | 'span'> | null => {
    if (span.to < first || span.from > last) return null
    return {
      from: index(span.from < first ? first : span.from),
      to: index(span.to > last ? last : span.to),
      before: span.from < first,
      after: span.to > last,
      span,
    }
  }
  const out: CalendarBar[] = []
  for (const column of columns) {
    const span = cardSpan(column.start ?? null, column.due ?? null)
    const cut = span === null ? null : clip(span)
    if (cut !== null)
      out.push({ kind: 'column', key: `column:${column.id}`, label: `Column: ${column.name}`, level: null, path: null, ...cut })
  }
  const dated = cards
    .filter((card) => card.span !== null)
    .sort((a, b) => (a.span!.from < b.span!.from ? -1 : a.span!.from > b.span!.from ? 1 : a.title.localeCompare(b.title)))
  for (const card of dated) {
    const cut = clip(card.span!)
    if (cut !== null) out.push({ kind: 'card', key: card.key, label: card.title, level: card.level, path: card.path, ...cut })
  }
  return out
}

const dayIndex = (monday: string, day: string): number => {
  for (let i = 0; i < 7; i++) if (addDays(monday, i) === day) return i
  return -1
}

/** Cards that entered Done this week, by the day they did: Monday first. */
export function doneThisWeek(cards: readonly CardView[], today: string): { total: number; perDay: number[] } {
  const monday = mondayOf(today)
  const perDay = new Array<number>(7).fill(0)
  for (const card of cards) {
    if (card.completedDay === null) continue
    const i = dayIndex(monday, card.completedDay)
    if (i !== -1) perDay[i]!++
  }
  return { total: perDay.reduce((a, b) => a + b, 0), perDay }
}

const open = (card: CardView, done: string | null): boolean => card.column !== done
const byEnd = (a: CardView, b: CardView): number =>
  a.span!.to < b.span!.to ? -1 : a.span!.to > b.span!.to ? 1 : a.title.localeCompare(b.title)

/** Unfinished cards due today or within three days, soonest first. Late ones are Overdue's. */
export function dueSoon(cards: readonly CardView[], today: string, done: string | null): CardView[] {
  const limit = addDays(today, 3)
  return cards.filter((card) => open(card, done) && card.span !== null && card.span.to >= today && card.span.to <= limit).sort(byEnd)
}

/** Unfinished cards whose last day has passed, the oldest first. */
export function overdue(cards: readonly CardView[], today: string, done: string | null): CardView[] {
  return cards.filter((card) => open(card, done) && card.span !== null && card.span.to < today).sort(byEnd)
}

/** Unfinished cards that today falls inside: between start and due, or due today. Highest priority first. */
export function todayCards(cards: readonly CardView[], today: string, done: string | null): CardView[] {
  return cards
    .filter((card) => open(card, done) && card.span !== null && card.span.from <= today && today <= card.span.to)
    .sort((a, b) => (a.level === null ? 3 : RANK[a.level]) - (b.level === null ? 3 : RANK[b.level]) || a.title.localeCompare(b.title))
}

/** Open cards per priority, and those with none. */
export function priorityCounts(cards: readonly CardView[], done: string | null): Record<Priority | 'none', number> {
  const counts = { high: 0, medium: 0, low: 0, none: 0 }
  for (const card of cards) if (open(card, done)) counts[card.level ?? 'none']++
  return counts
}

/** The last cards to enter Done, most recent first, by the `completed` they were given. */
export function recentlyDone(cards: readonly CardView[], limit = 5): CardView[] {
  return cards
    .filter((card) => card.completedDay !== null)
    .sort((a, b) => (a.completed! > b.completed! ? -1 : a.completed! < b.completed! ? 1 : a.title.localeCompare(b.title)))
    .slice(0, limit)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const parts = (day: string): { y: number; m: string; d: number } => {
  const [y, m, d] = day.split('-').map(Number)
  return { y: y!, m: MONTHS[m! - 1]!, d: d! }
}

/** "16 Oct", "12–16 Oct", "28 Sep – 2 Oct"; the year only when it is not this one. */
export function spanLabel(span: { from: string; to: string }, today: string): string {
  const a = parts(span.from)
  const b = parts(span.to)
  const year = (p: { y: number }): string => (String(p.y) === today.slice(0, 4) ? '' : ` ${p.y}`)
  if (span.from === span.to) return `${b.d} ${b.m}${year(b)}`
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${b.m}${year(b)}`
  if (a.y === b.y) return `${a.d} ${a.m} – ${b.d} ${b.m}${year(b)}`
  return `${a.d} ${a.m}${year(a)} – ${b.d} ${b.m}${year(b)}`
}

export { dueState }
