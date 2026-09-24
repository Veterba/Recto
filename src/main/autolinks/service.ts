import { app, BrowserWindow, net, powerMonitor } from 'electron'
import path from 'node:path'
import {
  DEFAULT_AUTOLINK_SETTINGS,
  type AutolinkAdded,
  type AutolinkSettings,
  type AutolinkStatus,
  type AutolinkSuggestions,
  type LinkScore,
  type ModelStatus,
  type PreviewLink,
} from '../../shared/autolinks'
import { VAULT_STATE_DIR } from '../../shared/ipc-contract'
import type { StateRow } from '../../embedder/protocol'
import type { AutolinkGraph } from '../../indexer/protocol'
import { normalizeName, parseNote, resolveLink } from '../../indexer/parse'
import { removeField } from '../../renderer/core/frontmatter'
import { linkTextFor, relatedTargets, writeRelated } from '../../renderer/core/related'
import { coerceTemplateSettings, isInFolder } from '../../renderer/core/templates'
import { send } from '../index-client'
import { readState, writeState } from '../state'
import { currentVault } from '../vault'
import * as vaultFs from '../vault-fs'
import { collectTrials } from './calibrate'
import { excludedFolders, isEligible, sameName } from './eligible'
import { ask, stopEmbedder } from './embedder-client'
import { downloadModel, MODEL_BYTES, modelPresent, OfflineError, receivedBytes } from './model'
import {
  addAuto,
  addConfirmed,
  lastRun,
  addRejected,
  coerceRecord,
  emptyRecord,
  isRejected,
  renameInRecord,
  setOutcome,
  setWritten,
  writtenTo,
  type AutolinkRecord,
} from './record'
import {
  AUTO_MAX_LINKS,
  autoEntries,
  CANDIDATES,
  calibrationReport,
  dot,
  effectiveAuto,
  isSettled,
  pick,
  planAuto,
  RAISE_STEP,
  reconcileWritten,
  SAMPLE_PAIRS,
  mentionableNames,
  score,
  shouldRaise,
  SUGGEST_FLOOR,
  vaultThresholds,
  type Scored,
  type ScoreTerms,
  type SourceFacts,
  type TargetFacts,
} from './score'
import {
  aliasesOf,
  chunk,
  chunkInput,
  countWords,
  hashText,
  noteTitle,
  ownLines,
  linkShare,
  ownText,
  plainText,
  snippet,
  templateLines,
  titleInput,
  type Chunk,
} from './text'

/**
 * Auto-links: the part that decides when, and writes.
 *
 * The embedder computes vectors and similarities; everything with an opinion
 * lives here - which notes are eligible, when one has settled, what a
 * candidate scores, what gets written. Three rules hold throughout:
 *
 *  - The only thing ever written to a note is its auto-links property, through
 *    the frontmatter editor, and only when the set actually changes.
 *  - Only targets the vault record says we wrote are ever removed. A note
 *    with no record owns its whole property.
 *  - The index is a cache. Rejections, confirmations, ownership and the
 *    feedback raise live in the vault, and rebuilding the index writes
 *    nothing to any note.
 */

const TICK_MS = 10 * 60_000
const FOCUS_THROTTLE_MS = 60_000
const WEEK_MS = 7 * 86_400_000
/** Backfill runs when nobody has touched the machine for this long. */
const IDLE_SECONDS = 30
const BATCH_CHUNKS = 16
/** Test seam: run the backfill on battery and while the user is active. */
const ANY_POWER = process.env['RECTO_AUTOLINKS_ANY_POWER'] === '1'
const REASON_CHARS = 120
/** Diagnostic: a target this thin, or this linked-to, is a tag, not a relation. */
const HUB_MIN_WORDS = 30
const HUB_SHARE = 0.2
const DUPLICATE_COSINE = 0.95
/** Hubs by content: more than half links, or too little of their own. */
const HUB_LINK_SHARE = 0.5
const HUB_MIN_OWN_WORDS = 30
/** A first run is a batch: at most this many notes written per scheduled run. */
const NOTES_PER_RUN = 20

// ---- vault files: settings and the record ---------------------------------

const SETTINGS = 'autolinks-settings'
const RECORD = 'autolinks'

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
}

export function readSettings(): AutolinkSettings {
  const raw = (readState(SETTINGS) ?? {}) as Partial<AutolinkSettings>
  const d = DEFAULT_AUTOLINK_SETTINGS
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    mode: raw.mode === 'off' || raw.mode === 'auto' || raw.mode === 'suggest' ? raw.mode : d.mode,
    quietMinutes: clampInt(raw.quietMinutes, 15, 240, d.quietMinutes),
    minWords: clampInt(raw.minWords, 1, 10_000, d.minWords),
    maxLinks: clampInt(raw.maxLinks, 1, 5, d.maxLinks),
    property:
      typeof raw.property === 'string' && /^[\p{L}\p{N}_][\p{L}\p{N}_ .-]*$/u.test(raw.property.trim())
        ? raw.property.trim()
        : d.property,
    excluded: Array.isArray(raw.excluded) ? raw.excluded.filter((f): f is string => typeof f === 'string') : [],
    tAuto: num(raw.tAuto),
    tSuggest: num(raw.tSuggest),
    thresholdsAt: num(raw.thresholdsAt),
    genericNames: Array.isArray(raw.genericNames)
      ? raw.genericNames.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
      : d.genericNames,
    diagnostic: raw.diagnostic ?? null,
    initializedAt: num(raw.initializedAt),
    reviewedAt: num(raw.reviewedAt),
  }
}

const saveSettings = (next: AutolinkSettings): void => void writeState(SETTINGS, next)

