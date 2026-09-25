import { app, BrowserWindow, net, powerMonitor } from 'electron'
import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  DEFAULT_TOPICS_SETTINGS,
  type ModelStatus,
  type TopicInfo,
  type TopicsPreview,
  type TopicsRunNotice,
  type TopicsSettings,
  type TopicsStatus,
} from '../../shared/topics'
import { VAULT_STATE_DIR } from '../../shared/ipc-contract'
import type { StateRow } from '../../embedder/protocol'
import type { AutolinkGraph } from '../../indexer/protocol'
import { normalizeName, resolveLink } from '../../indexer/parse'
import { linksIn, writeLinks } from '../../renderer/core/link-property'
import { coerceTemplateSettings, isInFolder } from '../../renderer/core/templates'
import { send } from '../index-client'
import { readState, writeState } from '../state'
import { devGuarded } from '../dev-guard'
import { currentVault } from '../vault'
import * as vaultFs from '../vault-fs'
import { excludedFolders, isEligible } from '../autolinks/eligible'
import { ask, stopEmbedder } from '../autolinks/embedder-client'
import { downloadModel, MODEL_BYTES, modelPresent, OfflineError, receivedBytes } from '../autolinks/model'
import { isSettled } from '../autolinks/score'
import {
  chunk,
  chunkInput,
  countWords,
  hashText,
  linkShare,
  ownLines,
  ownText,
  templateLines,
  titleInput,
  type Chunk,
} from '../autolinks/text'
import { assign, assignThreshold, continues, selectTopics, similarities } from './cluster'
import { dictionary } from './dictionary'
import { isEnglishNoun, lemmatizer } from './lemma'
import { language, nameable, nameCluster, nameText, vaultLanguage, type Lang } from './naming'
import { sameLink, switchLanguage, undoLast } from './runs'
import {
  addRun,
  allowed,
  dissolve,
  dissolving,
  isDeletedAgain,
  reject,
  byName,
  coerceState,
  pending,
  renamePath,
  setAssigned,
  setOwned,
  topicLink,
  topicNameOf,
  TOPICS_PROPERTY,
  type Change,
  type Topic,
  type TopicsState,
} from './state'
import { centroid, cosine } from './vectors'

/**
 * Topics: the machine groups notes; linking one note to another is left to
 * the user.
 *
 * The embedder keeps chunk vectors and turns them into note vectors; this
 * module decides. Rules that hold throughout:
 *
 *  - The only thing ever written is the `topics` property, through the
 *    guarded frontmatter editor, and only when it actually changes.
 *  - Only topics the state says we wrote are ever removed from a note.
 *  - Topics are built once (and on "Rebuild topics"); every other run only
 *    places settled notes into existing topics, so they stay stable.
 *  - The index is a cache; topics, ownership and blocks live in the vault.
 */

const TICK_MS = 10 * 60_000
const FOCUS_THROTTLE_MS = 60_000
/** Backfill runs when nobody has touched the machine for this long. */
const IDLE_SECONDS = 30
const BATCH_CHUNKS = 16
/** Test seam: run the backfill on battery and while the user is active. */
const ANY_POWER = process.env['RECTO_AUTOLINKS_ANY_POWER'] === '1'
/** Link lists and near-empty notes are not about anything: never a member. */
const HUB_LINK_SHARE = 0.5
const HUB_MIN_OWN_WORDS = 30
/** A run writes to at most this many notes, so a first run spreads over a few. */
const NOTES_PER_RUN = 20
const SAMPLE_MEMBERS = 3
/** The property the old pairwise auto-links were written to. */
const OLD_PROPERTY = 'related'

// ---- vault files --------------------------------------------------------------

const SETTINGS = 'topics-settings'
const STATE = 'topics'

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
}

export function readSettings(): TopicsSettings {
  const raw = (readState(SETTINGS) ?? {}) as Partial<TopicsSettings>
  const d = DEFAULT_TOPICS_SETTINGS
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : d.enabled,
    quietMinutes: clampInt(raw.quietMinutes, 15, 240, d.quietMinutes),
    minWords: clampInt(raw.minWords, 30, 10_000, d.minWords),
    excluded: Array.isArray(raw.excluded) ? raw.excluded.filter((f): f is string => typeof f === 'string') : [],
    initializedAt: num(raw.initializedAt),
    reviewedAt: num(raw.reviewedAt),
  }
}

const saveSettings = (next: TopicsSettings): void => void writeState(SETTINGS, next)
export const readTopics = (): TopicsState => coerceState(readState(STATE))
const saveTopics = (s: TopicsState): void => void writeState(STATE, s)

// ---- process state ------------------------------------------------------------

let active = false
let timer: NodeJS.Timeout | null = null
let retryTimer: NodeJS.Timeout | null = null
let running = false
let again = false
let lastFocusTick = 0
/** Per note, mirrored from the embedder's table: vectors' freshness and the settle record. */
let states = new Map<string, StateRow>()
let model: ModelStatus = { state: 'missing', bytes: MODEL_BYTES }
let downloading: AbortController | null = null
let backfill: TopicsStatus['backfill'] = 'idle'
let eligibleCount = 0
/** The first run is waiting for Settings: how many notes it would review. */
let reviewCount = 0

