/**
 * The vault overview (⌃⌘H): what it reads, and every figure it shows, worked
 * out from that.
 *
 * Pure on purpose. Main gathers the raw material - aggregates from the index,
 * the vault's `.recto/stats/` files, the userData usage file - and the
 * renderer turns it into figures with its own clock. The sums live here so
 * the tests can check them without a vault, an index or a window.
 *
 * Days are local calendar days, `YYYY-MM-DD`, and weeks run Monday to Sunday.
 */

/** A local calendar day, `YYYY-MM-DD`. */
export type Day = string

// --- what main hands over ---------------------------------------------------

/** What the index answers, in one query (workers/indexer/queries.ts `overview`). */
export type OverviewIndex = {
  notes: number
  /** Words in every note, Markdown and frontmatter stripped (`noteWords`). */
  words: number
  links: number
  tags: number
  /** The earliest date any note is about, or null in an empty vault. */
  oldest: Day | null
  folders: { name: string; count: number }[]
  hubs: { path: string; name: string; links: number }[]
  /** Notes nothing links to and that link to nothing. Board cards are left out: they are tasks. */
  orphans: { path: string; name: string }[]
  /** `[[Target]]` with no such note, one row per note and target. */
  broken: { path: string; name: string; target: string }[]
  /** Board cards with a `due` before today, whatever their column - the renderer knows which column is Done. */
  /** Cards with a due day; `done` when every board they are on has them in its done lane. `board`: the first board's name. */
  dueCards: { path: string; name: string; due: Day; done: boolean; board: string | null }[]
  /** Notes written on one of the asked days (a date in the name or the frontmatter, never the file's mtime). */
  written: { path: string; name: string; date: Day }[]
  /** Notes with at least one link, most linked first: the pool "not opened for a while" picks from. */
  linked: { path: string; name: string; links: number }[]
}

/** One day of `.recto/stats/words.json`: the vault's total words, first and last seen that day. */
export type WordsDay = { start: number; startAt: number; end: number; endAt: number }

export type OverviewData = {
  index: OverviewIndex
  /** Notes you edited, per day (`.recto/stats/edits.json`). */
  edits: Record<Day, string[]>
  /** The first day edits were counted from: the earliest backfilled day, or the day counting began. */
  editsSince: Day | null
  words: Record<Day, WordsDay>
  /** Seconds active in Recto, per day (userData). */
  active: Record<Day, number>
  activeSince: Day | null
  /** When "last opened" started being recorded for this vault, epoch ms. */
  openedSince: number
  /** Last opened, epoch ms, for the notes in `index.written` and `index.linked`. */
  opened: Record<string, number>
  /** Topics is on: the section is shown (its contents come from `overviewTopics`, later). */
  topicsOn: boolean
}

export type OverviewTopic = { id: string; name: string; paths: string[] }

/** Where the overview was: the page, and how far each was scrolled. Kept in userData. */
export type OverviewView =
  | { kind: 'main' }
  | { kind: 'orphans' }
  | { kind: 'broken' }
  | { kind: 'overdue' }
  | { kind: 'day'; day: Day }
  | { kind: 'topic'; id: string }

/** The pane (0 the welcome, 1 the figures), the figures' page, and how far each was scrolled. */
export type OverviewPlace = { pane: 0 | 1; view: OverviewView; mainScroll: number; viewScroll: number }

export const START_PLACE: OverviewPlace = { pane: 0, view: { kind: 'main' }, mainScroll: 0, viewScroll: 0 }

// --- days -------------------------------------------------------------------

const pad = (n: number): string => String(n).padStart(2, '0')

export function dayOf(date: Date): Day {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Noon, so a daylight-saving change never moves a day across midnight. */
function dateOf(day: Day): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!, 12)
}

export function addDays(day: Day, n: number): Day {
  const date = dateOf(day)
  date.setDate(date.getDate() + n)
  return dayOf(date)
}

export function daysBetween(from: Day, to: Day): number {
  return Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / 86_400_000)
}

/** The Monday of the week `day` is in. */
export function weekStart(day: Day): Day {
  return addDays(day, -((dateOf(day).getDay() + 6) % 7))
}

/** The same day a month or a year back, or null where that day does not exist (31 March has no 31 February). */
export function monthsBack(day: Day, months: number): Day | null {
  const [y, m, d] = day.split('-').map(Number)
  const total = y! * 12 + (m! - 1) - months
  const back = new Date(Math.floor(total / 12), total % 12, d!, 12)
  return back.getDate() === d ? dayOf(back) : null
}

// --- words --------------------------------------------------------------------

