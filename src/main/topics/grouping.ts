/**
 * Grouping notes into topics: the vectors a run clusters, which notes each topic
 * holds, and the names the topics get.
 */

import { app } from 'electron'
import path from 'node:path'
import { ask } from './embedder-client'
import { type TopicsState, allowed, type Topic, isDeletedAgain } from './state'
import { type Context, notes, fileTopics } from './note-cache'
import { lemmatizer, isEnglishNoun } from './lemma'
import { nameable, type Lang, nameCluster, vaultLanguage } from './naming'
import { dictionary } from './dictionary'
import { currentVault } from '../vault'
import { centroid } from '../../shared/vectors'
import { selectTopics, similarities, continues, assignThreshold } from './cluster'
import { createHash } from 'node:crypto'

/** The naming dictionaries: beside the app when packaged (extraResources), in the repo in development. */
const dictionaries = (): string =>
  app.isPackaged ? path.join(process.resourcesPath, 'dictionaries') : path.join(app.getAppPath(), 'resources', 'dictionaries')

/** Clusters already reported as having no name, so each is logged once per session (kept across restarts of the service). */
const unnamedLogged = new Set<string>()

export const noteVectors = async (paths: string[]): Promise<Record<string, number[]>> =>
  paths.length === 0 ? {} : (await ask({ kind: 'note-vectors', paths }, 'note-vectors', 120_000)).vectors

/** Every note's topics as they stand: the machine's decisions plus what the user typed. */
export function membership(state: TopicsState, ctx: Context): Map<string, Set<string>> {
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
export async function nameFor(
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
export async function centerOf(paths: readonly string[]): Promise<Float32Array> {
  const vectors = await noteVectors([...paths])
  return centroid(paths.flatMap((p) => (vectors[p] === undefined ? [] : [vectors[p]!])))
}

/**
 * Cluster notes into topics (cluster.selectTopics: each cluster judged on its
 * own, no global cut), name them, and set T_ASSIGN from how close the members
 * of the named ones are. Old topics are continued where a cluster overlaps one
 * by half or more; deleted and dissolved ones are not brought back.
 */
export async function build(ctx: Context, state: TopicsState, paths: string[]): Promise<TopicsState> {
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
      const name = topic?.name ?? (lang === null ? null : await nameFor(ctx, members, lang, centroid(cluster.map((i) => vecs[i]!)), names))
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

export const newId = (): string => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Centroids for every topic with members, cached in SQLite and recomputed when membership changes. */
export async function centroids(state: TopicsState, ctx: Context): Promise<{ id: string; vector: number[] }[]> {
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