export const readRecord = (): AutolinkRecord => coerceRecord(readState(RECORD))
const saveRecord = (record: AutolinkRecord): void => void writeState(RECORD, record)

/** T_AUTO in force: the vault's measured base, raised by feedback. Null until measured. */
const tAutoNow = (s: AutolinkSettings, record: AutolinkRecord): number | null => effectiveAuto(s.tAuto, record.raisedBy)
const suggestBar = (s: AutolinkSettings): number => s.tSuggest ?? SUGGEST_FLOOR

/** Raise T_AUTO by 0.02 if too many recent auto-links were deleted. Returns the record, adjusted or not. */
function maybeRaise(record: AutolinkRecord): AutolinkRecord {
  const lastCount = record.adjustments.at(-1)?.count ?? 0
  const { raise, deleted } = shouldRaise(record.auto, lastCount, readSettings().tAuto, record.raisedBy)
  if (!raise) return record
  return {
    ...record,
    raisedBy: Math.round((record.raisedBy + RAISE_STEP) * 1000) / 1000,
    adjustments: [...record.adjustments, { at: Date.now(), by: RAISE_STEP, deleted, count: record.auto.length }],
  }
}

// ---- process state -------------------------------------------------------

let active = false
let timer: NodeJS.Timeout | null = null
let retryTimer: NodeJS.Timeout | null = null
let running = false
let again = false
let lastFocusTick = 0
/** Everything we know per note, mirrored from the embedder's table. */
let states = new Map<string, StateRow>()
let model: ModelStatus = { state: 'missing', bytes: MODEL_BYTES }
let downloading: AbortController | null = null
let backfill: AutolinkStatus['backfill'] = 'idle'
let calibrating: AutolinkStatus['calibrating'] = null
let eligibleCount = 0
/** Auto's first run in this vault is waiting for Settings: how many notes it would review. */
let reviewCount = 0
/** Every note in the vault as of the last pass, for writing links to them. */
let knownPaths = new Set<string>()

const modelRoot = (): string => path.join(app.getPath('userData'), 'models')

function push(channel: 'autolinks:status' | 'autolinks:changed' | 'autolinks:added', payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, payload)
}

export function status(): AutolinkStatus {
  const record = active ? readRecord() : emptyRecord()
  return {
    model,
    eligible: eligibleCount,
    embedded: [...states.values()].filter((s) => s.embeddedMtime !== null).length,
    backfill,
    calibrating,
    rejected: record.rejected.length,
    tAutoEffective: active ? tAutoNow(readSettings(), record) : null,
    feedback: {
      added: record.auto.length,
      deleted: record.auto.filter((a) => a.outcome === 'deleted').length,
      confirmed: record.auto.filter((a) => a.outcome === 'confirmed').length,
      raisedBy: record.raisedBy,
    },
    review: {
      pending: active && readSettings().mode === 'auto' && readSettings().reviewedAt === null,
      notes: reviewCount,
    },
    lastRun: (() => {
      const last = lastRun(record)
      if (last === null) return null
      const links = [...last.bySource.values()].reduce((n, t) => n + t.length, 0)
      return { at: last.run, links, notes: last.bySource.size }
    })(),
  }
}

const publish = (): void => push('autolinks:status', status())

/** Tell the renderer whose suggestions changed. */
const changed = (paths: string[]): void => {
  if (paths.length > 0) push('autolinks:changed', paths)
}

async function putState(rows: (Partial<StateRow> & { path: string })[]): Promise<void> {
  if (rows.length === 0) return
  for (const row of rows) {
    const prev = states.get(row.path) ?? {
      path: row.path,
      meanVec: null,
      ownWords: 0,
      evaluatedAt: null,
      embeddedMtime: null,
      suggested: [],
    }
    states.set(row.path, { ...prev, ...row })
  }
  await ask({ kind: 'state-put', rows }, 'ok')
}

// ---- the vault, as auto-links sees it --------------------------------------

type Note = {
  mtime: number
  text: string
  words: number
  own: string
  /** Own text with links removed: what the title bonus looks for a name in. */
  plain: string
  /** Share of the note's words that sit inside links. */
  links: number
  chunks: Chunk[]
  title: string
}

type Context = {
  settings: AutolinkSettings
  graph: AutolinkGraph
  all: Set<string>
  eligible: string[]
  eligibleSet: Set<string>
  byName: Map<string, string[]>
  out: Map<string, Set<string>>
  inDegree: Map<string, number>
  tags: Map<string, Set<string>>
  template: Set<string>
}

/** Files read and prepared, keyed by path, valid while the mtime matches. */
const notes = new Map<string, Note>()
/** The mtime each note had when it was last checked for settling. */
const checked = new Map<string, number>()