const modelRoot = (): string => process.env['RECTO_MODEL_DIR'] ?? path.join(app.getPath('userData'), 'models')
/** The naming dictionaries: beside the app when packaged (extraResources), in the repo in development. */
const dictionaries = (): string =>
  app.isPackaged ? path.join(process.resourcesPath, 'dictionaries') : path.join(app.getAppPath(), 'resources', 'dictionaries')

function push(channel: 'topics:status' | 'topics:run', payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, payload)
}

export function status(): TopicsStatus {
  const state = active ? readTopics() : null
  const last = state?.runs.at(-1) ?? null
  const settings = active ? readSettings() : DEFAULT_TOPICS_SETTINGS
  return {
    model,
    eligible: eligibleCount,
    embedded: [...states.values()].filter((s) => s.embeddedMtime !== null).length,
    backfill,
    review: { pending: active && settings.enabled && settings.reviewedAt === null, notes: reviewCount, devGuarded: devGuarded() },
    lastRun: last === null ? null : { at: last.at, notes: new Set(last.changes.map((c) => c.path)).size },
  }
}

const publish = (): void => push('topics:status', status())

async function putState(rows: (Partial<StateRow> & { path: string })[]): Promise<void> {
  if (rows.length === 0) return
  for (const row of rows) {
    const prev = states.get(row.path) ?? { path: row.path, meanVec: null, ownWords: 0, evaluatedAt: null, embeddedMtime: null }
    states.set(row.path, { ...prev, ...row })
  }
  await ask({ kind: 'state-put', rows }, 'ok')
}

// ---- the vault, as topics sees it ---------------------------------------------

type Note = {
  mtime: number
  text: string
  words: number
  own: string
  /** Share of the note's words that sit inside links. */
  links: number
  chunks: Chunk[]
  title: string
  /** What a topic may be named from (see naming), and the language it is in. */
  prose: string
  lang: Lang
  /** Its nameable nouns, lemmatized on first use. */
  terms: string[] | null
}

type Context = {
  settings: TopicsSettings
  graph: AutolinkGraph
  all: Set<string>
  /** Notes that may have topics, sorted - the order everything is computed in. */
  eligible: string[]
  eligibleSet: Set<string>
  byName: Map<string, string[]>
  template: Set<string>
  /** Eligible notes per language. */
  languages: Partial<Record<Lang, number>>
}

/** Files read and prepared, keyed by path, valid while the mtime matches. */
const notes = new Map<string, Note>()
/** The mtime each note had when it was last checked for settling. */
const checked = new Map<string, number>()
/** Clusters already reported as having no name, so each is logged once per session (kept across restarts of the service). */
const unnamedLogged = new Set<string>()

async function readNote(ctx: Pick<Context, 'template'>, p: string, mtime: number): Promise<Note | null> {
  const cached = notes.get(p)
  if (cached !== undefined && cached.mtime === mtime) return cached
  const read = await vaultFs.readFile(p)
  if (!read.ok) return null
  const lines = ownLines(read.content, ctx.template)
  const own = ownText(lines)
  const prose = nameText(read.content)
  const note: Note = {
    mtime,
    text: read.content,
    words: countWords(own),
    own,
    links: linkShare(read.content, ctx.template),
    chunks: chunk(lines),
    title: titleInput(p, read.content),
    prose,
    lang: language(prose),
    terms: null,
  }
  notes.set(p, note)
  return note
}

async function context(settings: TopicsSettings): Promise<Context> {
  const response = await send({ kind: 'autolink-graph' }, 30_000)
  if (response.kind !== 'autolink-graph-result') throw new Error('index did not answer')
  const graph = response.graph
  const templates = coerceTemplateSettings(readState('templates'))
  const excluded = excludedFolders(templates, settings.excluded)
  const all = new Set(graph.notes.map((n) => n.path))

  const byName = new Map<string, string[]>()
  for (const p of all) {
    const key = normalizeName(p.slice(p.lastIndexOf('/') + 1))
    byName.set(key, [...(byName.get(key) ?? []), p])
  }
  const templateTexts: string[] = []
  for (const p of all) {
    if (!isInFolder(p, templates.folder)) continue
    const read = await vaultFs.readFile(p)
    if (read.ok) templateTexts.push(read.content)
  }
  const template = templateLines(templateTexts)

  // Daily notes, templates, chats, cards, attachments and the user's folders
  // are out; so are link lists and near-empty notes (hubs, not topics); and a
  // note needs enough words of its own to be about something.
  const eligible: string[] = []
  for (const n of graph.notes) {
    if (!isEligible(n.path, excluded)) continue
    const note = await readNote({ template }, n.path, n.mtime)
    if (note === null || note.links > HUB_LINK_SHARE || note.words < HUB_MIN_OWN_WORDS) continue
    if (note.words >= settings.minWords) eligible.push(n.path)
  }
  eligible.sort()
  eligibleCount = eligible.length
  const languages: Partial<Record<Lang, number>> = {}
  for (const p of eligible) {
    const lang = notes.get(p)?.lang
    if (lang !== undefined) languages[lang] = (languages[lang] ?? 0) + 1
  }
  return { settings, graph, all, eligible, eligibleSet: new Set(eligible), byName, template, languages }
}

