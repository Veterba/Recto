import path from 'node:path'
import type { BotHit } from '../../shared/embedder-protocol'
import { chunkNote } from './chunks'
import { enoughTerms, scoreSection, type Chunk } from './context'

/**
 * Hybrid retrieval: the words (FTS5, the question's own words and the
 * router's keywords in both languages) and the meaning (chunk vectors) each
 * rank pieces of notes, top 20 each, and the two lists are fused with
 * reciprocal rank fusion (k = 60). Then:
 *
 * - index notes ("Recto log", "Version map", any note linking out to many)
 *   are pushed down unless the question names them, and dated entries
 *   ("2026-09-21 — v0.6") are preferred, so a log's entry wins over its list;
 * - recent notes are pushed up only when the question is about a period;
 * - at most two pieces of one note, four to six pieces in all, within budget.
 *
 * Pure: the searches are done by the caller and passed in.
 */

export const RRF_K = 60
export const TOP_EACH = 20
/** Below this cosine (retrieval prompts), a vector hit is noise: a question the vault has nothing on still has nearest pieces. */
export const MIN_VECTOR_SCORE = 0.45

export type NoteText = { path: string; title: string; content: string }

export type Candidate = Chunk & { key: string; score: number; via: ('words' | 'meaning')[] }

export type RetrieveOptions = {
  terms: readonly string[]
  /** Notes found by the word search, best first, with their text. */
  ftsNotes: readonly NoteText[]
  vectorHits: readonly BotHit[]
  /** Index notes: their path (or title) and how many links go out of them. */
  hubs: ReadonlySet<string>
  /** Notes the question names: never pushed down. */
  named?: ReadonlySet<string>
  /** Notes of the period the question asks about, pushed up. */
  recent?: ReadonlySet<string>
  max?: number
  budget?: number
}

const HUB_TITLES = /^(recto log|version map|lark log)$/i
/** A log entry ("2026-09-21 — v0.6"), not a daily note ("2026-09-21"): the entry is preferred to its index. */
const DATED = /^\d{4}-\d{2}-\d{2}\s*[—–-]\s*\S/
const titleOf = (p: string): string => path.basename(p).replace(/\.md$/i, '')

/** The word search's pieces: each found note's matching pieces, notes in rank order, best piece first. */
export function wordRanked(notes: readonly NoteText[], terms: readonly string[]): Chunk[] {
  const out: Chunk[] = []
  for (const note of notes) {
    const pieces = chunkNote(note.title, note.content)
      .map((c) => ({ c, section: { heading: c.path.at(-1) ?? null, text: c.text } }))
      .filter(({ section }) => scoreSection(section, terms) >= 1 && enoughTerms(section, terms, `${note.title} ${section.heading ?? ''}`))
      .sort((a, b) => scoreSection(b.section, terms) - scoreSection(a.section, terms))
    for (const { c } of pieces)
      out.push({ path: note.path, title: note.title, heading: c.path.length === 0 ? null : c.path.join(' > '), text: c.text, idx: c.idx })
  }
  return out
}

export function fuse(o: RetrieveOptions): Candidate[] {
  const words = wordRanked(o.ftsNotes, o.terms).slice(0, TOP_EACH)
  const meaning = o.vectorHits.filter((h) => h.score >= MIN_VECTOR_SCORE).slice(0, TOP_EACH)
  const all = new Map<string, Candidate>()
  const add = (chunk: Chunk, rank: number, via: 'words' | 'meaning'): void => {
    const key = `${chunk.path}#${chunk.idx ?? 0}`
    const c = all.get(key) ?? { ...chunk, key, score: 0, via: [] }
    c.score += 1 / (RRF_K + rank + 1)
    c.via.push(via)
    all.set(key, c)
  }
  words.forEach((c, i) => add(c, i, 'words'))
  meaning.forEach((h, i) =>
    add({ path: h.path, title: titleOf(h.path), heading: h.heading === '' ? null : h.heading, text: h.text, idx: h.idx }, i, 'meaning'),
  )
  for (const c of all.values()) {
    const named = o.named?.has(c.path) === true
    if (!named && (o.hubs.has(c.path) || HUB_TITLES.test(c.title))) c.score *= 0.5
    if (DATED.test(c.title)) c.score *= 1.1
    if (o.recent?.has(c.path) === true) c.score *= 1.3
  }
  return [...all.values()].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
}

/** The pieces to read: best first, at most two per note, `max` in all, within `budget` characters. */
export function pick(candidates: readonly Candidate[], { max = 6, budget = 6000 }: { max?: number; budget?: number } = {}): Candidate[] {
  const chosen: Candidate[] = []
  const perNote = new Map<string, number>()
  let used = 0
  for (const c of candidates) {
    if (chosen.length === max) break
    if ((perNote.get(c.path) ?? 0) >= 2) continue
    const room = budget - used
    if (room < 200) break
    const text = c.text.length > room ? `${c.text.slice(0, room - 1).trimEnd()}…` : c.text
    chosen.push({ ...c, text })
    perNote.set(c.path, (perNote.get(c.path) ?? 0) + 1)
    used += text.length
  }
  return chosen
}