async function context(settings: AutolinkSettings): Promise<Context> {
  const response = await send({ kind: 'autolink-graph' }, 30_000)
  if (response.kind !== 'autolink-graph-result') throw new Error('index did not answer')
  const graph = response.graph
  const templates = coerceTemplateSettings(readState('templates'))
  const excluded = excludedFolders(templates, settings.excluded)
  const all = new Set(graph.notes.map((n) => n.path))
  const inFolders = graph.notes.filter((n) => isEligible(n.path, excluded))

  const byName = new Map<string, string[]>()
  for (const p of all) {
    const key = normalizeName(p.slice(p.lastIndexOf('/') + 1))
    byName.set(key, [...(byName.get(key) ?? []), p])
  }
  const tags = new Map<string, Set<string>>()
  for (const { path: p, tag } of graph.tags) tags.set(p, (tags.get(p) ?? new Set()).add(tag.toLowerCase()))

  const templateTexts: string[] = []
  for (const p of all) {
    if (!isInFolder(p, templates.folder)) continue
    const read = await vaultFs.readFile(p)
    if (read.ok) templateTexts.push(read.content)
  }

  const template = templateLines(templateTexts)
  // Link-list notes are maps of other notes, not topics: a note that is more
  // than half links, or has under 30 words of its own, is neither a source
  // nor a target. This is what keeps `Tags`, MOCs and index notes out.
  const thin = new Set<string>()
  for (const n of graph.notes) {
    const note = await readNote({ template }, n.path, n.mtime)
    if (note === null || note.links > HUB_LINK_SHARE || note.words < HUB_MIN_OWN_WORDS) thin.add(n.path)
  }
  const eligible = inFolders.map((n) => n.path).filter((p) => !thin.has(p))

  // A link to such a note is a tag, not a relation, so it is not evidence
  // either: it counts neither towards co-citation nor towards in-degree.
  const out = new Map<string, Set<string>>()
  const inDegree = new Map<string, number>()
  for (const { source, target } of graph.links) {
    if (source === target || thin.has(target)) continue
    const set = out.get(source) ?? new Set()
    set.add(target)
    out.set(source, set)
    inDegree.set(target, (inDegree.get(target) ?? 0) + 1)
  }
  const partial = { settings, graph, all, byName, out, inDegree, tags, template }

  eligibleCount = eligible.length
  knownPaths = all
  return { ...partial, eligible, eligibleSet: new Set(eligible) }
}

async function readNote(ctx: Pick<Context, 'template'>, p: string, mtime: number): Promise<Note | null> {
  const cached = notes.get(p)
  if (cached !== undefined && cached.mtime === mtime) return cached
  const read = await vaultFs.readFile(p)
  if (!read.ok) return null
  const lines = ownLines(read.content, ctx.template)
  const own = ownText(lines)
  const note: Note = {
    mtime,
    text: read.content,
    words: countWords(own),
    own,
    plain: plainText(lines),
    links: linkShare(read.content, ctx.template),
    chunks: chunk(lines),
    title: titleInput(p, read.content),
  }
  notes.set(p, note)
  return note
}

const resolve = (ctx: Context, target: string): string | null => resolveLink(target, ctx.byName, ctx.all)

/** Links in the auto-links property, resolved. */
const propertyLinks = (ctx: Context, text: string): Set<string> =>
  new Set(relatedTargets(text, ctx.settings.property).flatMap((t) => resolve(ctx, t) ?? []))

/** Links anywhere in the note except the auto-links property, resolved. */
function linkedElsewhere(ctx: Context, text: string): Set<string> {
  const without = removeField(text.replace(/\r\n/g, '\n'), ctx.settings.property)
  return new Set(parseNote(without).links.flatMap((l) => resolve(ctx, l.target) ?? []))
}

const mtimeOf = (ctx: Context, p: string): number => ctx.graph.notes.find((n) => n.path === p)?.mtime ?? 0

async function targetFacts(ctx: Context, target: string): Promise<TargetFacts> {
  const note = await readNote(ctx, target, mtimeOf(ctx, target))
  // Another note by this name makes a mention ambiguous.
  const isUnique = (name: string): boolean =>
    (ctx.byName.get(normalizeName(name)) ?? []).every((other) => other === target)
  return {
    names: mentionableNames(
      [noteTitle(target), ...(note === null ? [] : aliasesOf(note.text))],
      isUnique,
      ctx.settings.genericNames,
    ),
    tags: ctx.tags.get(target) ?? new Set(),
    out: ctx.out.get(target) ?? new Set(),
    inDegree: ctx.inDegree.get(target) ?? 0,
  }
}

const reasonOf = (note: Note, idx: number): string => snippet(note.chunks[idx]?.text ?? '', REASON_CHARS)

// ---- embedding -------------------------------------------------------------

async function embedNote(p: string, note: Note): Promise<number[] | null> {
  const pieces = [
    { idx: -1, hash: hashText(note.title), text: note.title },
    ...note.chunks.map((c, idx) => {
      const text = chunkInput(c)
      return { idx, hash: hashText(text), text }
    }),
  ]
  const { mean } = await ask({ kind: 'embed', path: p, pieces }, 'embedded', 300_000)
  await putState([{ path: p, embeddedMtime: note.mtime }])
  return mean
}

/**
 * Embed a note that has no vectors yet. After an index rebuild the note was
 * evaluated before and only the cache was lost: it is marked evaluated now,
 * and nothing is decided. Ownership is not touched - it lives in the vault
 * record, which a rebuild does not see. Returns the chunks it cost.
 */
async function embedMissing(ctx: Context, p: string, rebuilding: boolean): Promise<number> {
  const note = await readNote(ctx, p, mtimeOf(ctx, p))
  if (note === null) return 0
  const mean = await embedNote(p, note)
  if (rebuilding && states.get(p)?.evaluatedAt == null) {
    await putState([{ path: p, meanVec: mean, ownWords: note.words, evaluatedAt: Date.now() }])
  }
  return note.chunks.length + 1
}

/** Vectors gone but the vault was set up before: the index was rebuilt. Sticky until the backfill ends. */
async function detectRebuild(ctx: Context): Promise<boolean> {
  if ((await ask({ kind: 'meta-get', key: 'rebuild' }, 'meta')).value === '1') return true
  if (states.size > 0 || ctx.settings.initializedAt === null || ctx.eligible.length === 0) return false
  await ask({ kind: 'meta-set', key: 'rebuild', value: '1' }, 'ok')
  return true
}