const mtimeOf = (ctx: Context, p: string): number => ctx.graph.notes.find((n) => n.path === p)?.mtime ?? 0
const quiet = (ctx: Context, p: string, now: number): boolean => now - mtimeOf(ctx, p) >= ctx.settings.quietMinutes * 60_000

/** The topic ids a note's `topics` property holds right now. */
const fileTopics = (state: TopicsState, text: string): string[] =>
  linksIn(text, TOPICS_PROPERTY).flatMap((link) => {
    const name = topicNameOf(link)
    const topic = name === null ? undefined : byName(state, name)
    return topic === undefined ? [] : [topic.id]
  })

// ---- embedding ------------------------------------------------------------------

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
 * looked at before and only the cache was lost: it is marked evaluated now,
 * and nothing is decided. Returns the chunks it cost.
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
 * Bring vectors up to date. Changed notes are re-embedded once quiet (chunk
 * hashes make that cheap); notes with none are the backfill, which runs only on
 * AC power with nobody at the keyboard, 16 chunks at a time. Returns whether
 * every eligible note has vectors.
 */
async function embedPass(ctx: Context, rebuilding: boolean): Promise<boolean> {
  const now = Date.now()
  const backlog: string[] = []
  for (const p of ctx.eligible) {
    const st = states.get(p)
    const mtime = mtimeOf(ctx, p)
    if (st?.embeddedMtime === mtime) continue
    if (st?.embeddedMtime == null) backlog.push(p)
    else if (quiet(ctx, p, now)) {
      const note = await readNote(ctx, p, mtime)
      if (note !== null) await embedNote(p, note)
    }
  }
  if (backlog.length === 0) {
    backfill = 'done'
    return true
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
    while (i < backlog.length && chunks < BATCH_CHUNKS) chunks += await embedMissing(ctx, backlog[i++]!, rebuilding)
    publish()
  }
  if (i >= backlog.length) {
    backfill = 'done'
    return true
  }
  if (retryTimer === null) {
    retryTimer = setTimeout(() => {
      retryTimer = null
      void tick()
    }, backfill === 'waiting-idle' ? 15_000 : 60_000)
  }
  return false
}

const noteVectors = async (paths: string[]): Promise<Record<string, number[]>> =>
  paths.length === 0 ? {} : (await ask({ kind: 'note-vectors', paths }, 'note-vectors', 120_000)).vectors

// ---- deciding ---------------------------------------------------------------------

/** Every note's topics as they stand: the machine's decisions plus what the user typed. */
function membership(state: TopicsState, ctx: Context): Map<string, Set<string>> {
  const members = new Map<string, Set<string>>(state.topics.map((t) => [t.id, new Set<string>()]))
  for (const p of ctx.eligible) {
    const note = notes.get(p)
    const ids = new Set([...(state.assigned[p] ?? []).filter((id) => allowed(state, p, id)), ...(note ? fileTopics(state, note.text) : [])])
    for (const id of ids) members.get(id)?.add(p)
  }
  return members
}

/** A note's nameable nouns, lemmatized once per version of the note. */
async function termsOf(p: string): Promise<string[]> {
  const note = notes.get(p)
  if (note === undefined) return []
  if (note.terms === null) {
    const lemmas = (await lemmatizer(dictionaries()))(note.prose, note.lang)
    note.terms = lemmas.filter((w) => nameable(w, note.lang))
  }
  return note.terms
}

/**
 * A name for a cluster in the vault's language `lang`, or null - and then it
 * is not a topic (see naming.nameCluster: candidates in the cluster's own
 * language, translated when that is not `lang`).
 */
async function nameFor(
  ctx: Context,
  members: readonly string[],
  lang: Lang,
  center: ArrayLike<number>,
  taken: ReadonlySet<string>,
): Promise<string | null> {
  const own: { lang: Lang; terms: string[]; prose: string }[] = []
  for (const p of members) {
    const note = notes.get(p)
    if (note !== undefined) own.push({ lang: note.lang, terms: await termsOf(p), prose: note.prose })
  }
  const vault: string[][] = []
  for (const p of ctx.eligible) vault.push(await termsOf(p))
  const named = await nameCluster({
    members: own,
    vault,
    vaultLang: lang,
    center,
    taken,
    embed: async (terms) => (await ask({ kind: 'term-vectors', terms }, 'term-vectors', 120_000)).vectors,
    translate: dictionary(dictionaries()).translate,
    isNoun: (word, l) => l !== 'en' || isEnglishNoun(word),
  })
  if (named.failed !== undefined) {
    // Once per cluster: the same unnamed cluster comes back every run.
    const key = `${currentVault()?.path ?? ''}\u0000${lang}\u0000${[...members].sort().join('\u0000')}`
    if (!unnamedLogged.has(key)) {
      unnamedLogged.add(key)
      console.log(`[topics] ${members.length} notes in ${named.from}: no name in ${lang} (${named.failed})`)
    }
  }
  return named.name
}

/** The centroid of these notes' vectors. */
async function centerOf(paths: readonly string[]): Promise<Float32Array> {
  const vectors = await noteVectors([...paths])
  return centroid(paths.flatMap((p) => (vectors[p] === undefined ? [] : [vectors[p]!])))
}

