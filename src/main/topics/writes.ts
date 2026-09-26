/**
 * Writing topics into notes: the topics property per note, the pending
 * changes a run makes, and bringing the recorded state back in line with the
 * files.
 */

import * as vaultFs from '../vault-fs'
import { notes, type Context, fileTopics } from './note-cache'
import { writeLinks, linksIn } from '../../shared/link-property'
import {
  type TopicsState,
  type Change,
  pending,
  setOwned,
  setAssigned,
  allowed,
  topicLink,
  TOPICS_PROPERTY,
  reject,
  dissolving,
  dissolve,
} from './state'
import { sameLink } from './runs'

/** A run writes to at most this many notes, so a first run spreads over a few. */
const NOTES_PER_RUN = 20

export async function writeAll(writes: ReadonlyMap<string, string>): Promise<void> {
  for (const [p, text] of writes) {
    // Not marked as a self-write: if the note is open, the editor should reload.
    const written = await vaultFs.writeFile(p, text)
    if (!written.ok) throw new Error(written.error ?? `could not write ${p}`)
    notes.delete(p)
  }
}

export async function writeNote(p: string, text: string, property: string, entries: string[]): Promise<boolean> {
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
export async function writePending(ctx: Context, state: TopicsState): Promise<{ state: TopicsState; changes: Change[] }> {
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
    const add = want
      .flatMap((id) => (name(id) === undefined ? [] : [topicLink(name(id)!)]))
      .filter((l) => !entries.some((e) => sameLink(e, l)))
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
export function reconcile(ctx: Context, state: TopicsState): TopicsState {
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
export async function dissolvePass(state: TopicsState): Promise<TopicsState> {
  let next = state
  for (const id of dissolving(state)) {
    const topic = next.topics.find((t) => t.id === id)
    if (topic === undefined) continue
    const link = topicLink(topic.name)
    for (const [p, ids] of Object.entries(next.owned)) {
      if (!ids.includes(id)) continue
      const read = await vaultFs.readFile(p)
      if (read.ok)
        await writeNote(
          p,
          read.content,
          TOPICS_PROPERTY,
          linksIn(read.content, TOPICS_PROPERTY).filter((e) => !sameLink(e, link)),
        )
    }
    next = dissolve(next, id)
    console.log(`[topics] dissolved "${topic.name}": removed by hand from most of its notes`)
  }
  return next
}
