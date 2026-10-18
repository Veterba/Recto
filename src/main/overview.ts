import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { VAULT_STATE_DIR } from '../shared/vault'
import {
  type Day,
  type OverviewData,
  type OverviewTopic,
  type WordsDay,
  dayOf,
  editsFromSnapshots,
  mergeEdits,
  mergeWords,
  monthsBack,
  moveEdits,
  movedPath,
  recordWords,
} from '../shared/overview'
import { send } from './index-client'
import { currentVault } from './vault'
import { readSettings, readTopics } from './topics/storage'
import { topicLink } from './topics/state'
import { linkSources } from './topics/service'

/**
 * What the vault overview counts that the files cannot tell it afterwards.
 *
 * In the vault, `.recto/stats/` - it is about the vault, and travels with it:
 *   - `edits.json`: per day, the notes you edited (saves in the editor, card
 *     edits and moves you made). Not Recto's own writes, not other apps.
 *   - `words.json`: per day, the vault's total words, first and last count.
 *
 * In userData, `overview-usage.json` - it is about this Mac:
 *   - seconds active in Recto per day;
 *   - per vault, when each note was last opened.
 *
 * The vault is often in iCloud, which copies a file it could not reconcile to
 * `edits 2.json`. Every read folds such copies back in and removes them; every
 * write reads, merges and replaces the file whole (write, then rename), so two
 * Macs can only ever add to each other's days.
 */

type EditsFile = { since: Day | null; backfilled: boolean; days: Record<Day, string[]> }
type WordsFile = { days: Record<Day, WordsDay> }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const DAY = /^\d{4}-\d{2}-\d{2}$/

function parseEdits(raw: unknown): EditsFile {
  const out: EditsFile = { since: null, backfilled: false, days: {} }
  if (!isObject(raw)) return out
  if (typeof raw['since'] === 'string' && DAY.test(raw['since'])) out.since = raw['since']
  out.backfilled = raw['backfilled'] === true
  if (isObject(raw['days']))
    for (const [day, paths] of Object.entries(raw['days']))
      if (DAY.test(day) && Array.isArray(paths)) out.days[day] = paths.filter((p): p is string => typeof p === 'string')
  return out
}

function mergeEditsFiles(a: EditsFile, b: EditsFile): EditsFile {
  const since = a.since === null ? b.since : b.since === null ? a.since : a.since < b.since ? a.since : b.since
  return { since, backfilled: a.backfilled || b.backfilled, days: mergeEdits(a.days, b.days) }
}

function parseWords(raw: unknown): WordsFile {
  const out: WordsFile = { days: {} }
  if (!isObject(raw) || !isObject(raw['days'])) return out
  for (const [day, w] of Object.entries(raw['days'])) {
    if (!DAY.test(day) || !isObject(w)) continue
    const n = (k: string): number | null => (typeof w[k] === 'number' && Number.isFinite(w[k]) ? (w[k] as number) : null)
    const [start, startAt, end, endAt] = [n('start'), n('startAt'), n('end'), n('endAt')]
    if (start !== null && startAt !== null && end !== null && endAt !== null) out.days[day] = { start, startAt, end, endAt }
  }
  return out
}

// --- the vault's stats files -------------------------------------------------

/** `<vault>/.recto/stats`, of the open vault unless another is named. */
function statsDir(vaultPath: string | null = currentVault()?.path ?? null): string | null {
  return vaultPath === null ? null : path.join(vaultPath, VAULT_STATE_DIR, 'stats')
}

/**
 * The file and every conflict copy of it, merged. When there were copies, the
 * merge is written back and the copies go: they have been read into it.
 */
function readStats<T>(
  base: 'edits' | 'words',
  parse: (raw: unknown) => T,
  merge: (a: T, b: T) => T,
  dir: string | null = statsDir(),
): { data: T; exists: boolean } {
  let data = parse(null)
  if (dir === null) return { data, exists: false }
  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return { data, exists: false }
  }
  const pattern = new RegExp(`^${base}( \\d+)?\\.json$`)
  const files = names.filter((name) => pattern.test(name))
  for (const name of files) {
    try {
      data = merge(data, parse(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))))
    } catch {
      // Half-synced or hand-broken: what it held is lost, the rest stands.
    }
  }
  const copies = files.filter((name) => name !== `${base}.json`)
  if (copies.length > 0 && writeStats(base, data, dir)) {
    for (const name of copies) fs.rmSync(path.join(dir, name), { force: true })
  }
  return { data, exists: files.length > 0 }
}

