import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { BOTS_FOLDER, CHATS_FOLDER, type Bot } from '../../shared/bots'
import type { CatalogNote, PeriodNote, TaskRowData } from '../../shared/indexer-protocol'
import { groupTasks, isDaily, normaliseTask, tasksInPeriod, type TaskRow } from '../../shared/tasks'
import { send as indexer } from '../index-client'
import { langOf, renderGroupedTasks, renderTaskAnswer } from './task-answer'
import { currentVault } from '../vault'
import { isExcluded } from './context'
import type { Period } from './period'
import type { BotModelProvider } from './provider'

/**
 * What the harness looks up itself for a routed question - before the model
 * writes a word, so the answer stands on the right material even when the
 * model would not have asked for it:
 *
 * - tasks_in_period: the task index (shared/tasks.ts) - still open, done in
 *   the period, and the tasks plain-text notes imply, read by the model once
 *   per note version and cached.
 * - notes_in_period: the notes written or edited in the period, with what
 *   they gained in it.
 *
 * Each returns the text that goes into the prompt and the notes it came from
 * (the answer's sources).
 */

export type ToolNote = { path: string; title: string; heading: string | null; score: number }
export type ToolResult = {
  text: string
  notes: ToolNote[]
  summary: string
  /** An answer the harness wrote itself (the task list), shown before the model's own words. */
  answer?: string
}

/** An index note: one that links out to this many notes or more. */
const HUB_LINKS = 8
/** Plain-text notes read for implied tasks, at most, per question. */
const MAX_INFERRED = 20

const day = (iso: string): string => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const folderOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const excluded = (bot: Bot, p: string): boolean => isExcluded(p, [CHATS_FOLDER, path.dirname(BOTS_FOLDER), ...(bot.exclude ?? [])])

/** A board's name as the user wrote it (boards.json), else its id with a capital letter. */
function boardName(id: string): string {
  const vault = currentVault()
  try {
    if (vault !== null) {
      const raw = JSON.parse(fs.readFileSync(path.join(vault.path, '.recto', 'boards.json'), 'utf8')) as {
        boards?: { id?: string; name?: string }[]
      }
      const found = raw.boards?.find((b) => b.id === id)?.name
      if (found !== undefined && found !== '') return found
    }
  } catch {
    // No boards file: the id will do.
  }
  return id.charAt(0).toUpperCase() + id.slice(1)
}

/** The columns that mean done, per board: named done / готово / complete, or else the board's last column. */
function doneColumns(): Set<string> {
  const vault = currentVault()
  const done = new Set<string>(['done', 'готово', 'сделано', 'complete', 'completed', 'finished', 'ferdig'])
  if (vault === null) return done
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(vault.path, '.recto', 'boards.json'), 'utf8')) as {
      boards?: { columns?: { id?: string; name?: string }[] }[]
    }
    for (const board of raw.boards ?? []) {
      const columns = board.columns ?? []
      const named = columns.filter((c) => /done|готов|сделан|complete|finish|ferdig/i.test(`${c.id ?? ''} ${c.name ?? ''}`))
      for (const c of named.length > 0 ? named : columns.slice(-1)) for (const k of [c.id, c.name]) if (k) done.add(k.toLowerCase())
    }
  } catch {
    // No boards: the names alone decide.
  }
  return done
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The tasks a plain-text note implies ("надо доделать экспорт"), read by the model once per version of the note. */
async function inferredTasks(note: PeriodNote, provider: BotModelProvider, model: string): Promise<string[]> {
  const hash = createHash('sha1').update(note.content).digest('hex')
  const cached = await indexer({ kind: 'inferred-get', hash }).catch(() => null)
  if (cached?.kind === 'inferred-result' && cached.items !== null) return cached.items
  let items: string[] = []
  try {
    const raw = await provider.complete(
      [{ role: 'user', content: `Note "${note.title}":\n\n${note.content.slice(0, 3000)}` }],
      'List the things the author of this note still means to do - explicit to-dos and intentions ("need to finish X", "надо доделать X", "TODO"), not facts, not finished work. Short phrases in the note\'s own language. Reply with JSON only: {"tasks": ["..."]} - an empty list if there are none.',
      { model, signal: AbortSignal.timeout(30_000), json: true, maxTokens: 150 },
    )
    const parsed = JSON.parse(/\{[\s\S]*\}/.exec(raw)?.[0] ?? '{}') as { tasks?: unknown }
    items = Array.isArray(parsed.tasks) ? parsed.tasks.filter((t): t is string => typeof t === 'string' && t.trim() !== '').slice(0, 5) : []
  } catch {
    return []
  }
  await indexer({ kind: 'inferred-put', hash, path: note.path, items }).catch(() => null)
  return items
}