/**
 * Cluster notes into topics (cluster.selectTopics: each cluster judged on its
 * own, no global cut), name them, and set T_ASSIGN from how close the members
 * of the named ones are. Old topics are continued where a cluster overlaps one
 * by half or more; deleted and dissolved ones are not brought back.
 */
async function build(ctx: Context, state: TopicsState, paths: string[]): Promise<TopicsState> {
  const vectors = await noteVectors(paths)
  const kept = paths.filter((p) => vectors[p] !== undefined)
  const vecs = kept.map((p) => vectors[p]!)
  const clusters = selectTopics(similarities(vecs), vecs.length)
  const named: number[][] = []

  // Names are in the vault's language; a change of it is a switch (see pass), never made here.
  const lang = state.language ?? vaultLanguage(ctx.languages, null)
  const old = [...membership(state, ctx).entries()].map(([id, members]) => ({ id, members }))
  const taken = new Set<string>()
  const topics: Topic[] = state.topics.filter((t) => t.renamedByUser)
  const names = new Set(topics.map((t) => t.name.toLowerCase()))
  const assigned: Record<string, string[]> = {}
  for (const cluster of clusters) {
    const members = cluster.map((i) => kept[i]!)
    const set = new Set(members)
    if (isDeletedAgain(state, set)) continue
    const continued = continues(set, old, taken)
    let topic = continued === null ? undefined : state.topics.find((t) => t.id === continued)
    if (topic !== undefined) taken.add(topic.id)
    if (topic === undefined || !topics.includes(topic)) {
      const name =
        topic?.name ?? (lang === null ? null : await nameFor(ctx, members, lang, centroid(cluster.map((i) => vecs[i]!)), names))
      // Nothing its notes share to be named by: not a topic.
      if (name === null) continue
      topic = topic ?? { id: newId(), name, renamedByUser: false }
      topics.push(topic)
    }
    names.add(topic.name.toLowerCase())
    named.push(cluster)
    for (const p of members) if (allowed(state, p, topic.id)) assigned[p] = [topic.id]
  }
  // Notes not in any cluster lose the machine's topics; what the user typed stays.
  return {
    ...state,
    builtAt: Date.now(),
    tAssign: assignThreshold(named.map((c) => c.map((i) => vecs[i]!))),
    topics,
    assigned,
    language: lang,
  }
}

const newId = (): string => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Centroids for every topic with members, cached in SQLite and recomputed when membership changes. */
async function centroids(state: TopicsState, ctx: Context): Promise<{ id: string; vector: number[] }[]> {
  const members = membership(state, ctx)
  const cached = new Map((await ask({ kind: 'centroids-get' }, 'centroids')).rows.map((r) => [r.id, r]))
  const rows: { id: string; members: string; vector: number[] }[] = []
  const stale: { id: string; key: string; paths: string[] }[] = []
  for (const [id, set] of members) {
    if (set.size === 0 || state.deleted.includes(id)) continue
    const paths = [...set].sort()
    const key = createHash('sha1').update(paths.join('\n')).digest('hex')
    const hit = cached.get(id)
    if (hit?.members === key) rows.push(hit)
    else stale.push({ id, key, paths })
  }
  if (stale.length > 0) {
    const vectors = await noteVectors([...new Set(stale.flatMap((s) => s.paths))])
    for (const s of stale) {
      const vs = s.paths.flatMap((p) => (vectors[p] === undefined ? [] : [vectors[p]!]))
      if (vs.length > 0) rows.push({ id: s.id, members: s.key, vector: [...centroid(vs)] })
    }
  }
  const changed = stale.length > 0 || rows.length !== cached.size
  if (changed) await ask({ kind: 'centroids-put', rows }, 'ok')
  return rows.map((r) => ({ id: r.id, vector: r.vector }))
}

/**
 * Place settled notes into existing topics, and turn the unplaced ones that
 * cluster together into new topics. Never rebuilds what exists.
 */
async function place(ctx: Context, state: TopicsState, settledPaths: string[]): Promise<TopicsState> {
  if (state.tAssign === null || state.builtAt === null) return state
  let next = state
  if (settledPaths.length > 0) {
    const cs = await centroids(next, ctx)
    const vectors = await noteVectors(settledPaths)
    for (const p of settledPaths) {
      const v = vectors[p]
      if (v === undefined) continue
      const picks = assign(v, cs.filter((c) => allowed(next, p, c.id)), next.tAssign!)
      next = setAssigned(next, p, picks)
    }
  }
  // The pool: evaluated notes with no topic at all. Topics are found over every
  // evaluated note, exactly as a build does - a selection over the pool alone
  // would judge clusters against different neighbours and find ones the build
  // did not - and a cluster made only of pool notes becomes a new topic. An
  // unchanged vault gives the same clusters, so nothing new appears.
  const members = membership(next, ctx)
  const placed = new Set([...members.values()].flatMap((s) => [...s]))
  const evaluated = ctx.eligible.filter((p) => states.get(p)?.evaluatedAt != null)
  const pool = new Set(evaluated.filter((p) => !placed.has(p)))
  if (pool.size >= 3) {
    const vectors = await noteVectors(evaluated)
    const kept = evaluated.filter((p) => vectors[p] !== undefined)
    const clusters = selectTopics(similarities(kept.map((p) => vectors[p]!)), kept.length)
    const names = new Set(next.topics.map((t) => t.name.toLowerCase()))
    const lang = next.language ?? vaultLanguage(ctx.languages, null)
    for (const cluster of clusters) {
      const paths = cluster.map((i) => kept[i]!)
      if (!paths.every((p) => pool.has(p)) || isDeletedAgain(next, new Set(paths)) || lang === null) continue
      const name = await nameFor(ctx, paths, lang, centroid(cluster.map((i) => vectors[kept[i]!]!)), names)
      if (name === null) continue
      names.add(name.toLowerCase())
      const topic: Topic = { id: newId(), name, renamedByUser: false }
      next = { ...next, topics: [...next.topics, topic], language: lang }
      for (const p of paths) next = setAssigned(next, p, [topic.id])
    }
  }
  return next
}

