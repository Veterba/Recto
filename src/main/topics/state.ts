/**
 * `.recto/topics.json`: what topics exist and who owns what, in the vault so
 * it survives an index rebuild. Pure; the service reads and writes it.
 *
 *  - `topics`: id, name, and whether the user renamed it (then it is never
 *    renamed automatically).
 *  - `assigned`: per note, the topics the machine decided on. `owned`: the
 *    ones it has actually written into the note. They differ while a run is
 *    still working through its 20-notes-per-run budget.
 *  - `blocks`: per note, topics never given to it again: removed by the user,
 *    or taken out by an Undo.
 *  - `rejected`: per topic, the notes the user removed it from by hand. When
 *    that is more than half of the notes it was on, the topic is dissolved.
 *  - `deleted`: topics deleted from Settings or dissolved - never come back.
 *  - `runs`: what each run changed, so the last one can be undone.
 *  - `language`: the one language topic names are in (see naming).
 */

import { TOPIC_PREFIX } from '../../shared/topics'
import { continues } from './cluster'
import type { Lang } from './naming'

export { TOPIC_PREFIX, TOPICS_PROPERTY } from '../../shared/topics'

export type Topic = { id: string; name: string; renamedByUser: boolean }

/**
 * One edit to one note: a link added to or removed from a property, or a
 * topic link renamed (`from` -> `link`) by a language switch.
 */
export type Change = { path: string; property: string; link: string; op: 'add' | 'remove' | 'rename'; topic?: string; from?: string }
/** What a language switch replaced, put back as it was by its undo. */
export type Restore = { language: Lang | null; topics: Topic[]; assigned: Record<string, string[]>; owned: Record<string, string[]> }
/** One run's edits, with a line for the notice ("Topics added to 3 notes"). */
export type Run = { at: number; label: string; changes: Change[]; restore?: Restore }

export type TopicsState = {
  builtAt: number | null
  tAssign: number | null
  topics: Topic[]
  assigned: Record<string, string[]>
  owned: Record<string, string[]>
  blocks: Record<string, string[]>
  rejected: Record<string, string[]>
  deleted: string[]
  /** Who a deleted topic's members were, so a rebuild can tell when a cluster is that topic again. */
  deletedMembers: Record<string, string[]>
  runs: Run[]
  /** The one-time removal of the old `related` auto-links has happened. */
  migratedRelated: boolean
  /** The language topic names are in. Null until the first build. */
  language: Lang | null
  /** A switch to this language was undone: not switched to again while it is still what leads. */
  declinedLanguage: Lang | null
}

export const emptyState = (): TopicsState => ({
  builtAt: null,
  tAssign: null,
  topics: [],
  assigned: {},
  owned: {},
  blocks: {},
  rejected: {},
  deleted: [],
  deletedMembers: {},
  runs: [],
  migratedRelated: false,
  language: null,
  declinedLanguage: null,
})

/** Runs kept for undo. Only the last is offered, but a few help when reading the file by hand. */
const RUNS_KEPT = 10

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const lists = (v: unknown): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  if (isObject(v)) for (const [k, x] of Object.entries(v)) if (strings(x).length > 0) out[k] = strings(x)
  return out
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const lang = (v: unknown): Lang | null => (v === 'en' || v === 'ru' || v === 'no' ? v : null)

function coerceTopics(v: unknown): Topic[] {
  return Array.isArray(v)
    ? v.flatMap((t): Topic[] =>
        isObject(t) && typeof t['id'] === 'string' && typeof t['name'] === 'string' && t['name'].trim() !== ''
          ? [{ id: t['id'], name: t['name'].trim(), renamedByUser: t['renamedByUser'] === true }]
          : [],
      )
    : []
}

function coerceRestore(v: unknown): Restore | undefined {
  if (!isObject(v)) return undefined
  return { language: lang(v['language']), topics: coerceTopics(v['topics']), assigned: lists(v['assigned']), owned: lists(v['owned']) }
}

/** A hand-edited file is read field by field; anything malformed is dropped, not fatal. */
export function coerceState(raw: unknown): TopicsState {
  const v = isObject(raw) ? raw : {}
  const topics = coerceTopics(v['topics'])
  const runs = Array.isArray(v['runs'])
    ? v['runs'].flatMap((r): Run[] => {
        if (!isObject(r) || typeof r['at'] !== 'number' || !Array.isArray(r['changes'])) return []
        const restore = coerceRestore(r['restore'])
        return [
          {
            at: r['at'],
            label: typeof r['label'] === 'string' ? r['label'] : '',
            changes: (r['changes'] as unknown[]).filter(
              (c): c is Change =>
                isObject(c) &&
                typeof c['path'] === 'string' &&
                typeof c['link'] === 'string' &&
                (c['op'] !== 'rename' || typeof c['from'] === 'string'),
            ),
            ...(restore === undefined ? {} : { restore }),
          },
        ]
      })
    : []
  return {
    builtAt: num(v['builtAt']),
    tAssign: num(v['tAssign']),
    topics,
    assigned: lists(v['assigned']),
    owned: lists(v['owned']),
    blocks: lists(v['blocks']),
    rejected: lists(v['rejected']),
    deleted: strings(v['deleted']),
    deletedMembers: lists(v['deletedMembers']),
    runs,
    migratedRelated: v['migratedRelated'] === true,
    language: lang(v['language']),
    declinedLanguage: lang(v['declinedLanguage']),
  }
}

