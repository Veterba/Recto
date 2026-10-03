import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { BOTS_FOLDER, CHATS_FOLDER, type Bot } from '../../shared/bots'
import type { PeriodNote, TaskRowData } from '../../shared/indexer-protocol'
import { groupTasks, isDaily, tasksInPeriod, type TaskRow } from '../../shared/tasks'
import { send as indexer } from '../index-client'
import { renderTaskAnswer } from './task-answer'
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