/**
 * The vault's language changed (another leads it by LANGUAGE_MARGIN notes):
 * every machine-named topic is named again in it, or removed if its notes give
 * no name there - all in one run, undone as one.
 */
async function languagePass(ctx: Context, state: TopicsState): Promise<TopicsState> {
  const to = vaultLanguage(ctx.languages, state.language, state.declinedLanguage)
  // The lead that was declined is gone: a later one may switch again.
  const declined = vaultLanguage(ctx.languages, state.language) === state.language ? null : state.declinedLanguage
  if (to === null || state.language === null || to === state.language) return { ...state, declinedLanguage: declined }
  const members = membership(state, ctx)
  const taken = new Set(state.topics.filter((t) => t.renamedByUser).map((t) => t.name.toLowerCase()))
  const names: Record<string, string | null> = {}
  const carriers: Record<string, string[]> = {}
  const texts = new Map<string, string>()
  for (const topic of state.topics) {
    if (topic.renamedByUser) continue
    const paths = [...(members.get(topic.id) ?? [])]
    const name = paths.length === 0 ? null : await nameFor(ctx, paths, to, await centerOf(paths), taken)
    if (name !== null) taken.add(name.toLowerCase())
    names[topic.id] = name
    carriers[topic.id] = await linkSources(topicLink(topic.name))
    for (const p of carriers[topic.id]!) {
      const read = await vaultFs.readFile(p)
      if (read.ok) texts.set(p, read.content)
    }
  }
  const switched = switchLanguage(state, to, names, carriers, (p) => texts.get(p) ?? null, Date.now())
  await writeAll(switched.writes)
  if (switched.run.changes.length > 0) notify(switched.run)
  return switched.state
}

async function writeAll(writes: ReadonlyMap<string, string>): Promise<void> {
  for (const [p, text] of writes) {
    // Not marked as a self-write: if the note is open, the editor should reload.
    const written = await vaultFs.writeFile(p, text)
    if (!written.ok) throw new Error(written.error ?? `could not write ${p}`)
    notes.delete(p)
  }
}

// ---- writing ----------------------------------------------------------------------

async function writeNote(p: string, text: string, property: string, entries: string[]): Promise<boolean> {
  const next = writeLinks(text, property, entries)
  if (next === text) return false
  // Not marked as a self-write: if the note is open, the editor should reload.
  const written = await vaultFs.writeFile(p, next)
  if (!written.ok) throw new Error(written.error ?? `could not write ${p}`)
  notes.delete(p)
  return true
}

/**
 * Bring up to 20 notes' `topics` to what was assigned: add the machine's
 * topics, remove the ones it wrote and no longer means, and leave every entry
 * the user typed where it is.
 */
async function writePending(ctx: Context, state: TopicsState): Promise<{ state: TopicsState; changes: Change[] }> {
  let next = state
  const changes: Change[] = []
  let written = 0
  for (const p of pending(state)) {
    if (written >= NOTES_PER_RUN) break
    const read = await vaultFs.readFile(p)
    if (!read.ok) {
      next = setOwned(setAssigned(next, p, []), p, [])
      continue
    }
    const want = (next.assigned[p] ?? []).filter((id) => allowed(next, p, id))
    const owned = next.owned[p] ?? []
    const name = (id: string): string | undefined => next.topics.find((t) => t.id === id)?.name
    const drop = owned.filter((id) => !want.includes(id)).flatMap((id) => (name(id) === undefined ? [] : [topicLink(name(id)!)]))
    let entries = linksIn(read.content, TOPICS_PROPERTY).filter((e) => !drop.some((d) => sameLink(d, e)))
    const add = want.flatMap((id) => (name(id) === undefined ? [] : [topicLink(name(id)!)])).filter((l) => !entries.some((e) => sameLink(e, l)))
    entries = [...entries, ...add]
    if (await writeNote(p, read.content, TOPICS_PROPERTY, entries)) {
      written++
      for (const link of add) {
        const topic = want.find((id) => sameLink(topicLink(name(id) ?? ''), link))
        changes.push({ path: p, property: TOPICS_PROPERTY, link, op: 'add', ...(topic === undefined ? {} : { topic }) })
      }
      for (const link of drop) changes.push({ path: p, property: TOPICS_PROPERTY, link, op: 'remove' })
    }
    next = setOwned(next, p, want)
  }
  return { state: next, changes }
}