/**
 * Bring vectors up to date. Notes that already have vectors and changed are
 * re-embedded once they are quiet (chunk hashes make that cheap). Notes that
 * have none - the first run, or a rebuilt index - are the backfill, which
 * runs only on AC power with nobody at the keyboard, 16 chunks at a time.
 *
 * Returns whether every eligible note has vectors, and whether this pass
 * finished a backfill.
 */
async function embedPass(ctx: Context, rebuilding: boolean): Promise<{ complete: boolean; finishedBackfill: boolean }> {
  const quietMs = ctx.settings.quietMinutes * 60_000
  const now = Date.now()
  const backlog: string[] = []
  for (const n of ctx.graph.notes) {
    if (!ctx.eligibleSet.has(n.path)) continue
    const st = states.get(n.path)
    if (st?.embeddedMtime === n.mtime) continue
    if (st?.embeddedMtime == null) backlog.push(n.path)
    else if (now - n.mtime >= quietMs) {
      const note = await readNote(ctx, n.path, n.mtime)
      if (note !== null) await embedNote(n.path, note)
    }
  }
  if (backlog.length === 0) {
    backfill = 'done'
    return { complete: true, finishedBackfill: false }
  }

  let i = 0
  while (i < backlog.length) {
    if (powerMonitor.isOnBatteryPower() && !ANY_POWER) {
      backfill = 'waiting-power'
      break
    }
    if (powerMonitor.getSystemIdleTime() < IDLE_SECONDS && !ANY_POWER) {
      backfill = 'waiting-idle'
      break
    }
    backfill = 'running'
    publish()
    let chunks = 0
    while (i < backlog.length && chunks < BATCH_CHUNKS) {
      chunks += await embedMissing(ctx, backlog[i++]!, rebuilding)
    }
    publish()
  }
  if (i >= backlog.length) {
    backfill = 'done'
    return { complete: true, finishedBackfill: true }
  }
  // Not now: look again soon rather than in ten minutes.
  if (retryTimer === null) {
    retryTimer = setTimeout(() => {
      retryTimer = null
      void tick()
    }, backfill === 'waiting-idle' ? 15_000 : 60_000)
  }
  return { complete: false, finishedBackfill: false }
}

/**
 * T_AUTO and T_SUGGEST: sem over 500 random eligible pairs - the 99th and
 * 95th percentiles, never under 0.75 and 0.70. What "similar" means differs
 * by vault, so it is measured, not assumed.
 */
async function measureThresholds(ctx: Context): Promise<void> {
  const sources = ctx.eligible.filter((p) => (notes.get(p)?.chunks.length ?? 1) > 0)
  if (sources.length < 2) return
  const pairs: [string, string][] = []
  for (let i = 0; i < SAMPLE_PAIRS * 4 && pairs.length < SAMPLE_PAIRS; i++) {
    const a = sources[Math.floor(Math.random() * sources.length)]!
    const b = ctx.eligible[Math.floor(Math.random() * ctx.eligible.length)]!
    if (a !== b) pairs.push([a, b])
  }
  const { sems } = await ask({ kind: 'sample', pairs }, 'sems')
  saveSettings({ ...readSettings(), ...vaultThresholds(sems), thresholdsAt: Date.now() })
}

// ---- evaluation --------------------------------------------------------------

/**
 * What became of what we wrote: moved elsewhere in the note (pinned, the
 * user's now), deleted by hand (rejected), or pointing at a note that is gone
 * (dropped from the property). Returns the targets still ours.
 */
async function reconcile(ctx: Context, p: string, note: Note): Promise<string[]> {
  let record = readRecord()
  const written = writtenTo(record, p)
  if (written.length === 0) return []
  const gone = written.filter((t) => !ctx.all.has(t))
  const living = written.filter((t) => ctx.all.has(t))
  const { still, pinned, rejected } = reconcileWritten(living, propertyLinks(ctx, note.text), linkedElsewhere(ctx, note.text))

  // Passive feedback: a deleted auto-link is a rejection, one moved into the
  // note's own links a confirmation.
  for (const t of rejected) record = setOutcome(addRejected(record, p, t), p, t, 'deleted')
  for (const t of pinned) record = setOutcome(addConfirmed(record, p, t), p, t, 'confirmed')
  if (rejected.length > 0) record = maybeRaise(record)
  if (gone.length > 0) {
    // The link to a deleted or archived note no longer resolves; drop exactly
    // the entries that pointed at it.
    const goneNames = new Set(gone.map((t) => normalizeName(noteTitle(t))))
    const entries = relatedTargets(note.text, ctx.settings.property)
    const kept = entries.filter((e) => resolve(ctx, e) !== null || !goneNames.has(normalizeName(noteTitle(e))))
    if (kept.length !== entries.length) await writeProperty(p, note.text, ctx.settings.property, kept)
  }
  if (gone.length + pinned.length + rejected.length > 0) saveRecord(setWritten(record, p, still))
  return still
}

async function writeProperty(p: string, text: string, property: string, entries: string[]): Promise<void> {
  const next = writeRelated(text, property, entries)
  if (next === text) return
  // Not marked as a self-write: if the note is open, the editor should reload.
  const written = await vaultFs.writeFile(p, next)
  if (!written.ok) throw new Error(written.error ?? `could not write ${p}`)
  notes.delete(p)
}

type Candidate = Scored & { bestChunk: number; terms: ScoreTerms }

/**
 * Score a note's candidates: no side effects, so the preview can run it on a
 * vault it has not written to. `ours` are the targets we wrote before; they
 * come back through `include` to be re-scored for hysteresis.
 */