const WIKILINK = /(!?)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g
const MD_LINK = /(!?)\[([^\]]*)\]\([^)\n]*\)/g
const URL = /\bhttps?:\/\/\S+/g

/**
 * Words in a note's body (frontmatter already off): links count as the words
 * they show, embeds and bare URLs as none, Markdown punctuation as nothing.
 */
export function noteWords(body: string): number {
  const text = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(WIKILINK, (_m, bang: string, target: string, alias?: string) => (bang === '!' ? ' ' : ` ${alias ?? target} `))
    .replace(MD_LINK, (_m, bang: string, label: string) => (bang === '!' ? ' ' : ` ${label} `))
    .replace(URL, ' ')
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0
}

/**
 * Words written on `day`: the change in the vault's total since the last day
 * before it that was counted - or, on the first day ever counted, since the
 * first count that day. Null when the day was not counted.
 */
export function wordsOn(words: Record<Day, WordsDay>, day: Day): number | null {
  const today = words[day]
  if (today === undefined) return null
  const before = Object.keys(words)
    .filter((d) => d < day)
    .sort()
    .at(-1)
  return today.end - (before === undefined ? today.start : words[before]!.end)
}

/** Words written over `from`..`to`, or null when none of those days was counted. */
export function wordsBetween(words: Record<Day, WordsDay>, from: Day, to: Day): number | null {
  let sum: number | null = null
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const n = wordsOn(words, day)
    if (n !== null) sum = (sum ?? 0) + n
  }
  return sum
}

/** Fold one count of the vault's words into the file's day. */
export function recordWords(words: Record<Day, WordsDay>, day: Day, total: number, at: number): Record<Day, WordsDay> {
  const old = words[day]
  return { ...words, [day]: old === undefined ? { start: total, startAt: at, end: total, endAt: at } : { ...old, end: total, endAt: at } }
}

// --- edits --------------------------------------------------------------------

/**
 * Consecutive days with an edit, ending today - or yesterday, when today has
 * none yet: a streak is not broken until the day is over. And the longest run
 * ever counted.
 */
export function streak(edits: Record<Day, string[]>, today: Day): { current: number; longest: number } {
  const days = new Set(Object.keys(edits).filter((d) => (edits[d]?.length ?? 0) > 0))
  let current = 0
  for (let day = days.has(today) ? today : addDays(today, -1); days.has(day); day = addDays(day, -1)) current++
  let longest = 0
  for (const day of days) {
    if (days.has(addDays(day, -1))) continue
    let run = 0
    for (let d = day; days.has(d); d = addDays(d, 1)) run++
    longest = Math.max(longest, run)
  }
  return { current, longest }
}

/** Distinct notes edited over `from`..`to`. */
export function notesBetween(edits: Record<Day, string[]>, from: Day, to: Day): number {
  const seen = new Set<string>()
  for (let day = from; day <= to; day = addDays(day, 1)) for (const path of edits[day] ?? []) seen.add(path)
  return seen.size
}

/** Days the way the files merge them: every note edited on a day by any copy of the file. */
export function mergeEdits(a: Record<Day, string[]>, b: Record<Day, string[]>): Record<Day, string[]> {
  const out: Record<Day, string[]> = { ...a }
  for (const [day, paths] of Object.entries(b)) out[day] = [...new Set([...(out[day] ?? []), ...paths])].sort()
  return out
}

/** The same counts per day, kept by the copy that saw each end of the day: earliest start, latest end. */
export function mergeWords(a: Record<Day, WordsDay>, b: Record<Day, WordsDay>): Record<Day, WordsDay> {
  const out: Record<Day, WordsDay> = { ...a }
  for (const [day, w] of Object.entries(b)) {
    const o = out[day]
    if (o === undefined) {
      out[day] = w
      continue
    }
    const first = w.startAt < o.startAt ? w : o
    const last = w.endAt > o.endAt ? w : o
    out[day] = { start: first.start, startAt: first.startAt, end: last.end, endAt: last.endAt }
  }
  return out
}

/** A note renamed or moved (a folder too, by prefix): its days follow it. */
export function moveEdits(edits: Record<Day, string[]>, from: string, to: string): Record<Day, string[]> {
  const out: Record<Day, string[]> = {}
  for (const [day, paths] of Object.entries(edits)) out[day] = [...new Set(paths.map((p) => movedPath(p, from, to)))].sort()
  return out
}

export function movedPath(path: string, from: string, to: string): string {
  if (path === from) return to
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path
}

/**
 * Days with edits, read off version history: every saved version after a
 * note's first. The first is left out because it is the copy taken when the
 * index first saw the note, which is not an edit.
 */