function writeStats(base: 'edits' | 'words', data: unknown, dir: string | null = statsDir()): boolean {
  if (dir === null) return false
  try {
    fs.mkdirSync(dir, { recursive: true })
    // A dot name, so a half-written file never matches `<base> N.json`.
    const tmp = path.join(dir, `.${base}.json.tmp`)
    fs.writeFileSync(tmp, `${JSON.stringify(data)}\n`, 'utf8')
    fs.renameSync(tmp, path.join(dir, `${base}.json`))
    return true
  } catch (err) {
    console.error('[overview] stats write', err)
    return false
  }
}

const readEdits = (dir = statsDir()): { data: EditsFile; exists: boolean } => readStats('edits', parseEdits, mergeEditsFiles, dir)
const readWords = (dir = statsDir()): WordsFile =>
  readStats('words', parseWords, (a, b) => ({ days: mergeWords(a.days, b.days) }), dir).data

/** Read, change, merge with what is on disk now, write. */
function updateEdits(change: (file: EditsFile) => EditsFile, dir = statsDir()): void {
  writeStats('edits', change(readEdits(dir).data), dir)
}

/**
 * Days with edits before counting began, read once off version history.
 *
 * Version history is pruned to 30 days, so this reaches back a month at most.
 * Written into `edits.json` and marked done, so the days survive the index
 * being deleted, and are never read in twice.
 */
export async function backfillEdits(): Promise<void> {
  if (statsDir() === null) return
  if (readEdits().data.backfilled) return
  const response = await send({ kind: 'snapshot-times' }, 30_000)
  if (response.kind !== 'snapshot-times-result') return
  const days = editsFromSnapshots(response.rows)
  const first = Object.keys(days).sort()[0] ?? null
  updateEdits((file) => mergeEditsFiles(file, { since: first, backfilled: true, days }))
}

// --- edits and words, as they happen -----------------------------------------

/**
 * Edits waiting to be written, by day: one write for a burst of saves. Kept
 * with the vault they were made in, so switching vaults inside the wait
 * cannot file them under the other one.
 */
let pending: Record<Day, string[]> = {}
let pendingVault: string | null = null
let pendingDay: Day | null = null
let flushTimer: NodeJS.Timeout | null = null
const FLUSH_MS = 5_000

export function recordEdit(notePath: string, day: Day): void {
  const vault = currentVault()?.path ?? null
  if (vault === null || !notePath.toLowerCase().endsWith('.md') || !DAY.test(day)) return
  if (pendingVault !== null && pendingVault !== vault) void flushEdits()
  pending = mergeEdits(pending, { [day]: [notePath] })
  pendingVault = vault
  pendingDay = day
  flushTimer ??= setTimeout(() => void flushEdits(), FLUSH_MS)
}

/**
 * Write what is pending - synchronously, so a quit cannot lose it - then
 * count the vault's words for the day: the index has the saves by now.
 */
export async function flushEdits(): Promise<void> {
  if (flushTimer !== null) clearTimeout(flushTimer)
  flushTimer = null
  const [days, vault, day] = [pending, pendingVault, pendingDay]
  pending = {}
  pendingVault = pendingDay = null
  if (vault === null || day === null || Object.keys(days).length === 0) return
  updateEdits((file) => mergeEditsFiles(file, { since: Object.keys(days).sort()[0]!, backfilled: false, days }), statsDir(vault))
  if (currentVault()?.path === vault) await countWords(day)
}

/** One count of the open vault's words, folded into the day. */
export async function countWords(day: Day): Promise<void> {
  const dir = statsDir()
  if (dir === null) return
  const response = await send({ kind: 'words-total' }, 15_000).catch(() => null)
  if (response?.kind !== 'words-total-result') return
  writeStats('words', { days: recordWords(readWords(dir).days, day, response.words, Date.now()) }, dir)
}

/** Edits are counted from the first day one was recorded. Starts the count today when nothing has been. */
function startEdits(today: Day): EditsFile {
  const { data, exists } = readEdits()
  if (exists && data.since !== null) return data
  const started = { ...data, since: data.since ?? today }
  writeStats('edits', started)
  return started
}

// --- this Mac: time in Recto, last opened -------------------------------------

type Usage = {
  active: Record<Day, number>
  activeSince: Day | null
  opened: Record<string, { since: number; notes: Record<string, number> }>
}

const usageFile = (): string => path.join(app.getPath('userData'), 'overview-usage.json')
let usage: Usage | null = null

