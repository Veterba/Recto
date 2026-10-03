import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { powerMonitor } from 'electron'
import path from 'node:path'
import { BOTS_FOLDER, CHATS_FOLDER, type NoteCardsStatus } from '../../shared/bots'
import type { CatalogNote, StoredCard } from '../../shared/indexer-protocol'
import { isDaily } from '../../shared/tasks'
import { send as indexer } from '../index-client'
import * as vaultFs from '../vault-fs'
import { isExcluded } from './context'
import { chunkNote } from './chunks'
import type { BotModelProvider } from './provider'

/**
 * Note cards: for every note, a short card the bots can read instead of the
 * whole note - two or three sentences of summary, its language, its kind
 * (daily, log, project, learning, reference, list, stub) and its main
 * headings. The summary and the kind come from the local model; everything
 * else is worked out in code. A card is cached in index.db by the note's
 * content hash and the model, so only a changed note is read again.
 *
 * Built in the background while nobody is using the app, paused on battery
 * below 20 % unless charging. Nothing leaves the machine: the model is the
 * bot's local one.
 */

export const CARD_KINDS = ['daily', 'log', 'project', 'learning', 'reference', 'list', 'stub'] as const
export type CardKind = (typeof CARD_KINDS)[number]

export type NoteCard = { summary: string; language: 'en' | 'ru' | 'no' | 'mixed'; kind: CardKind; headings: string[] }

/** A note with fewer of its own words than this is a stub: no model call. */
const STUB_WORDS = 15
/** What the model reads of a note. */
const READ_CHARS = 2500

export const contentHash = (content: string): string => createHash('sha1').update(content).digest('hex')

const words = (text: string): number => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0

/** The note's language by its letters: Cyrillic, Norwegian letters and words, or English. */
export function languageOfText(text: string): NoteCard['language'] {
  const letters = text.match(/\p{L}/gu) ?? []
  if (letters.length === 0) return 'en'
  const cyr = letters.filter((l) => /\p{Script=Cyrillic}/u.test(l)).length / letters.length
  if (cyr > 0.7) return 'ru'
  if (cyr > 0.2) return 'mixed'
  return /[æøå]/i.test(text) && /\b(og|ikke|jeg|eg|er|på|kva|korleis)\b/i.test(text) ? 'no' : 'en'
}

/** The text a template would have put there anyway: "- [ ]", "- Empty", headings. */
const ownText = (body: string): string =>
  body
    .split('\n')
    .filter((l) => !/^\s*#{1,6}\s/.test(l) && !/^\s*[-*]\s*(\[[ xX]?\]\s*)?(empty)?\s*$/i.test(l) && !/^---\s*$/.test(l))
    .join('\n')

/** The main headings: real ones of the top two levels, or the bold lines a short note uses instead. */
export function mainHeadings(title: string, content: string): string[] {
  const out: string[] = []
  for (const c of chunkNote(title, content)) for (const h of c.path) if (!out.includes(h)) out.push(h)
  for (const m of content.matchAll(/^\s*\*\*([^*\n]{1,60}?)\*\*\s*:?\s*$/gm)) {
    const h = m[1]!.trim().replace(/:$/, '')
    if (!out.includes(h)) out.push(h)
  }
  return out.slice(0, 8)
}

/** The card a note gets without the model: dailies and near-empty notes. Null when the model should read it. */
export function codeCard(notePath: string, title: string, content: string): NoteCard | null {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '')
  const own = ownText(body)
  const n = words(own)
  if (n >= STUB_WORDS && !isDaily(notePath)) return null
  const first =
    own
      .split('\n')
      .find((l) => l.trim() !== '')
      ?.trim() ?? ''
  return {
    summary: n === 0 ? 'Empty.' : first.slice(0, 160),
    language: languageOfText(own || title),
    kind: isDaily(notePath) ? 'daily' : 'stub',
    headings: mainHeadings(title, content),
  }
}

const CARD_SYSTEM = `You write a card for one note from a personal vault. JSON only: {"summary":"...","kind":"..."}
summary: 2-3 short sentences in English: what the note is about and what it holds (facts, decisions, lists, open questions). Name things as the note does.
kind: one of daily, log, project, learning, reference, list, stub. daily: a day's note. log: dated entries about work done. project: plans and state of a project. learning: study notes on a subject. reference: facts or how-to kept to look up. list: mostly links or items. stub: nearly empty.`

