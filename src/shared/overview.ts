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
export type WordsDay = { start: number; startAt: number; end: number; endAt: number; rule?: number }

export type OverviewData = {
  index: OverviewIndex
  /** Notes you edited, per day (`.recto/stats/edits.json`). */
  edits: Record<Day, string[]>
  /** The first day edits were counted from: the earliest backfilled day, or the day counting began. */
  editsSince: Day | null
  /** The vault's total words per day, first and last count (`.recto/stats/words.json`). */
  words: Record<Day, WordsDay>
  /** Words you wrote per day, by note: what your saves added (`edits.json`). */
  written: Written
  /** The first day words written were counted from. */
  writtenSince: Day | null
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
  return wordTokens(body).length
}

/** A note's words as the counts see them: links read as their text, comments and URLs left out. */
export function wordTokens(body: string): string[] {
  const text = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(WIKILINK, (_m, bang: string, target: string, alias?: string) => (bang === '!' ? ' ' : ` ${alias ?? target} `))
    .replace(MD_LINK, (_m, bang: string, label: string) => (bang === '!' ? ' ' : ` ${label} `))
    .replace(URL, ' ')
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? []
}

/** What a save changed in a note's words, as a multiset: words that came in, words that went. Lowercased. */
export type WordDiff = { added: string[]; removed: string[] }

/** The words of the new body the old did not have, and the other way round. Bodies only - the frontmatter is not writing. */
export function wordDiff(beforeBody: string, afterBody: string): WordDiff {
  const count = (body: string): Map<string, number> => {
    const out = new Map<string, number>()
    for (const word of wordTokens(body)) out.set(word.toLowerCase(), (out.get(word.toLowerCase()) ?? 0) + 1)
    return out
  }
  const before = count(beforeBody)
  const after = count(afterBody)
  const added: string[] = []
  const removed: string[] = []
  for (const [word, n] of after) for (let i = (before.get(word) ?? 0); i < n; i++) added.push(word)
  for (const [word, n] of before) for (let i = (after.get(word) ?? 0); i < n; i++) removed.push(word)
  return { added, removed }
}

/**
 * The words you wrote, per day and note: the words your saves added that day
 * and that are still there - a multiset, `{ word: how many }`. A word you
 * typed and deleted again is taken back off; a word that was in the note
 * before you started that day can be deleted without taking anything off,
 * so the count is never below zero. Moving text changes nothing.
 * A day read in from older records, which knew only a number, keeps it under
 * `#` - no word can be `#`.
 */
export type Written = Record<Day, Record<string, Record<string, number>>>
const OLD_COUNT = '#'

/** One save's change folded into its note's day: its deletions take back what you wrote that day, then its additions count. */
export function applyWords(written: Written, day: Day, path: string, diff: WordDiff): Written {
  if (diff.added.length === 0 && diff.removed.length === 0) return written
  const words = { ...written[day]?.[path] }
  for (const word of diff.removed) {
    const left = words[word] ?? 0
    if (left > 1) words[word] = left - 1
    else if (left === 1) delete words[word]
  }
  for (const word of diff.added) words[word] = (words[word] ?? 0) + 1
  const notes = { ...written[day] }
  if (Object.keys(words).length === 0) delete notes[path]
  else notes[path] = words
  const out = { ...written }
  if (Object.keys(notes).length === 0) delete out[day]
  else out[day] = notes
  return out
}

/** A count from before words were kept one by one, as a day's record. */
export const oldCount = (n: number): Record<string, number> => ({ [OLD_COUNT]: n })

/** Two copies of the record, from two copies of the file: each word's count is the larger, never the sum. */
export function mergeWritten(a: Written, b: Written): Written {
  const out: Written = { ...a }
  for (const [day, notes] of Object.entries(b)) {
    const mergedNotes = { ...out[day] }
    for (const [path, words] of Object.entries(notes)) {
      const merged = { ...mergedNotes[path] }
      for (const [word, n] of Object.entries(words)) merged[word] = Math.max(merged[word] ?? 0, n)
      mergedNotes[path] = merged
    }
    out[day] = mergedNotes
  }
  return out
}

const noteCount = (words: Record<string, number>): number => Object.values(words).reduce((a, b) => a + b, 0)

/** Words you wrote on a day; 0 for a day with none. */
export const writtenOn = (written: Written, day: Day): number => Object.values(written[day] ?? {}).reduce((sum, words) => sum + noteCount(words), 0)

export function writtenBetween(written: Written, from: Day, to: Day): number {
  let sum = 0
  for (let day = from; day <= to; day = addDays(day, 1)) sum += writtenOn(written, day)
  return sum
}

/**
 * Words written, read off version history: each version of a note you edited
 * that day against the one before it, folded in as a save would be. A note's
 * first version ever is where history began, not something written.
 */
export function writtenFromSnapshots(
  rows: readonly { path: string; ts: number; body: string }[],
  edits: Readonly<Record<Day, readonly string[]>>,
): Written {
  const byPath = new Map<string, { ts: number; body: string }[]>()
  for (const row of rows) byPath.set(row.path, [...(byPath.get(row.path) ?? []), row])
  let out: Written = {}
  for (const [path, versions] of byPath) {
    versions.sort((a, b) => a.ts - b.ts)
    for (let i = 1; i < versions.length; i++) {
      const day = dayOf(new Date(versions[i]!.ts))
      if (!(edits[day] ?? []).includes(path)) continue
      out = applyWords(out, day, path, wordDiff(versions[i - 1]!.body, versions[i]!.body))
    }
  }
  return out
}

/**
 * How the vault's total is counted. A day counted under another rule is not
 * compared with one counted under this: its count starts again.
 * 1: every note's words. 2: board notes left out (their lines are links, not writing).
 */
export const WORDS_RULE = 2

/** Fold one count of the vault's words into the file's day. A day counted under another rule starts again from this count. */
export function recordWords(words: Record<Day, WordsDay>, day: Day, total: number, at: number, rule = WORDS_RULE): Record<Day, WordsDay> {
  const old = words[day]
  const fresh = { start: total, startAt: at, end: total, endAt: at, rule }
  return { ...words, [day]: old === undefined || (old.rule ?? 1) !== rule ? fresh : { ...old, end: total, endAt: at } }
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
    const last = w.endAt > o.endAt ? w : o
    // Counts under different rules are not one day's: the newer rule's stands alone.
    if ((w.rule ?? 1) !== (o.rule ?? 1)) {
      out[day] = (w.rule ?? 1) > (o.rule ?? 1) ? w : o
      continue
    }
    const first = w.startAt < o.startAt ? w : o
    out[day] = { start: first.start, startAt: first.startAt, end: last.end, endAt: last.endAt, ...(last.rule === undefined ? {} : { rule: last.rule }) }
  }
  return out
}

/** A note renamed or moved (a folder too, by prefix): its days follow it. */
export function moveEdits(edits: Record<Day, string[]>, from: string, to: string): Record<Day, string[]> {
  const out: Record<Day, string[]> = {}
  for (const [day, paths] of Object.entries(edits)) out[day] = [...new Set(paths.map((p) => movedPath(p, from, to)))].sort()
  return out
}

export function moveWritten(written: Written, from: string, to: string): Written {
  const out: Written = {}
  for (const [day, notes] of Object.entries(written)) {
    let moved: Written = { [day]: {} }
    for (const [p, words] of Object.entries(notes)) moved = mergeWritten(moved, { [day]: { [movedPath(p, from, to)]: words } })
    out[day] = moved[day]!
  }
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