export type ToolOptions = {
  bot: Bot
  /** The user's question, for the answer's language and what it asks. */
  question: string
  provider: BotModelProvider
  model: string
  today: string
  looseTasks: boolean
  onProgress?: (text: string) => void
}

/**
 * tasks_in_period: still open (written in the period or carried through it),
 * done in the period, open cards with their due dates, and - from notes of
 * the period with no task items - the tasks they imply.
 */
export async function tasksTool(
  period: Period,
  status: 'open' | 'done' | 'all',
  keywords: readonly string[],
  o: ToolOptions,
): Promise<ToolResult> {
  // Two months back, so a task carried into the period is seen with its history; up to today,
  // because whether it is still open is decided by its latest copy, wherever that is.
  const response = await indexer({ kind: 'task-rows', since: addDays(period.from, -60), to: period.to > o.today ? period.to : o.today })
  const raw: TaskRowData[] = response.kind === 'task-rows-result' ? response.rows : []
  const done = doneColumns()
  const rows: TaskRow[] = raw
    .filter((r) => !excluded(o.bot, r.path))
    .map((r) => (r.source === 'card' ? { ...r, done: r.status !== null && done.has(r.status.toLowerCase()) } : r))
  const groups = groupTasks(rows)
  const found = tasksInPeriod(groups, period.from, period.to, status)

  // The notes of the period that hold no task items: what do they say still needs doing?
  const inferred: { note: PeriodNote; items: string[] }[] = []
  if (o.looseTasks && status !== 'done') {
    const notes = await indexer({ kind: 'notes-in-period', from: period.from, to: period.to })
    const plain = (notes.kind === 'notes-in-period-result' ? notes.notes : [])
      .filter((n) => n.tasks === 0 && n.links < HUB_LINKS && !isDaily(n.path) && !excluded(o.bot, n.path) && n.content.trim() !== '')
      .slice(0, MAX_INFERRED)
    for (const [i, note] of plain.entries()) {
      o.onProgress?.(`Reading ${plain.length} notes from the period… ${i + 1}/${plain.length}`)
      const items = await inferredTasks(note, o.provider, o.model)
      if (items.length > 0) inferred.push({ note, items })
    }
  }

  const openNotes = found.open.filter((x) => x.group.source !== 'card')
  const openCards = found.open.filter((x) => x.group.source === 'card')
  const prepared = renderTaskAnswer(
    { ...found, inferred: inferred.map((x) => ({ path: x.note.path, title: x.note.title, items: x.items })) },
    o.question,
    keywords,
    o.today,
  )
  const text = [
    `## The user's tasks, ${period.from}${period.from === period.to ? '' : ` to ${period.to}`} (from the task index)`,
    '',
    prepared.text,
  ].join('\n')

  // The answer's sources: the notes it names, in the order it names them.
  const notes: ToolNote[] = prepared.notes.map((n, i) => ({
    path: n.path,
    title: n.title,
    heading: null,
    score: Math.max(0.1, 3 - i * 0.1),
  }))
  const summary = `${openNotes.length + openCards.length} open, ${found.done.length} done${inferred.length === 0 ? '' : `, ${inferred.reduce((n, x) => n + x.items.length, 0)} from text`}`
  return { text, notes, summary, answer: prepared.text }
}