async function decide(ctx: Context, p: string, note: Note, ours: readonly string[]): Promise<Candidate[]> {
  const elsewhere = linkedElsewhere(ctx, note.text)
  const inProperty = propertyLinks(ctx, note.text)
  const record = readRecord()
  const allowed = ctx.eligible.filter(
    (t) =>
      t !== p &&
      !sameName(p, t) &&
      !elsewhere.has(t) &&
      !inProperty.has(t) &&
      !isRejected(record, p, t) &&
      !linksTo(ctx, record, t, p),
  )
  const { matches } = await ask({ kind: 'similar', path: p, allowed, include: [...ours], top: CANDIDATES }, 'matches')
  const source: SourceFacts = { ownText: note.plain, tags: ctx.tags.get(p) ?? new Set(), out: ctx.out.get(p) ?? new Set() }
  const out: Candidate[] = []
  for (const m of matches) {
    const terms = score(m.sem, m.path, source, await targetFacts(ctx, m.path))
    out.push({ target: m.path, sem: m.sem, total: terms.total, bestChunk: m.bestChunk, terms })
  }
  return out
}

/**
 * Does `from` already link to `to` - by hand anywhere in the note, or by an
 * auto-link? Then `to -> from` adds nothing: backlinks already show it. The
 * record covers links written earlier in this same run, before the index has
 * caught up with them.
 */
const linksTo = (ctx: Context, record: AutolinkRecord, from: string, to: string): boolean =>
  (ctx.out.get(from)?.has(to) ?? false) || writtenTo(record, from).includes(to)

const linkScore = (c: Candidate): LinkScore => ({
  sem: c.sem,
  total: c.total,
  title: c.terms.title,
  tags: c.terms.tags,
  cocite: c.terms.cocite,
  hub: c.terms.hub,
})

/** Returns whether it wrote to the note. */
async function evaluate(
  ctx: Context,
  p: string,
  note: Note,
  mean: number[] | null,
  reverseToo: boolean,
  run: number,
): Promise<boolean> {
  let wrote = false
  const s = ctx.settings
  const ours = await reconcile(ctx, p, note)
  // reconcile may have rewritten the file; work from what is on disk now.
  const current = notes.get(p) ?? (await readNote(ctx, p, mtimeOf(ctx, p))) ?? note
  const oursSet = new Set(ours)
  const scored = await decide(ctx, p, current, ours)
  const tAuto = tAutoNow(s, readRecord())
  const now = Date.now()

  if (s.mode === 'auto' && tAuto !== null) {
    const next = planAuto(ours, scored, tAuto, AUTO_MAX_LINKS)
    const same = next.length === ours.length && next.every((t) => oursSet.has(t))
    if (!same) {
      const entries = autoEntries(
        relatedTargets(current.text, s.property),
        (e) => resolve(ctx, e),
        oursSet,
        next,
        (t) => linkTextFor(t, ctx.all),
      )
      await writeProperty(p, current.text, s.property, entries)
      wrote = true
      const byTarget = new Map(scored.map((c) => [c.target, c]))
      const added = next.filter((t) => !oursSet.has(t))
      saveRecord(
        addAuto(
          setWritten(readRecord(), p, next),
          added.map((target) => {
            const c = byTarget.get(target)!
            return { source: p, target, score: c.total, ...linkScore(c) }
          }),
          now,
          run,
        ),
      )
      if (added.length > 0) {
        const notice: AutolinkAdded = {
          path: p,
          name: noteTitle(p),
          targets: added.map((target) => ({ target, name: noteTitle(target) })),
        }
        push('autolinks:added', notice)
      }
    }
    await putState([{ path: p, meanVec: mean, ownWords: note.words, evaluatedAt: now, suggested: [] }])
  } else {
    const suggested = pick(
      scored.filter((c) => !oursSet.has(c.target)),
      suggestBar(s),
      s.maxLinks,
    ).map((c) => ({ target: c.target, score: c.total, reason: reasonOf(current, c.bestChunk) }))
    await putState([{ path: p, meanVec: mean, ownWords: note.words, evaluatedAt: now, suggested }])
  }
  changed([p])
  if (reverseToo) await suggestBack(ctx, p)
  return wrote
}

/**
 * A new note, evaluated for the first time: which older notes would now want
 * it in their top N? They get it as a suggestion - never a write, even in
 * Auto mode, because they are notes nobody is looking at.
 */
async function suggestBack(ctx: Context, p: string): Promise<void> {
  const s = ctx.settings
  const record = readRecord()
  const linkingHere = new Set(ctx.graph.links.filter((l) => l.target === p).map((l) => l.source))
  const allowed = ctx.eligible.filter(
    (o) => o !== p && !sameName(o, p) && !linkingHere.has(o) && !isRejected(record, o, p) && !linksTo(ctx, record, p, o),
  )
  const { matches } = await ask({ kind: 'reverse', path: p, allowed, top: CANDIDATES }, 'matches')
  const facts = await targetFacts(ctx, p)
  const touched: (Partial<StateRow> & { path: string })[] = []
  for (const m of matches) {
    const other = await readNote(ctx, m.path, mtimeOf(ctx, m.path))
    if (other === null || other.words < s.minWords) continue
    if (m.sem < suggestBar(s)) continue
    const terms = score(m.sem, p, { ownText: other.plain, tags: ctx.tags.get(m.path) ?? new Set(), out: ctx.out.get(m.path) ?? new Set() }, facts)
    const existing = (states.get(m.path)?.suggested ?? []).filter((x) => x.target !== p)
    // Only if it beats what that note already has.
    const ranked = [...existing, { target: p, score: terms.total, reason: reasonOf(other, m.bestChunk) }]
      .sort((a, b) => b.score - a.score)
      .slice(0, s.maxLinks)
    if (!ranked.some((x) => x.target === p)) continue
    touched.push({ path: m.path, suggested: ranked })
  }
  await putState(touched)
  changed(touched.map((t) => t.path))
}