/** The card for a note: from code when it is trivial, else from the model. Null when the model failed. */
export async function makeCard(
  notePath: string,
  content: string,
  provider: BotModelProvider,
  model: string,
  signal: AbortSignal,
): Promise<NoteCard | null> {
  const title = path.basename(notePath).replace(/\.md$/i, '')
  const trivial = codeCard(notePath, title, content)
  if (trivial !== null) return trivial
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '')
  let raw = ''
  try {
    raw = await provider.complete(
      [{ role: 'user', content: `Note "${title}" (${notePath}):\n\n${body.slice(0, READ_CHARS)}` }],
      CARD_SYSTEM,
      {
        model,
        signal,
        json: true,
        maxTokens: 160,
      },
    )
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(/\{[\s\S]*\}/.exec(raw)?.[0] ?? '') as { summary?: unknown; kind?: unknown }
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
    if (summary === '') return null
    const kind = (CARD_KINDS as readonly unknown[]).includes(parsed.kind) ? (parsed.kind as CardKind) : 'reference'
    return { summary, language: languageOfText(ownText(body)), kind, headings: mainHeadings(title, content) }
  } catch {
    return null
  }
}

// ---- the background builder --------------------------------------------------------

export type CardsStatus = NoteCardsStatus

const IDLE_SECONDS = 60
const MIN_BATTERY = 20

/** Battery level and charging, from pmset; null on a Mac without a battery. Cached for a minute. */
let battery: { at: number; level: number | null; charging: boolean } | null = null
async function batteryLow(): Promise<boolean> {
  if (!powerMonitor.isOnBatteryPower()) return false
  if (battery === null || Date.now() - battery.at > 60_000) {
    const out = await new Promise<string>((resolve) => execFile('pmset', ['-g', 'batt'], (_e, stdout) => resolve(stdout ?? '')))
    const m = /(\d+)%;\s*([^;]+);/.exec(out)
    battery = { at: Date.now(), level: m === null ? null : Number(m[1]), charging: m !== null && /^charging|charged/i.test(m[2]!.trim()) }
  }
  return battery.level !== null && battery.level < MIN_BATTERY && !battery.charging
}

/** Notes that get cards: everything but chats, the app's state and the bots' excluded folders. */
export const cardable = (notes: readonly CatalogNote[], exclude: readonly string[]): CatalogNote[] =>
  notes.filter((n) => !isExcluded(n.path, [CHATS_FOLDER, path.dirname(BOTS_FOLDER), ...exclude]))

/** Every card the index holds for this model, by note path - only those that match the note's current content. */
export async function cardsFor(model: string, notes: readonly CatalogNote[]): Promise<Map<string, NoteCard>> {
  const response = await indexer({ kind: 'cards-get', model }, 30_000)
  const stored = response.kind === 'cards-result' ? response.cards : []
  const byHash = new Map(stored.map((c) => [c.hash, c]))
  const out = new Map<string, NoteCard>()
  for (const note of notes) {
    const read = await vaultFs.readFile(note.path)
    if (!read.ok) continue
    const hit = byHash.get(contentHash(read.content))
    if (hit !== undefined) out.set(note.path, JSON.parse(hit.card) as NoteCard)
  }
  return out
}

export type BuildOptions = {
  provider: BotModelProvider
  model: string
  exclude: readonly string[]
  /** Background mode: stop when the user comes back, the battery runs low, or `signal` aborts. */
  background: boolean
  signal: AbortSignal
  onProgress?: (status: CardsStatus) => void
}

/** Build the missing cards. Returns how many notes have a current card, out of how many. */
export async function buildCards(o: BuildOptions): Promise<CardsStatus> {
  const catalog = await indexer({ kind: 'bot-catalog' }, 30_000)
  const notes = cardable(catalog.kind === 'bot-catalog-result' ? catalog.notes : [], o.exclude)
  const stored = await indexer({ kind: 'cards-get', model: o.model }, 30_000)
  const have = new Set((stored.kind === 'cards-result' ? stored.cards : []).map((c) => c.hash))
  const todo: { path: string; content: string; hash: string }[] = []
  for (const note of notes) {
    const read = await vaultFs.readFile(note.path)
    if (!read.ok) continue
    const hash = contentHash(read.content)
    if (!have.has(hash)) todo.push({ path: note.path, content: read.content, hash })
  }
  const total = notes.length
  let done = total - todo.length
  const status = (state: CardsStatus['state']): CardsStatus => ({ done, total, state })
  o.onProgress?.(status(todo.length === 0 ? 'done' : 'running'))
  for (const note of todo) {
    if (o.signal.aborted) return status('idle')
    if (o.background) {
      if (await batteryLow()) return status('paused-battery')
      if (powerMonitor.getSystemIdleTime() < IDLE_SECONDS) return status('waiting')
    }
    const card = await makeCard(note.path, note.content, o.provider, o.model, o.signal)
    if (card === null) continue
    const stored: StoredCard = { hash: note.hash, model: o.model, path: note.path, card: JSON.stringify(card) }
    await indexer({ kind: 'card-put', card: stored }, 30_000)
    done++
    o.onProgress?.(status('running'))
  }
  return status(done >= total ? 'done' : 'idle')
}