export function editsFromSnapshots(rows: readonly { path: string; ts: number }[]): Record<Day, string[]> {
  const byPath = new Map<string, number[]>()
  for (const row of rows) byPath.set(row.path, [...(byPath.get(row.path) ?? []), row.ts])
  const out: Record<Day, string[]> = {}
  for (const [path, stamps] of byPath) {
    for (const ts of stamps.sort((a, b) => a - b).slice(1)) {
      const day = dayOf(new Date(ts))
      out[day] = [...new Set([...(out[day] ?? []), path])].sort()
    }
  }
  return out
}

// --- time in Recto -----------------------------------------------------------

/** How long after the last key or pointer movement the time still counts. */
export const IDLE_MS = 120_000

/**
 * Seconds to add for one tick of `stepMs`: all of it while the window has
 * focus and you did something in the last two minutes, none otherwise.
 */
export function activeSeconds(now: number, lastInput: number, focused: boolean, stepMs: number): number {
  return focused && now - lastInput <= IDLE_MS ? Math.round(stepMs / 1000) : 0
}

/** Seconds over `from`..`to`. */
export function secondsBetween(active: Record<Day, number>, from: Day, to: Day): number {
  let sum = 0
  for (let day = from; day <= to; day = addDays(day, 1)) sum += active[day] ?? 0
  return sum
}

/**
 * Average seconds per day over `from`..`to`, counting only days from `since`
 * on - a week counted from Wednesday is averaged over its days since Wednesday.
 * Null when none of the range was counted.
 */
export function averagePerDay(active: Record<Day, number>, since: Day | null, from: Day, to: Day): number | null {
  if (since === null || since > to) return null
  const start = since > from ? since : from
  return secondsBetween(active, start, to) / (daysBetween(start, to) + 1)
}

// --- needs attention, rediscover ------------------------------------------------

/** Cards past their due day that are not done. */
export function overdue<T extends { due: Day; done: boolean }>(cards: readonly T[], today: Day): T[] {
  return cards.filter((card) => card.due < today && !card.done)
}

/** How long a note has to go unopened to be offered again. */
export const REDISCOVER_DAYS = 60

/**
 * Up to two notes to read again: one written a month or a year ago today,
 * and the most linked note not opened for 60 days. A note never opened since
 * recording began counts from when it began, so nothing qualifies until 60
 * days of it have passed.
 */
export function rediscover(
  index: Pick<OverviewIndex, 'written' | 'linked'>,
  opened: Record<string, number>,
  openedSince: number,
  today: Day,
  now: number,
): {
  onThisDay: { path: string; name: string; ago: 'month' | 'year' } | null
  unopened: { path: string; name: string; days: number } | null
} {
  const month = monthsBack(today, 1)
  const year = monthsBack(today, 12)
  const hit = index.written.find((n) => n.date === month) ?? index.written.find((n) => n.date === year)
  const onThisDay = hit === undefined ? null : { path: hit.path, name: hit.name, ago: hit.date === month ? ('month' as const) : ('year' as const) }
  const cutoff = now - REDISCOVER_DAYS * 86_400_000
  const stale = index.linked.find((n) => n.path !== hit?.path && (opened[n.path] ?? openedSince) <= cutoff)
  const unopened = stale === undefined ? null : { path: stale.path, name: stale.name, days: Math.floor((now - (opened[stale.path] ?? openedSince)) / 86_400_000) }
  return { onThisDay, unopened }
}

// --- display ------------------------------------------------------------------

/**
 * Today's change beside a figure: "+4 today", "−120 today". Up reads as good
 * news; down is only a fact - deleting is editing too. Nothing today, nothing
 * shown: never "+0".
 */
export function todayChange(n: number | null): { text: string; tone: 'up' | 'down' } | null {
  if (n === null || n === 0) return null
  const amount = Math.abs(n).toLocaleString('en-US')
  return n > 0 ? { text: `+${amount} today`, tone: 'up' } : { text: `−${amount} today`, tone: 'down' }
}

/** `41,200` up to ten thousand, then `41.2k`. */
export function compact(n: number): string {
  if (Math.abs(n) < 10_000) return n.toLocaleString('en-US')
  return `${(n / 1000).toFixed(Math.abs(n) < 100_000 ? 1 : 0).replace(/\.0$/, '')}k`
}

/** `2 h 10 min`, `25 min`, `0 min`. */
export function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Heat level 0-4 of a day's count against the busiest day shown. */
export function heatLevel(n: number, max: number): number {
  if (n <= 0 || max <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((n / max) * 4)))
}