function readUsage(): Usage {
  if (usage !== null) return usage
  usage = { active: {}, activeSince: null, opened: {} }
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(usageFile(), 'utf8'))
    if (isObject(raw)) {
      if (isObject(raw['active']))
        for (const [day, s] of Object.entries(raw['active'])) if (DAY.test(day) && typeof s === 'number') usage.active[day] = s
      if (typeof raw['activeSince'] === 'string' && DAY.test(raw['activeSince'])) usage.activeSince = raw['activeSince']
      if (isObject(raw['opened']))
        for (const [vault, v] of Object.entries(raw['opened'])) {
          if (!isObject(v) || typeof v['since'] !== 'number' || !isObject(v['notes'])) continue
          const notes: Record<string, number> = {}
          for (const [p, at] of Object.entries(v['notes'])) if (typeof at === 'number') notes[p] = at
          usage.opened[vault] = { since: v['since'], notes }
        }
    }
  } catch {
    // First run, or a broken file: counting starts again from now.
  }
  return usage
}

function writeUsage(): void {
  if (usage === null) return
  try {
    fs.mkdirSync(path.dirname(usageFile()), { recursive: true })
    const tmp = `${usageFile()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(usage), 'utf8')
    fs.renameSync(tmp, usageFile())
  } catch (err) {
    console.error('[overview] usage write', err)
  }
}

export function recordActive(day: Day, seconds: number): void {
  if (!(seconds > 0) || !DAY.test(day)) return
  const u = readUsage()
  u.active[day] = (u.active[day] ?? 0) + seconds
  u.activeSince ??= day
  writeUsage()
}

/** This vault's "last opened", started now if it never was. */
function openedFor(vaultPath: string, now: number): { since: number; notes: Record<string, number> } {
  const u = readUsage()
  let entry = u.opened[vaultPath]
  if (entry === undefined) {
    entry = { since: now, notes: {} }
    u.opened[vaultPath] = entry
    writeUsage()
  }
  return entry
}

export function recordOpened(notePath: string, at: number): void {
  const vault = currentVault()
  if (vault === null || !notePath.toLowerCase().endsWith('.md')) return
  openedFor(vault.path, at).notes[notePath] = at
  writeUsage()
}

/** A note or folder renamed or moved: its days and its "last opened" follow it. */
export function moved(from: string, to: string): void {
  const vault = currentVault()
  if (vault === null) return
  const entry = readUsage().opened[vault.path]
  if (entry !== undefined) {
    const notes: Record<string, number> = {}
    for (const [p, at] of Object.entries(entry.notes)) notes[movedPath(p, from, to)] = at
    entry.notes = notes
    writeUsage()
  }
  if (pendingVault === vault.path) pending = moveEdits(pending, from, to)
  const { data, exists } = readEdits()
  if (exists) writeStats('edits', { ...data, days: moveEdits(data.days, from, to) })
}

// --- the page's data ------------------------------------------------------------

/**
 * Everything the overview shows, raw. `today` and `now` are the renderer's,
 * so the page and its sums agree on what day it is. Reading also starts the
 * counts that have not started: today's first word count, the edits' first
 * day, "last opened" for this vault.
 */
export async function overviewData(today: Day, now: number): Promise<OverviewData | null> {
  const vault = currentVault()
  if (vault === null) return null
  const days = [monthsBack(today, 1), monthsBack(today, 12)].filter((d): d is Day => d !== null)
  const response = await send({ kind: 'overview', days }, 15_000)
  if (response.kind !== 'overview-result') return null
  const index = response.overview
  const edits = startEdits(today)
  let words = readWords().days
  if (words[today] === undefined) {
    words = recordWords(words, today, index.words, now)
    writeStats('words', { days: words })
  }
  const u = readUsage()
  const opened = openedFor(vault.path, now)
  const wanted = new Set([...index.written.map((n) => n.path), ...index.linked.map((n) => n.path)])
  return {
    index,
    edits: pendingVault === vault.path ? mergeEdits(edits.days, pending) : edits.days,
    editsSince: edits.since,
    words,
    active: u.active,
    activeSince: u.activeSince ?? today,
    openedSince: opened.since,
    opened: Object.fromEntries(Object.entries(opened.notes).filter(([p]) => wanted.has(p))),
    topicsOn: readSettings().enabled,
  }
}

/** The largest topics and their notes; null when Topics is off. Slow: one index query per topic. */
export async function overviewTopics(): Promise<OverviewTopic[] | null> {
  if (currentVault() === null || !readSettings().enabled) return null
  const state = readTopics()
  const live = state.topics.filter((t) => !state.deleted.includes(t.id))
  const sources = await Promise.all(live.map((t) => linkSources(topicLink(t.name))))
  return live
    .map((t, i) => ({ id: t.id, name: t.name, paths: sources[i]! }))
    .filter((t) => t.paths.length > 0)
    .sort((a, b) => b.paths.length - a.paths.length || a.name.localeCompare(b.name))
    .slice(0, 8)
}

/** Today, by this process's clock: for counts taken when no page asked. */
export const todayHere = (): Day => dayOf(new Date())