/**
 * The user's edits, read back: a topic we wrote that is gone from a note was
 * removed by hand, and that note never gets it again.
 */
function reconcile(ctx: Context, state: TopicsState): TopicsState {
  let next = state
  for (const [p, owned] of Object.entries(state.owned)) {
    if (!ctx.all.has(p)) {
      next = setOwned(setAssigned(next, p, []), p, [])
      continue
    }
    const note = notes.get(p)
    if (note === undefined) continue
    const present = new Set(fileTopics(next, note.text))
    for (const id of owned) if (!present.has(id)) next = reject(next, p, id)
  }
  return next
}

/**
 * Topics the user took out of more than half of their notes are dissolved:
 * out of the notes that still have them, and never made again. The user's
 * decision, not a run - so no Undo brings them back.
 */
async function dissolvePass(state: TopicsState): Promise<TopicsState> {
  let next = state
  for (const id of dissolving(state)) {
    const topic = next.topics.find((t) => t.id === id)
    if (topic === undefined) continue
    const link = topicLink(topic.name)
    for (const [p, ids] of Object.entries(next.owned)) {
      if (!ids.includes(id)) continue
      const read = await vaultFs.readFile(p)
      if (read.ok) await writeNote(p, read.content, TOPICS_PROPERTY, linksIn(read.content, TOPICS_PROPERTY).filter((e) => !sameLink(e, link)))
    }
    next = dissolve(next, id)
    console.log(`[topics] dissolved "${topic.name}": removed by hand from most of its notes`)
  }
  return next
}

/**
 * The old pairwise auto-links, removed once: only the `related` entries the
 * app itself wrote (per `.recto/autolinks.json`), as one undoable run.
 */
async function removeOldAutoLinks(ctx: Context, state: TopicsState): Promise<TopicsState> {
  if (state.migratedRelated) return state
  const old = readState('autolinks') as { written?: Record<string, unknown> } | null
  const changes: Change[] = []
  for (const [p, targets] of Object.entries(old?.written ?? {})) {
    if (!Array.isArray(targets) || !ctx.all.has(p)) continue
    const ours = new Set(targets.filter((t): t is string => typeof t === 'string'))
    const read = await vaultFs.readFile(p)
    if (!read.ok) continue
    const entries = linksIn(read.content, OLD_PROPERTY)
    const drop = entries.filter((e) => {
      const resolved = resolveLink(e, ctx.byName, ctx.all)
      return resolved !== null && ours.has(resolved)
    })
    if (drop.length === 0) continue
    if (await writeNote(p, read.content, OLD_PROPERTY, entries.filter((e) => !drop.includes(e)))) {
      for (const link of drop) changes.push({ path: p, property: OLD_PROPERTY, link, op: 'remove' })
    }
  }
  let next: TopicsState = { ...state, migratedRelated: true }
  if (changes.length > 0) {
    const run = { at: Date.now(), label: `Removed ${changes.length} old auto-${changes.length === 1 ? 'link' : 'links'}`, changes }
    next = addRun(next, run)
    notify(run)
  }
  return next
}

function notify(run: { at: number; label: string; changes: Change[] }): void {
  const notice: TopicsRunNotice = { at: run.at, notes: new Set(run.changes.map((c) => c.path)).size, label: run.label }
  push('topics:run', notice)
}

const topicsLabel = (notesCount: number): string => `Topics added to ${notesCount} ${notesCount === 1 ? 'note' : 'notes'}`

// ---- the run ----------------------------------------------------------------------

async function pass(): Promise<void> {
  const settings = readSettings()
  const ctx = await context(settings)
  // Once, whatever the settings: take out the old pairwise links the app wrote.
  let state = await removeOldAutoLinks(ctx, readTopics())
  saveTopics(state)
  if (!settings.enabled || !modelPresent(modelRoot())) return

  const stale = [...states.keys()].filter((p) => !ctx.eligibleSet.has(p))
  if (stale.length > 0) {
    await ask({ kind: 'forget', paths: stale }, 'ok')
    for (const p of stale) states.delete(p)
  }
  const rebuilding = await detectRebuild(ctx)
  const complete = await embedPass(ctx, rebuilding)
  publish()
  if (!complete) return
  if (rebuilding) await ask({ kind: 'meta-set', key: 'rebuild', value: null }, 'ok')
  if (settings.initializedAt === null) saveSettings({ ...readSettings(), initializedAt: Date.now() })

  state = await dissolvePass(reconcile(ctx, state))
  const now = Date.now()
  // Nothing is written in a vault until Settings has shown what would be.
  if (readSettings().reviewedAt === null) {
    reviewCount = ctx.eligible.filter((p) => quiet(ctx, p, now)).length
    saveTopics(state)
    return
  }
  reviewCount = 0

  if (state.builtAt === null) {
    const settled = ctx.eligible.filter((p) => quiet(ctx, p, now))
    state = await build(ctx, state, settled)
    await markEvaluated(ctx, settled)
  } else {
    // A switch is its own run: saved, and undoable, before anything else is written.
    const before = state.runs.length
    state = await languagePass(ctx, state)
    saveTopics(state)
    if (state.runs.length !== before) return
    state = await place(ctx, state, await settledNotes(ctx, now))
  }

  const { state: after, changes } = await writePending(ctx, state)
  state = after
  if (changes.length > 0) {
    const run = { at: now, label: topicsLabel(new Set(changes.map((c) => c.path)).size), changes }
    state = addRun(state, run)
    notify(run)
  }
  saveTopics(state)
}