async function pass(): Promise<void> {
  let settings = readSettings()
  if (settings.mode === 'off' || !modelPresent(modelRoot())) return
  let ctx = await context(settings)

  // Notes that left the vault, or the eligible set, leave the tables.
  const stale = [...states.keys()].filter((p) => !ctx.eligibleSet.has(p))
  if (stale.length > 0) {
    await ask({ kind: 'forget', paths: stale }, 'ok')
    for (const p of stale) states.delete(p)
  }

  const rebuilding = await detectRebuild(ctx)
  const { complete, finishedBackfill } = await embedPass(ctx, rebuilding)
  publish()
  if (!complete) return
  if (rebuilding) await ask({ kind: 'meta-set', key: 'rebuild', value: null }, 'ok')
  // Set only once the first backfill is finished, so that the first real
  // evaluation of the whole vault is not mistaken for a stream of new notes.
  if (settings.initializedAt === null) saveSettings({ ...readSettings(), initializedAt: Date.now() })
  if (finishedBackfill || settings.tAuto === null || Date.now() - (settings.thresholdsAt ?? 0) > WEEK_MS) {
    await measureThresholds(ctx)
  }
  settings = readSettings()
  ctx = { ...ctx, settings }

  const quietMs = settings.quietMinutes * 60_000
  const now = Date.now()

  // Auto writes nothing in a vault until Settings has shown what it would do.
  // Until then this pass only counts the notes its first run would review.
  if (settings.mode === 'auto' && settings.reviewedAt === null) {
    reviewCount = 0
    for (const n of ctx.graph.notes) {
      if (!ctx.eligibleSet.has(n.path) || now - n.mtime < quietMs) continue
      if ((notes.get(n.path)?.words ?? 0) >= settings.minWords) reviewCount++
    }
    return
  }
  reviewCount = 0

  const record = readRecord()
  const initializedAt = settings.initializedAt ?? now
  // The first run in a vault is a backlog; it is spread over several runs so
  // no single one touches every file at once. The rest wait, unevaluated.
  let notesWritten = 0
  for (const n of ctx.graph.notes) {
    if (notesWritten >= NOTES_PER_RUN) break
    if (!ctx.eligibleSet.has(n.path)) continue
    const st = states.get(n.path) ?? null
    // Any different mtime, not only a newer one: a synced edit can arrive
    // with an older timestamp than our last look.
    const touched = st?.evaluatedAt == null || checked.get(n.path) !== n.mtime
    const targetGone = writtenTo(record, n.path).some((t) => !ctx.all.has(t))
    // Cheap checks first: most notes are neither due nor touched.
    if (!touched && !targetGone) continue
    const note = await readNote(ctx, n.path, n.mtime)
    if (note === null) continue
    // Deletes, moves and vanished targets are handled whether or not the
    // note is due for a new look.
    if (writtenTo(record, n.path).length > 0) await reconcile(ctx, n.path, note)
    if (now - n.mtime < quietMs) continue
    checked.set(n.path, n.mtime)
    if (note.words < settings.minWords) continue
    const mean = await embedNote(n.path, note)
    const settled = isSettled({
      now,
      mtime: n.mtime,
      quietMs,
      ownWords: note.words,
      minWords: settings.minWords,
      state: st === null ? null : { evaluatedAt: st.evaluatedAt, meanVec: st.meanVec, ownWords: st.ownWords },
      currentMean: mean,
    })
    if (!settled) continue
    // New since the vault was set up: tell older notes about it. A note that
    // merely was never looked at before (the first run) is not new.
    const isNew = st?.evaluatedAt == null && n.mtime > initializedAt
    if (await evaluate(ctx, n.path, note, mean, isNew, now)) notesWritten++
  }
}

export async function tick(): Promise<void> {
  if (!active) return
  if (running) {
    again = true
    return
  }
  running = true
  try {
    await pass()
  } catch (err) {
    console.error('[autolinks]', err)
  } finally {
    running = false
    publish()
    if (again) {
      again = false
      void tick()
    }
  }
}

// ---- lifecycle -------------------------------------------------------------

function onFocus(): void {
  const now = Date.now()
  if (now - lastFocusTick < FOCUS_THROTTLE_MS) return
  lastFocusTick = now
  // Offline earlier? Focus is a good moment to try the download again.
  if (model.state === 'waiting-network' && net.isOnline()) void download()
  void tick()
}

async function openEmbedder(vaultPath: string): Promise<void> {
  await ask({ kind: 'open', dbPath: path.join(vaultPath, VAULT_STATE_DIR, 'index.db'), modelDir: modelRoot() }, 'ok')
  states = new Map((await ask({ kind: 'state-all' }, 'state')).rows.map((r) => [r.path, r]))
}

/** Open for the current vault. Called once the index is open. */
export async function start(): Promise<void> {
  stop()
  const vault = currentVault()
  if (!vault) return
  active = true
  model = modelPresent(modelRoot())
    ? { state: 'ready', bytes: MODEL_BYTES }
    : receivedBytes(modelRoot()) > 0
      ? { state: 'waiting-network', received: receivedBytes(modelRoot()), bytes: MODEL_BYTES }
      : { state: 'missing', bytes: MODEL_BYTES }
  const settings = readSettings()
  if (settings.mode !== 'off' && model.state === 'ready') await openEmbedder(vault.path)
  else states = new Map()
  timer = setInterval(() => void tick(), TICK_MS)
  app.on('browser-window-focus', onFocus)
  publish()
  // Launch is a check too: notes that settled while the app was closed.
  void tick()
}

