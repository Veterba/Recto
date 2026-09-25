import { linksIn, writeLinks } from '../../renderer/core/link-property'
import { rewriteWikiLinks } from '../link-rewrite'
import type { Lang } from './naming'
import { addRun, allowed, block, topicLink, TOPICS_PROPERTY, type Change, type Run, type TopicsState } from './state'

/**
 * The two runs that change many notes at once, as pure functions of the state
 * and the notes' text: a language switch, and undoing the last run. The
 * service reads the notes, calls these, and writes what comes back.
 */

/** A note's current text, or null if it is gone. */
export type Read = (path: string) => string | null

export const sameLink = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

const LANGUAGE_NAME: Record<Lang, string> = { en: 'English', ru: 'Russian', no: 'Norwegian' }

const strip = (m: Record<string, string[]>, id: string): Record<string, string[]> =>
  Object.fromEntries(
    Object.entries(m)
      .map(([k, v]): [string, string[]] => [k, v.filter((x) => x !== id)])
      .filter(([, v]) => v.length > 0),
  )

/**
 * Switch topic names to `to`, all in one run. `names` has, per machine-named
 * topic, its name in the new language - or null when its notes give no two
 * candidates in it, and then the topic is removed. Topics the user renamed are
 * not touched. `carriers` are the notes whose text links each topic.
 */
export function switchLanguage(
  state: TopicsState,
  to: Lang,
  names: Readonly<Record<string, string | null>>,
  carriers: Readonly<Record<string, readonly string[]>>,
  read: Read,
  at: number,
): { state: TopicsState; writes: Map<string, string>; run: Run } {
  const writes = new Map<string, string>()
  const text = (p: string): string | null => writes.get(p) ?? read(p)
  const changes: Change[] = []
  let next: TopicsState = state
  for (const topic of state.topics) {
    if (topic.renamedByUser || !(topic.id in names)) continue
    const name = names[topic.id]!
    const from = topicLink(topic.name)
    if (name === null) {
      for (const p of carriers[topic.id] ?? []) {
        const before = text(p)
        if (before === null) continue
        const entries = linksIn(before, TOPICS_PROPERTY)
        const after = writeLinks(before, TOPICS_PROPERTY, entries.filter((e) => !sameLink(e, from)))
        if (after === before) continue
        writes.set(p, after)
        changes.push({ path: p, property: TOPICS_PROPERTY, link: from, op: 'remove', topic: topic.id })
      }
      next = { ...next, topics: next.topics.filter((t) => t.id !== topic.id), assigned: strip(next.assigned, topic.id), owned: strip(next.owned, topic.id) }
      continue
    }
    if (name === topic.name) continue
    const link = topicLink(name)
    for (const p of carriers[topic.id] ?? []) {
      const before = text(p)
      if (before === null) continue
      // Exact: `[[topics/Old]]` only - never `[[Old]]`, a link to an ordinary note.
      const after = rewriteWikiLinks(before, `${from}.md`, `${link}.md`, true)
      if (after.count === 0) continue
      writes.set(p, after.text)
      changes.push({ path: p, property: TOPICS_PROPERTY, link, from, op: 'rename', topic: topic.id })
    }
    next = { ...next, topics: next.topics.map((t) => (t.id === topic.id ? { ...t, name } : t)) }
  }
  const run: Run = {
    at,
    label: `Topic names switched to ${LANGUAGE_NAME[to]}`,
    changes,
    restore: { language: state.language, topics: state.topics, assigned: state.assigned, owned: state.owned },
  }
  return { state: addRun({ ...next, language: to, declinedLanguage: null }, run), writes, run }
}

/**
 * Take back everything the most recent run changed. A topic it added is
 * removed and blocked for that note; an entry it removed is put back; a
 * rename is reversed; and a language switch puts the topics, and the
 * language, back as they were - and is not made again by itself.
 *
 * The user's own exclusions are not part of any run and are never undone: a
 * topic they took out of a note, or dissolved, stays out.
 */
export function undoLast(state: TopicsState, read: Read): { state: TopicsState; writes: Map<string, string>; changes: number } {
  const run = state.runs.at(-1)
  const writes = new Map<string, string>()
  if (run === undefined) return { state, writes, changes: 0 }
  let next = state
  for (const c of run.changes) {
    const before = writes.get(c.path) ?? read(c.path)
    if (before === null) continue
    let after = before
    if (c.op === 'rename') {
      after = rewriteWikiLinks(before, `${c.link}.md`, `${c.from ?? c.link}.md`, true).text
    } else {
      const entries = linksIn(before, c.property)
      if (c.op === 'add') {
        after = writeLinks(before, c.property, entries.filter((e) => !sameLink(e, c.link)))
        if (c.topic !== undefined) next = block(next, c.path, c.topic)
      } else if (!entries.some((e) => sameLink(e, c.link)) && (c.topic === undefined || allowed(state, c.path, c.topic))) {
        after = writeLinks(before, c.property, [...entries, c.link])
      }
    }
    if (after !== before) writes.set(c.path, after)
  }
  if (run.restore !== undefined) {
    const keep = (m: Record<string, string[]>): Record<string, string[]> =>
      Object.fromEntries(
        Object.entries(m)
          .map(([p, ids]): [string, string[]] => [p, ids.filter((id) => allowed(next, p, id))])
          .filter(([, ids]) => ids.length > 0),
      )
    next = {
      ...next,
      language: run.restore.language,
      topics: run.restore.topics.filter((t) => !next.deleted.includes(t.id)),
      assigned: keep(run.restore.assigned),
      owned: keep(run.restore.owned),
      declinedLanguage: state.language,
    }
  }
  return { state: { ...next, runs: next.runs.slice(0, -1) }, writes, changes: run.changes.length }
}
