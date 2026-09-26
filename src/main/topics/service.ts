import { app, BrowserWindow, net, powerMonitor } from 'electron'
import path from 'node:path'
import {
  DEFAULT_TOPICS_SETTINGS,
  type ModelStatus,
  type TopicsRunNotice,
  type TopicsSettings,
  type TopicsStatus,
} from '../../shared/topics'
import { VAULT_STATE_DIR } from '../../shared/vault'
import type { StateRow } from '../../shared/embedder-protocol'
import { pathsByName, resolveLink } from '../../shared/parse'
import { linksIn } from '../../shared/link-property'
import { coerceTemplateSettings, isInFolder } from '../../shared/templates'
import { send } from '../index-client'
import { readState } from '../state'
import { devGuarded } from '../dev-guard'
import { currentVault } from '../vault'
import * as vaultFs from '../vault-fs'
import { excludedFolders, isEligible } from './eligible'
import { ask, stopEmbedder } from './embedder-client'
import { downloadModel, MODEL_BYTES, modelPresent, OfflineError, receivedBytes } from './model'
import { isSettled } from '../../shared/score'
import { chunkInput, hashText, templateLines } from './text'
import { assign, selectTopics, similarities } from './cluster'
import { vaultLanguage, type Lang } from './naming'
import { switchLanguage } from './runs'
import { addRun, allowed, isDeletedAgain, setAssigned, topicLink, type Change, type Topic, type TopicsState } from './state'
import { centroid } from '../../shared/vectors'
import { IPC_EVENT } from '../../shared/ipc'
import type { IpcEvents } from '../../shared/ipc'
import { sendEvent } from '../events'
import { anyPower, modelDir } from '../config'
import { readTopics, readSettings, saveTopics, saveSettings } from './storage'
import { type Context, readNote, notes, type Note, mtimeOf, quiet, checked } from './note-cache'
import { centroids, noteVectors, membership, nameFor, newId, centerOf, build } from './grouping'
import { writeAll, writeNote, dissolvePass, reconcile, writePending } from './writes'

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
/** Link lists and near-empty notes are not about anything: never a member. */
const HUB_LINK_SHARE = 0.5
const HUB_MIN_OWN_WORDS = 30
export const SAMPLE_MEMBERS = 3
/** The property the old pairwise auto-links were written to. */
const OLD_PROPERTY = 'related'

// ---- process state ------------------------------------------------------------

export let active = false
let timer: NodeJS.Timeout | null = null
let retryTimer: NodeJS.Timeout | null = null
let running = false
let again = false
let lastFocusTick = 0
/** Per note, mirrored from the embedder's table: vectors' freshness and the settle record. */
export let states = new Map<string, StateRow>()
let model: ModelStatus = { state: 'missing', bytes: MODEL_BYTES }
let downloading: AbortController | null = null
let backfill: TopicsStatus['backfill'] = 'idle'
let eligibleCount = 0
/** The first run is waiting for Settings: how many notes it would review. */
let reviewCount = 0

export const modelRoot = (): string => modelDir() ?? path.join(app.getPath('userData'), 'models')

function push<C extends typeof IPC_EVENT.topicsStatus | typeof IPC_EVENT.topicsRun>(channel: C, ...args: Parameters<IpcEvents[C]>): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) sendEvent(win, channel, ...args)
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

export const publish = (): void => push(IPC_EVENT.topicsStatus, status())

export async function putState(rows: (Partial<StateRow> & { path: string })[]): Promise<void> {
  if (rows.length === 0) return
  for (const row of rows) {
    const prev = states.get(row.path) ?? { path: row.path, meanVec: null, ownWords: 0, evaluatedAt: null, embeddedMtime: null }
    states.set(row.path, { ...prev, ...row })
  }
  await ask({ kind: 'state-put', rows }, 'ok')
}

// ---- the vault, as topics sees it ---------------------------------------------

export async function context(settings: TopicsSettings): Promise<Context> {
  const response = await send({ kind: 'autolink-graph' }, 30_000)
  if (response.kind !== 'autolink-graph-result') throw new Error('index did not answer')
  const graph = response.graph
  const templates = coerceTemplateSettings(readState('templates'))
  const excluded = excludedFolders(templates, settings.excluded)
  const all = new Set(graph.notes.map((n) => n.path))

  const byName = pathsByName(all)
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
    if (powerMonitor.isOnBatteryPower() && !anyPower) {
      backfill = 'waiting-power'
      break
    }
    if (powerMonitor.getSystemIdleTime() < IDLE_SECONDS && !anyPower) {
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
    retryTimer = setTimeout(
      () => {
        retryTimer = null
        void tick()
      },
      backfill === 'waiting-idle' ? 15_000 : 60_000,
    )
  }
  return false
}

// ---- deciding ---------------------------------------------------------------------

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
      const picks = assign(
        v,
        cs.filter((c) => allowed(next, p, c.id)),
        next.tAssign!,
      )
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

// ---- writing ----------------------------------------------------------------------

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
    if (
      await writeNote(
        p,
        read.content,
        OLD_PROPERTY,
        entries.filter((e) => !drop.includes(e)),
      )
    ) {
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
  push(IPC_EVENT.topicsRun, notice)
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
export async function markEvaluated(ctx: Context, paths: string[]): Promise<void> {
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

export async function openEmbedder(vaultPath: string): Promise<void> {
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

export async function linkSources(target: string): Promise<string[]> {
  const response = await send({ kind: 'link-sources', target }, 15_000)
  return response.kind === 'link-sources-result' ? response.paths : []
}