export function stop(): void {
  active = false
  if (timer !== null) clearInterval(timer)
  if (retryTimer !== null) clearTimeout(retryTimer)
  timer = null
  retryTimer = null
  app.off('browser-window-focus', onFocus)
  downloading?.abort()
  downloading = null
  notes.clear()
  checked.clear()
  states = new Map()
  stopEmbedder()
}

app.on('will-quit', stop)

// ---- what the renderer can ask -------------------------------------------

export async function updateSettings(patch: Partial<AutolinkSettings>): Promise<AutolinkSettings> {
  const before = readSettings()
  saveSettings({ ...before, ...patch })
  const saved = readSettings()
  if (before.mode === 'off' && saved.mode !== 'off') {
    if (model.state === 'missing') void download()
    else await start()
  }
  publish()
  return saved
}

export async function download(): Promise<void> {
  if (downloading !== null || model.state === 'ready') return
  const controller = new AbortController()
  downloading = controller
  const root = modelRoot()
  let last = 0
  model = { state: 'downloading', received: receivedBytes(root), bytes: MODEL_BYTES }
  publish()
  try {
    await downloadModel(
      root,
      (received) => {
        model = { state: 'downloading', received, bytes: MODEL_BYTES }
        // Progress at most five times a second - it crosses IPC.
        if (Date.now() - last > 200) {
          last = Date.now()
          publish()
        }
      },
      controller.signal,
    )
    model = { state: 'ready', bytes: MODEL_BYTES }
    downloading = null
    if (active) await start()
  } catch (err) {
    downloading = null
    if (controller.signal.aborted) return
    // Offline: wait quietly. Focus or the next click tries again - no loop.
    model =
      err instanceof OfflineError
        ? { state: 'waiting-network', received: receivedBytes(root), bytes: MODEL_BYTES }
        : { state: 'error', message: err instanceof Error ? err.message : String(err), bytes: MODEL_BYTES }
  }
  publish()
}

export function suggestionsFor(p: string): AutolinkSuggestions {
  const settings = readSettings()
  if (!active || settings.mode === 'off') return { property: settings.property, items: [] }
  const record = readRecord()
  return {
    property: settings.property,
    items: (states.get(p)?.suggested ?? [])
      .filter((x) => !isRejected(record, p, x.target) && knownPaths.has(x.target))
      .map((x) => ({ ...x, name: noteTitle(x.target), link: linkTextFor(x.target, knownPaths) })),
  }
}

/** The user clicked a chip; the renderer has already written the link. It is ours now, to track. */
export async function accept(source: string, target: string): Promise<void> {
  const record = readRecord()
  saveRecord(setWritten(record, source, [...new Set([...writtenTo(record, source), target])]))
  const st = states.get(source)
  if (st !== undefined) await putState([{ path: source, suggested: st.suggested.filter((x) => x.target !== target) }])
  changed([source])
}

/** The user dismissed a chip: never again for this pair. */
export async function reject(source: string, target: string): Promise<void> {
  saveRecord(addRejected(readRecord(), source, target))
  const st = states.get(source)
  if (st !== undefined) await putState([{ path: source, suggested: st.suggested.filter((x) => x.target !== target) }])
  changed([source])
  publish()
}

/**
 * Undo from the status-bar notice: take the links Auto just added back out,
 * and record them as rejections - the same as deleting them by hand.
 */
export async function undo(source: string, targets: string[]): Promise<void> {
  const settings = readSettings()
  const ctx = await context(settings)
  const read = await vaultFs.readFile(source)
  if (!read.ok) return
  let record = readRecord()
  const drop = new Set(targets.filter((t) => writtenTo(record, source).includes(t)))
  if (drop.size === 0) return
  const entries = relatedTargets(read.content, settings.property).filter((e) => {
    const r = resolve(ctx, e)
    return r === null || !drop.has(r)
  })
  await writeProperty(source, read.content, settings.property, entries)
  for (const t of drop) record = setOutcome(addRejected(record, source, t), source, t, 'deleted')
  record = setWritten(record, source, writtenTo(record, source).filter((t) => !drop.has(t)))
  saveRecord(maybeRaise(record))
  publish()
}

/** Take back everything the most recent Auto run wrote; each removal is a rejection. */
export async function undoLastRun(): Promise<number> {
  const last = lastRun(readRecord())
  if (last === null) return 0
  let links = 0
  for (const [source, targets] of last.bySource) {
    await undo(source, targets)
    links += targets.length
  }
  return links
}

/** Forget the "never again" list. The feedback history stays. */
export function clearRejections(): void {
  saveRecord({ ...readRecord(), rejected: [] })
  publish()
}

/**
 * Keep our records with a note that moved in the app. The link rewrite has
 * already fixed the text; this fixes the paths we hold, or the renamed target
 * would look deleted and its link would be dropped.
 */
export async function moved(from: string, to: string): Promise<void> {
  saveRecord(renameInRecord(readRecord(), from, to))
  if (!active || states.size === 0) return
  const map = (p: string): string => (p === from ? to : p.startsWith(`${from}/`) ? `${to}${p.slice(from.length)}` : p)
  const rows: (Partial<StateRow> & { path: string })[] = []
  const forget: string[] = []
  for (const [p, st] of [...states]) {
    const np = map(p)
    const suggested = st.suggested.map((x) => ({ ...x, target: map(x.target) }))
    const touched = suggested.some((x, i) => x.target !== st.suggested[i]?.target)
    if (np !== p) {
      // The vectors are keyed by path; the new path re-embeds from chunk
      // hashes on the next pass.
      forget.push(p)
      states.delete(p)
      rows.push({ ...st, path: np, suggested, embeddedMtime: null })
    } else if (touched) rows.push({ path: p, suggested })
  }
  if (forget.length > 0) await ask({ kind: 'forget', paths: forget }, 'ok')
  await putState(rows)
}