/** Record that these notes were looked at, so the settle rule leaves them alone until they change. */
async function markEvaluated(ctx: Context, paths: string[]): Promise<void> {
  const rows: (Partial<StateRow> & { path: string })[] = []
  for (const p of paths) {
    const note = notes.get(p)
    if (note === undefined) continue
    const mean = await embedNote(p, note)
    rows.push({ path: p, meanVec: mean, ownWords: note.words, evaluatedAt: Date.now() })
    checked.set(p, note.mtime)
  }
  await putState(rows)
}

/** Notes due for a look: quiet, and new or changed in meaning or length since the last one. */
async function settledNotes(ctx: Context, now: number): Promise<string[]> {
  const due: string[] = []
  for (const p of ctx.eligible) {
    const mtime = mtimeOf(ctx, p)
    const st = states.get(p) ?? null
    // Any different mtime, not only a newer one: a synced edit can arrive older.
    if (st?.evaluatedAt != null && checked.get(p) === mtime) continue
    if (!quiet(ctx, p, now)) continue
    checked.set(p, mtime)
    const note = notes.get(p)
    if (note === undefined) continue
    const mean = await embedNote(p, note)
    const settled = isSettled({
      now,
      mtime,
      quietMs: ctx.settings.quietMinutes * 60_000,
      ownWords: note.words,
      minWords: ctx.settings.minWords,
      state: st === null ? null : { evaluatedAt: st.evaluatedAt, meanVec: st.meanVec, ownWords: st.ownWords },
      currentMean: mean,
    })
    if (!settled) continue
    due.push(p)
    await putState([{ path: p, meanVec: mean, ownWords: note.words, evaluatedAt: now }])
  }
  return due
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
    console.error('[topics]', err)
  } finally {
    running = false
    publish()
    if (again) {
      again = false
      void tick()
    }
  }
}

// ---- lifecycle --------------------------------------------------------------------