/**
 * notes_in_period: what was written or edited in the period - dailies first,
 * then task cards, then the rest; index notes last, one line each. Notes
 * about what the question is about (its keywords, in title, folder or text)
 * come first. The two most relevant are given nearly in full, the next ten in
 * a line or two, and the rest counted.
 */
export async function notesTool(period: Period, keywords: readonly string[], o: ToolOptions, folder?: string): Promise<ToolResult> {
  const response = await indexer({ kind: 'notes-in-period', from: period.from, to: period.to })
  const all = (response.kind === 'notes-in-period-result' ? response.notes : []).filter(
    (n) => !excluded(o.bot, n.path) && (folder === undefined || n.path.toLowerCase().startsWith(folder.toLowerCase())),
  )
  const words = keywords.map((k) => k.toLowerCase()).filter((k) => k.length >= 3)
  // A note about the topic by its title or folder counts twice what a mention in its text does.
  const relevance = (n: PeriodNote): number =>
    words.reduce((sum, w) => sum + (n.path.toLowerCase().includes(w) ? 2 : n.changed.toLowerCase().includes(w) ? 1 : 0), 0)
  const rank = (n: PeriodNote): number => (n.links >= HUB_LINKS ? 3 : isDaily(n.path) ? 0 : /^tasks\//i.test(n.path) ? 1 : 2)
  const sorted = [...all].sort((a, b) => relevance(b) - relevance(a) || rank(a) - rank(b) || a.date.localeCompare(b.date))
  const hubs = sorted.filter((n) => n.links >= HUB_LINKS)
  const body = sorted.filter((n) => n.links < HUB_LINKS)
  const text = [
    `## Notes written or edited ${day(period.from)}${period.from === period.to ? '' : ` – ${day(period.to)}`} (${all.length})`,
    '',
    ...body
      .slice(0, 12)
      .flatMap((n, i) => [
        `### ${n.title} (${folderOf(n.path) || 'vault root'}, ${n.date})`,
        i < 2 ? n.content.slice(0, 800).trim() : n.changed.slice(0, 200).trim(),
      ]),
    ...(body.length > 12 ? [`+${body.length - 12} more notes`] : []),
    ...(hubs.length === 0 ? [] : ['Index notes, also edited:', ...hubs.map((n) => `- ${n.title}`)]),
  ].join('\n')
  const notes = [...body, ...hubs].map((n, i) => ({ path: n.path, title: n.title, heading: null, score: Math.max(0.1, 3 - i * 0.1) }))
  return { text, notes, summary: `${all.length} notes` }
}

// ---- open_tasks / tasks_in_period, grouped -----------------------------------------------

/** A scope's notes, and a line saying what it is about (its name and its notes' titles), for spotting related tasks elsewhere. */
export type TaskScope = { label: string; paths: ReadonlySet<string>; describe: string }

export type GroupBy = 'topic' | 'note'

/** Vectors for texts (EmbeddingGemma, normalised); null without the model. */
export type Embed = (texts: string[]) => Promise<number[][] | null>

/** Without the model's word on it, a task joins a topic when it is this close to the topic's description. */
const NEAR_TOPIC = 0.6
/** Tasks the model sorts in one call. */
const SORT_BATCH = 15
/** Folders that hold everything of one kind, never a subject. */
const GENERIC = /^(daily|tasks|templates?|template|attachments|chats|other|weblinks|\d{2,4}|w\d+)$/i

const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((s, x, i) => s + x * b[i]!, 0)

/** The non-task part of a daily note: what it says besides its checklist. */
export function dailyThoughts(content: string): string {
  const out: string[] = []
  let inTasks = false
  for (const line of content.replace(/^---\n[\s\S]*?\n---\n?/, '').split('\n')) {
    const h = /^#{1,6}\s+(.+)$/.exec(line)
    if (h !== null) {
      inTasks = /task|задач|todo|oppgav/i.test(h[1]!)
      continue
    }
    if (!inTasks && !/^\s*[-*]\s*(\[[ xX]?\]\s*)?(empty)?\s*$/i.test(line) && line.trim() !== '') out.push(line)
  }
  return out.join('\n')
}

/** The subject folder a note lives in: its folder, or the nearest one above that is not a date or a catch-all. */
export function subjectFolder(p: string): string | null {
  const parts = p.split('/').slice(0, -1)
  while (parts.length > 0 && GENERIC.test(parts.at(-1)!)) parts.pop()
  if (parts.length === 0 || GENERIC.test(parts[0]!)) return null
  // A log folder inside a project is the project.
  if (parts.length > 1 && /\blog\b|sources|evals?\b/i.test(parts.at(-1)!)) parts.pop()
  return parts.join('/')
}

type Item = { text: string; where: string; path: string; title: string; board: string | null }

type Topic = { label: string; describe: string }

/**
 * Each task's topic - a subject folder of the vault ("Recto app", "Math Khan
 * Academy") or none - asked of the model as a numbered list: neither the
 * words of "keep going on the app" nor their vectors say it is about Recto,
 * but the model, shown what each folder holds, does. The vectors decide only
 * when the model's answer can't be read.
 */
async function assignTopics(
  items: readonly Item[],
  topics: readonly Topic[],
  embed: Embed,
  o: ToolOptions,
): Promise<Map<Item, string | null>> {
  const out = new Map<Item, string | null>()
  if (items.length === 0 || topics.length === 0) return out
  const list = topics.map((t, i) => `${i + 1}. ${t.describe}`).join('\n')
  for (let b = 0; b < items.length; b += SORT_BATCH) {
    const batch = items.slice(b, b + SORT_BATCH)
    // {"1": 3, "2": 0, ...}: a task the model skips is left to the vectors, not the whole batch.
    let answer: Record<string, unknown> = {}
    try {
      const raw = await o.provider.complete(
        [
          {
            role: 'user',
            content: `Topics:\n0. None of these\n${list}\n\nTasks:\n${batch.map((x, i) => `${i + 1}. ${x.text} (in "${x.title}")`).join('\n')}`,
          },
        ],
        'Sort the user\'s tasks into topics; each topic is a folder of their notes, shown with some of its notes. A task belongs to the topic it is about; a task about something else (an errand, another project, life) is 0. JSON only, every task number with its topic number: {"1": 2, "2": 0, ...}',
        { model: o.model, signal: AbortSignal.timeout(60_000), json: true, maxTokens: 40 + batch.length * 8 },
      )
      answer = JSON.parse(/\{[\s\S]*\}/.exec(raw)?.[0] ?? '{}') as Record<string, unknown>
    } catch {
      answer = {}
    }
    const unsorted: Item[] = []
    batch.forEach((x, i) => {
      const n = Number(answer[String(i + 1)])
      if (Number.isInteger(n) && n >= 0 && n <= topics.length) out.set(x, n === 0 ? null : topics[n - 1]!.label)
      else unsorted.push(x)
    })
    if (unsorted.length === 0) continue
    const vecs = await embed([...topics.map((t) => t.describe), ...unsorted.map((x) => x.text)])
    unsorted.forEach((x, i) => {
      const v = vecs?.[topics.length + i]
      const best = v === undefined ? null : topics.map((t, j) => ({ t, s: dot(v, vecs![j]!) })).sort((p, q) => q.s - p.s)[0]
      out.set(x, best != null && best.s >= NEAR_TOPIC ? best.t.label : null)
    })
  }
  return out
}

/**
 * The open tasks, all of them, grouped: in a period (written in it or
 * carried through it, and what the period's plain-text notes imply), or in
 * a scope (its notes', any date, and related ones elsewhere: a daily's "keep
 * going on the app" belongs to the app). Grouped by topic - the subject folder
 * a task's note is in, or for dailies and cards the folder they are nearest
 * to by meaning - or by note.
 */
export async function groupedTasksTool(
  q: { period: Period | null; scope: TaskScope | null; groupBy: GroupBy },
  notes: readonly CatalogNote[],
  embed: Embed,
  o: ToolOptions,
): Promise<ToolResult> {
  const to = q.period !== null && q.period.to > o.today ? q.period.to : o.today
  const since = q.period === null ? '1970-01-01' : addDays(q.period.from, -60)
  const response = await indexer({ kind: 'task-rows', since, to })
  const done = doneColumns()
  const rows: TaskRow[] = (response.kind === 'task-rows-result' ? response.rows : [])
    .filter((r) => !excluded(o.bot, r.path))
    .map((r) => (r.source === 'card' ? { ...r, done: r.status !== null && done.has(r.status.toLowerCase()) } : r))
  const groups = groupTasks(rows)
  const found =
    q.period !== null
      ? tasksInPeriod(groups, q.period.from, q.period.to, 'all')
      : { open: groups.filter((g) => g.open).map((g) => ({ group: g, note: g.occurrences.at(-1)! })), done: [] }
  // A card whose checklist is listed is not listed again as an item of its own.
  const withItems = new Set(found.open.filter((x) => x.group.source !== 'card').map((x) => x.note.path))
  const items: Item[] = found.open
    .filter(({ group, note }) => !(group.source === 'card' && withItems.has(note.path)))
    .map(({ group, note }) => ({
      text: group.text,
      where: note.title,
      path: note.path,
      title: note.title,
      board: note.board ?? null,
    }))

  // Plain-text intentions: the period's notes with no task items, and what dailies say besides their checklist.
  if (o.looseTasks && q.period !== null) {
    const period = await indexer({ kind: 'notes-in-period', from: q.period.from, to: q.period.to })
    const candidates = (period.kind === 'notes-in-period-result' ? period.notes : [])
      // A daily belongs to its own day, whenever it was last touched.
      .filter(
        (n) =>
          n.links < HUB_LINKS && !excluded(o.bot, n.path) && (!isDaily(n.path) || (n.date >= q.period!.from && n.date <= q.period!.to)),
      )
      .map((n) => (isDaily(n.path) ? { ...n, content: dailyThoughts(n.content) } : n))
      .filter((n) => (isDaily(n.path) || n.tasks === 0) && (n.content.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) >= 4)
      .slice(0, MAX_INFERRED)
    for (const [i, note] of candidates.entries()) {
      o.onProgress?.(`Reading ${candidates.length} notes from the period… ${i + 1}/${candidates.length}`)
      for (const text of await inferredTasks(note, o.provider, o.model)) {
        if (!items.some((x) => normaliseTask(x.text) === normaliseTask(text)))
          items.push({ text, where: note.title, path: note.path, title: note.title, board: null })
      }
    }
  }

  // The topics: the vault's subject folders, each shown with a few of its notes (and the scope, if it is a topic).
  const folders = [...new Set(notes.map((n) => subjectFolder(n.path)).filter((f): f is string => f !== null))]
  const leaf = (f: string): string => f.slice(f.lastIndexOf('/') + 1)
  // The topics: the vault's subject folders, each shown with a few of its notes (and the scope, if it is a topic).
  const topics: Topic[] = folders.map((f) => ({
    label: leaf(f),
    describe: `${leaf(f)} - notes: ${notes
      .filter((n) => n.path.startsWith(`${f}/`) && !/^\d{4}-\d{2}-\d{2}/.test(n.title))
      .slice(0, 6)
      .map((n) => n.title)
      .join(', ')}`,
  }))
  if (q.scope !== null && !topics.some((t) => t.label === q.scope!.label)) topics.push({ label: q.scope.label, describe: q.scope.describe })

  // A scope keeps its own notes' tasks, and those elsewhere that are about it.
  let kept = items
  const guessed = new Set<Item>()
  if (q.scope !== null) {
    const inside = items.filter((x) => q.scope!.paths.has(x.path))
    const outside = items.filter((x) => !q.scope!.paths.has(x.path))
    // One decision per note (a card is its title and first items), one per item only in a daily:
    // a note's items share its subject, a daily's don't.
    const units = new Map<string, Item[]>()
    for (const x of outside) {
      const key = isDaily(x.path) ? `${x.path}\0${x.text}` : x.path
      units.set(key, [...(units.get(key) ?? []), x])
    }
    const heads: Item[] = [...units.values()].map((xs) =>
      xs.length === 1
        ? xs[0]!
        : {
            ...xs[0]!,
            text: `${xs[0]!.title}: ${xs
              .slice(0, 3)
              .map((x) => x.text)
              .join('; ')}`,
          },
    )
    o.onProgress?.(`Sorting ${heads.length} tasks…`)
    const sorted = await assignTopics(heads, topics, embed, o)
    // The model's guesses are shown as guesses: a group of their own, last.
    for (const x of [...units.values()].filter((_, i) => sorted.get(heads[i]!) === q.scope!.label).flat()) guessed.add(x)
    kept = [...inside, ...guessed]
  }

  // Labels: a card's board; a note in a subject folder, that folder; another note, its own title (it is a
  // topic of its own); a daily's item, the topic the model sorts it into, else "Other".
  const label = new Map<Item, string>()
  const other = langOf(o.question) === 'ru' ? 'Другое' : 'Other'
  const maybe = langOf(o.question) === 'ru' ? 'Возможно, сюда' : 'Might belong here'
  if (q.groupBy === 'note') for (const x of kept) label.set(x, guessed.has(x) ? maybe : x.where)
  else {
    const loose: Item[] = []
    for (const x of kept) {
      const own = subjectFolder(x.path)
      if (x.board !== null) label.set(x, boardName(x.board))
      else if (own !== null) label.set(x, leaf(own))
      else if (!isDaily(x.path) && x.path.includes('/')) label.set(x, x.title)
      else loose.push(x)
    }
    o.onProgress?.(`Sorting ${loose.length} tasks…`)
    const sorted = await assignTopics(loose, topics, embed, o)
    for (const x of loose) label.set(x, sorted.get(x) ?? other)
  }
  const byLabel = new Map<string, Item[]>()
  for (const x of kept) byLabel.set(label.get(x)!, [...(byLabel.get(label.get(x)!) ?? []), x])
  // Biggest groups first; "Other" and the guesses last.
  const last = (l: string): number => (l === maybe ? 2 : l === other ? 1 : 0)
  const ordered = [...byLabel]
    .sort((a, b) => last(a[0]) - last(b[0]) || b[1].length - a[1].length)
    .map(([l, xs]) => ({ label: l, items: xs }))
  const prepared = renderGroupedTasks(ordered, o.question, q.period === null ? null : found.done.length)
  const name = q.period !== null ? 'tasks_in_period' : 'open_tasks'
  const text = [
    `## The user's open tasks${q.scope === null ? '' : ` for ${q.scope.label}`}${q.period === null ? '' : `, ${q.period.from} to ${q.period.to}`} (${name}, from the task index)`,
    '',
    prepared.text,
  ].join('\n')
  // Sources by day, as the list was written: dailies first, oldest first, then the other notes, then cards.
  const rank = (p: string): string => (isDaily(p) ? `0${p.slice(p.lastIndexOf('/') + 1)}` : /^tasks\//i.test(p) ? `2${p}` : `1${p}`)
  const sources: ToolNote[] = [...prepared.notes]
    .sort((a, b) => rank(a.path).localeCompare(rank(b.path)))
    .map((n, i) => ({ path: n.path, title: n.title, heading: null, score: Math.max(0.1, 3 - i * 0.1) }))
  return { text, notes: sources, summary: `${kept.length} open in ${ordered.length} groups`, answer: prepared.text }
}