// ---- the manual-link check (a diagnostic) ----------------------------------

/**
 * Hide each manual link in turn and see whether it would come back in the top
 * 3. Only a diagnostic: in real vaults manual links are often tags pointing at
 * hubs, which say nothing about relatedness. Links to hubs (a target with
 * under 30 words of its own, or 20% of all links) and links between
 * near-duplicates (cosine >= 0.95) are left out. It sets no threshold.
 */
export async function calibrate(): Promise<void> {
  if (calibrating !== null) return
  const settings = readSettings()
  if (!modelPresent(modelRoot())) throw new Error('The model is not downloaded yet.')
  const vault = currentVault()
  if (!vault) return
  if (states.size === 0) await openEmbedder(vault.path)
  calibrating = { done: 0, total: 0 }
  publish()
  try {
    const ctx = await context(settings)
    // Needs every vector; it does not wait for idle or power. Missing ones go
    // through the backfill's own step, so running this right after an index
    // rebuild still marks notes rather than leaving them to be re-decided.
    const rebuilding = await detectRebuild(ctx)
    for (const p of ctx.eligible) {
      const st = states.get(p)
      if (st?.embeddedMtime === mtimeOf(ctx, p)) continue
      if (st?.embeddedMtime == null) await embedMissing(ctx, p, rebuilding)
      else {
        const note = await readNote(ctx, p, mtimeOf(ctx, p))
        if (note !== null) await embedNote(p, note)
      }
    }

    const read = new Map<string, Note>()
    for (const p of ctx.eligible) {
      const note = await readNote(ctx, p, mtimeOf(ctx, p))
      if (note !== null) read.set(p, note)
    }
    const { means } = await ask({ kind: 'means', paths: ctx.eligible }, 'means')
    const totalLinks = ctx.graph.links.length
    const isHub = (t: string): boolean =>
      (read.get(t)?.words ?? 0) < HUB_MIN_WORDS || (ctx.inDegree.get(t) ?? 0) >= HUB_SHARE * totalLinks
    const isDuplicate = (a: string, b: string): boolean => {
      const x = means[a]
      const y = means[b]
      return x !== undefined && y !== undefined && dot(x, y) >= DUPLICATE_COSINE
    }
    const record = readRecord()

    const trials = await collectTrials({
      eligible: ctx.eligible,
      manual: (p) => {
        const note = read.get(p)
        if (note === undefined || note.words < settings.minWords) return new Set()
        return new Set([...linkedElsewhere(ctx, note.text)].filter((t) => t !== p && ctx.eligibleSet.has(t)))
      },
      source: (p, hidden) => {
        const note = read.get(p)
        if (note === undefined) return null
        const out = new Set(ctx.out.get(p) ?? [])
        out.delete(hidden)
        return {
          // Links are not mentions, so the hidden link cannot hand its target the title bonus.
          ownText: note.plain,
          tags: ctx.tags.get(p) ?? new Set(),
          out,
        }
      },
      target: (p) => targetFacts(ctx, p),
      rejected: (a, b) => isRejected(record, a, b),
      skip: (a, b) => isHub(b) || isDuplicate(a, b) || sameName(a, b),
      similar: async (p, allowed) =>
        (await ask({ kind: 'similar', path: p, allowed, include: [], top: CANDIDATES }, 'matches')).matches,
      onProgress: (done, total) => {
        calibrating = { done, total }
        if (done % 10 === 0 || done === total) publish()
      },
    })

    saveSettings({ ...readSettings(), diagnostic: calibrationReport(trials, Date.now()) })
  } finally {
    calibrating = null
    publish()
  }
}

/**
 * What Auto's first run would write, without writing: every note it would
 * review, scored against T_AUTO exactly as the real run will. Shown in
 * Settings before anything is written.
 */
export async function preview(): Promise<{ notes: number; links: PreviewLink[] }> {
  const settings = readSettings()
  const vault = currentVault()
  if (!vault || !modelPresent(modelRoot())) return { notes: 0, links: [] }
  if (states.size === 0) await openEmbedder(vault.path)
  const ctx = await context(settings)
  const record = readRecord()
  const tAuto = tAutoNow(settings, record)
  if (tAuto === null) return { notes: 0, links: [] }
  const quietMs = settings.quietMinutes * 60_000
  const now = Date.now()
  const links: PreviewLink[] = []
  const planned = new Set<string>()
  let reviewed = 0
  for (const n of ctx.graph.notes) {
    if (!ctx.eligibleSet.has(n.path) || now - n.mtime < quietMs) continue
    const note = await readNote(ctx, n.path, n.mtime)
    if (note === null || note.words < settings.minWords) continue
    reviewed++
    const ours = writtenTo(record, n.path)
    // What the run itself would write so far: B -> A is skipped once A -> B is planned.
    const scored = (await decide(ctx, n.path, note, ours)).filter((c) => !planned.has(`${c.target}\u0000${n.path}`))
    const byTarget = new Map(scored.map((c) => [c.target, c]))
    for (const target of planAuto(ours, scored, tAuto, AUTO_MAX_LINKS)) {
      if (ours.includes(target)) continue
      planned.add(`${n.path}\u0000${target}`)
      links.push({ source: n.path, target, ...linkScore(byTarget.get(target)!) })
    }
  }
  return { notes: reviewed, links }
}

/** Settings has shown the first-run line: the next scheduled run may write. */
export function seen(): void {
  const settings = readSettings()
  if (settings.reviewedAt !== null) return
  saveSettings({ ...settings, reviewedAt: Date.now() })
  publish()
}

export const isActive = (): boolean => active