function onFocus(): void {
  const now = Date.now()
  if (now - lastFocusTick < FOCUS_THROTTLE_MS) return
  lastFocusTick = now
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
  if (model.state === 'ready') await openEmbedder(vault.path)
  else states = new Map()
  timer = setInterval(() => void tick(), TICK_MS)
  app.on('browser-window-focus', onFocus)
  publish()
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

// ---- what the renderer can ask ------------------------------------------------------

export async function updateSettings(patch: Partial<TopicsSettings>): Promise<TopicsSettings> {
  const before = readSettings()
  saveSettings({ ...before, ...patch })
  const saved = readSettings()
  if (!before.enabled && saved.enabled) {
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
    model =
      err instanceof OfflineError
        ? { state: 'waiting-network', received: receivedBytes(root), bytes: MODEL_BYTES }
        : { state: 'error', message: err instanceof Error ? err.message : String(err), bytes: MODEL_BYTES }
  }
  publish()
}

/** The topics, with how many notes carry each. */
export async function list(): Promise<TopicInfo[]> {
  const vault = currentVault()
  if (!vault) return []
  const state = readTopics()
  const counts = new Map<string, number>()
  const sources = await Promise.all(state.topics.map((t) => linkSources(topicLink(t.name))))
  state.topics.forEach((t, i) => counts.set(t.id, sources[i]!.length))
  return state.topics
    .filter((t) => !state.deleted.includes(t.id))
    .map((t) => ({ id: t.id, name: t.name, notes: counts.get(t.id) ?? 0 }))
    .sort((a, b) => b.notes - a.notes || a.name.localeCompare(b.name))
}

async function linkSources(target: string): Promise<string[]> {
  const response = await send({ kind: 'link-sources', target }, 15_000)
  return response.kind === 'link-sources-result' ? response.paths : []
}

const INVALID_NAME = /[[\]|#^/\\:]/

/**
 * Rename a topic everywhere: every `[[topics/Old]]` becomes `[[topics/New]]`
 * through the link rewrite, and the topic is never renamed automatically again.
 */
export async function rename(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const clean = name.trim().replace(/\s+/g, ' ')
  if (clean === '' || INVALID_NAME.test(clean)) return { ok: false, error: 'A topic name cannot be empty or contain [ ] | # ^ / \\ :' }
  const state = readTopics()
  const topic = state.topics.find((t) => t.id === id)
  if (topic === undefined) return { ok: false, error: 'No such topic.' }
  const clash = byName(state, clean)
  if (clash !== undefined && clash.id !== id) return { ok: false, error: `There is already a topic called “${clash.name}”.` }
  const from = topicLink(topic.name)
  const to = topicLink(clean)
  // Exact: `[[topics/Old]]` only - never `[[Old]]`, a link to an ordinary note.
  await vaultFs.rewriteLinksTo(await linkSources(from), `${from}.md`, `${to}.md`, true)
  saveTopics({
    ...state,
    topics: state.topics.map((t) => (t.id === id ? { ...t, name: clean, renamedByUser: true } : t)),
    // Undoing an older run must not bring the old name back: every record of it says the new one.
    runs: state.runs.map((r) => ({
      ...r,
      changes: r.changes.map((c) =>
        c.op === 'rename' && c.topic === id ? { ...c, link: to, from: to } : sameLink(c.link, from) ? { ...c, link: to } : c,
      ),
      ...(r.restore === undefined
        ? {}
        : { restore: { ...r.restore, topics: r.restore.topics.map((t) => (t.id === id ? { ...t, name: clean, renamedByUser: true } : t)) } }),
    })),
  })
  return { ok: true }
}

/** Delete a topic: out of every note's `topics`, and never created again. */
export async function remove(id: string): Promise<void> {
  const state = readTopics()
  const topic = state.topics.find((t) => t.id === id)
  if (topic === undefined) return
  const link = topicLink(topic.name)
  const carriers = await linkSources(link)
  for (const p of carriers) {
    const read = await vaultFs.readFile(p)
    if (!read.ok) continue
    const entries = linksIn(read.content, TOPICS_PROPERTY)
    await writeNote(p, read.content, TOPICS_PROPERTY, entries.filter((e) => !sameLink(e, link)))
  }
  const strip = (m: Record<string, string[]>): Record<string, string[]> =>
    Object.fromEntries(
      Object.entries(m)
        .map(([k, v]): [string, string[]] => [k, v.filter((x) => x !== id)])
        .filter(([, v]) => v.length > 0),
    )
  saveTopics({
    ...state,
    topics: state.topics.filter((t) => t.id !== id),
    deleted: [...new Set([...state.deleted, id])],
    deletedMembers: { ...state.deletedMembers, [id]: carriers },
    assigned: strip(state.assigned),
    owned: strip(state.owned),
  })
  publish()
}

/** "Rebuild topics": cluster again, keeping ids and names where a cluster continues an old topic. */
export async function rebuild(): Promise<void> {
  const ctx = await context(readSettings())
  const now = Date.now()
  const state = reconcile(ctx, readTopics())
  const settled = ctx.eligible.filter((p) => quiet(ctx, p, now))
  saveTopics(await build(ctx, state, settled))
  await markEvaluated(ctx, settled)
  void tick()
}

/**
 * What the next run would write, without writing: the topics it would build
 * (or has), and which notes get which.
 */
export async function preview(): Promise<TopicsPreview> {
  const vault = currentVault()
  if (!vault || !modelPresent(modelRoot())) return { notes: 0, topics: [], assignments: [] }
  if (states.size === 0) await openEmbedder(vault.path)
  const ctx = await context(readSettings())
  const now = Date.now()
  let state = reconcile(ctx, readTopics())
  const settled = ctx.eligible.filter((p) => quiet(ctx, p, now))
  if (state.builtAt === null) state = await build(ctx, state, settled)
  const members = membership(state, ctx)
  const name = (id: string): string => state.topics.find((t) => t.id === id)?.name ?? id
  return {
    notes: settled.length,
    topics: [...members.entries()]
      .filter(([id, m]) => m.size > 0 && !state.deleted.includes(id))
      .map(([id, m]) => ({ name: name(id), size: m.size, sample: [...m].slice(0, SAMPLE_MEMBERS) }))
      .sort((a, b) => b.size - a.size),
    assignments: pending(state).map((p) => ({ path: p, topics: (state.assigned[p] ?? []).filter((id) => allowed(state, p, id)).map(name) })),
  }
}

/**
 * Settings has shown the first-run line: the next scheduled run may write.
 * Not in a dev build - opening Settings while developing is not a decision to
 * let unfinished code write to notes (see dev-guard).
 */
export function seen(): void {
  if (devGuarded()) return
  const settings = readSettings()
  if (settings.reviewedAt !== null) return
  saveSettings({ ...settings, reviewedAt: Date.now() })
  publish()
}

/** Take back everything the most recent run changed (see runs.undoLast). */
export async function undoLastRun(): Promise<number> {
  const state = readTopics()
  const run = state.runs.at(-1)
  if (run === undefined) return 0
  const texts = new Map<string, string>()
  for (const p of new Set(run.changes.map((c) => c.path))) {
    const read = await vaultFs.readFile(p)
    if (read.ok) texts.set(p, read.content)
  }
  const undone = undoLast(state, (p) => texts.get(p) ?? null)
  await writeAll(undone.writes)
  saveTopics(undone.state)
  publish()
  return undone.changes
}

/** A note moved in the app: its record moves with it. The link rewrite has already fixed the text. */
export async function moved(from: string, to: string): Promise<void> {
  saveTopics(renamePath(readTopics(), from, to))
  if (!active || states.size === 0) return
  const map = (p: string): string => (p === from ? to : p.startsWith(`${from}/`) ? `${to}${p.slice(from.length)}` : p)
  const forget: string[] = []
  const rows: (Partial<StateRow> & { path: string })[] = []
  for (const [p, st] of [...states]) {
    const np = map(p)
    if (np === p) continue
    forget.push(p)
    states.delete(p)
    rows.push({ ...st, path: np, embeddedMtime: null })
  }
  if (forget.length > 0) await ask({ kind: 'forget', paths: forget }, 'ok')
  await putState(rows)
}