/** `[[topics/Python]]` - the link a note carries. */
export const topicLink = (name: string): string => `${TOPIC_PREFIX}${name}`

/** The topic name a link target names, or null if it is not a topic link. */
export function topicNameOf(target: string): string | null {
  const t = target.trim()
  return t.toLowerCase().startsWith(TOPIC_PREFIX) ? t.slice(TOPIC_PREFIX.length).replace(/\.md$/i, '').trim() : null
}

export const byName = (state: TopicsState, name: string): Topic | undefined =>
  state.topics.find((t) => t.name.toLowerCase() === name.toLowerCase())

/** Topics a note may be given: not deleted, not removed from this note by the user. */
export const allowed = (state: TopicsState, path: string, id: string): boolean =>
  !state.deleted.includes(id) && !(state.blocks[path] ?? []).includes(id)

const setList = (map: Record<string, string[]>, key: string, value: readonly string[]): Record<string, string[]> => {
  const next = { ...map }
  if (value.length === 0) delete next[key]
  else next[key] = [...value]
  return next
}

export const setAssigned = (s: TopicsState, path: string, ids: readonly string[]): TopicsState => ({
  ...s,
  assigned: setList(s.assigned, path, ids),
})
export const setOwned = (s: TopicsState, path: string, ids: readonly string[]): TopicsState => ({
  ...s,
  owned: setList(s.owned, path, ids),
})
export const block = (s: TopicsState, path: string, id: string): TopicsState => ({
  ...s,
  blocks: setList(s.blocks, path, [...new Set([...(s.blocks[path] ?? []), id])]),
  assigned: setList(s.assigned, path, (s.assigned[path] ?? []).filter((x) => x !== id)),
  owned: setList(s.owned, path, (s.owned[path] ?? []).filter((x) => x !== id)),
})

/** A run that changed nothing is not kept - unless it has state to put back. */
/** The user took topic `id` out of note `path`: blocked there for good, and counted against the topic. */
export const reject = (s: TopicsState, path: string, id: string): TopicsState => {
  const next = block(s, path, id)
  return { ...next, rejected: setList(next.rejected, id, [...new Set([...(next.rejected[id] ?? []), path])]) }
}

/** Topics the user took out of more than half of the notes that had them. */
export function dissolving(s: TopicsState): string[] {
  return s.topics
    .filter((t) => !s.deleted.includes(t.id))
    .map((t) => t.id)
    .filter((id) => {
      const removed = (s.rejected[id] ?? []).length
      const kept = Object.values(s.owned).filter((ids) => ids.includes(id)).length
      return removed * 2 > removed + kept
    })
}

/** Dissolve a topic: gone, and - like a deleted one - never made again from the same notes. */
export function dissolve(s: TopicsState, id: string): TopicsState {
  const members = [...new Set([...(s.rejected[id] ?? []), ...Object.entries(s.owned).filter(([, ids]) => ids.includes(id)).map(([p]) => p)])]
  const strip = (m: Record<string, string[]>): Record<string, string[]> =>
    Object.fromEntries(
      Object.entries(m)
        .map(([k, v]): [string, string[]] => [k, v.filter((x) => x !== id)])
        .filter(([, v]) => v.length > 0),
    )
  return {
    ...s,
    topics: s.topics.filter((t) => t.id !== id),
    deleted: [...new Set([...s.deleted, id])],
    deletedMembers: { ...s.deletedMembers, [id]: members.sort() },
    assigned: strip(s.assigned),
    owned: strip(s.owned),
  }
}

/** A cluster that is a deleted or dissolved topic come back (half its notes or more): it stays gone. */
export const isDeletedAgain = (s: TopicsState, members: ReadonlySet<string>): boolean =>
  continues(
    members,
    Object.entries(s.deletedMembers).map(([id, m]) => ({ id, members: new Set(m) })),
    new Set(),
  ) !== null

export const addRun = (s: TopicsState, run: Run): TopicsState =>
  run.changes.length === 0 && run.restore === undefined ? s : { ...s, runs: [...s.runs, run].slice(-RUNS_KEPT) }

/** Notes whose written topics are not yet what was assigned - the work left for the next runs. */
export function pending(s: TopicsState): string[] {
  const paths = new Set([...Object.keys(s.assigned), ...Object.keys(s.owned)])
  return [...paths]
    .filter((p) => {
      const want = new Set((s.assigned[p] ?? []).filter((id) => allowed(s, p, id)))
      const have = new Set(s.owned[p] ?? [])
      return want.size !== have.size || [...want].some((id) => !have.has(id))
    })
    .sort()
}

/** Follow a note rename or folder move through every path key. */
export function renamePath(s: TopicsState, from: string, to: string): TopicsState {
  const map = (p: string): string => (p === from ? to : p.startsWith(`${from}/`) ? `${to}${p.slice(from.length)}` : p)
  const remap = (m: Record<string, string[]>): Record<string, string[]> =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [map(k), v]))
  return {
    ...s,
    assigned: remap(s.assigned),
    owned: remap(s.owned),
    blocks: remap(s.blocks),
    rejected: Object.fromEntries(Object.entries(s.rejected).map(([id, paths]) => [id, paths.map(map)])),
    runs: s.runs.map((r) => ({
      ...r,
      changes: r.changes.map((c) => ({ ...c, path: map(c.path) })),
      ...(r.restore === undefined ? {} : { restore: { ...r.restore, assigned: remap(r.restore.assigned), owned: remap(r.restore.owned) } }),
    })),
  }
}
