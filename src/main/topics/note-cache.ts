/**
 * The notes a run works on: read, prepared and cached while their mtime holds,
 * and the context a run is computed in.
 */

import { type Chunk, ownLines, ownText, countWords, linkShare, chunk, titleInput } from './text'
import { type Lang, nameText, language } from './naming'
import type { TopicsSettings } from '../../shared/topics'
import type { TopicsGraph } from '../../shared/indexer-protocol'
import * as vaultFs from '../vault-fs'
import { type TopicsState, TOPICS_PROPERTY, topicNameOf, byName } from './state'
import { linksIn } from '../../shared/link-property'

export type Note = {
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

export type Context = {
  settings: TopicsSettings
  graph: TopicsGraph
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
export const notes = new Map<string, Note>()

/** The mtime each note had when it was last checked for settling. */
export const checked = new Map<string, number>()

export async function readNote(ctx: Pick<Context, 'template'>, p: string, mtime: number): Promise<Note | null> {
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

export const mtimeOf = (ctx: Context, p: string): number => ctx.graph.notes.find((n) => n.path === p)?.mtime ?? 0

export const quiet = (ctx: Context, p: string, now: number): boolean => now - mtimeOf(ctx, p) >= ctx.settings.quietMinutes * 60_000

/** The topic ids a note's `topics` property holds right now. */
export const fileTopics = (state: TopicsState, text: string): string[] =>
  linksIn(text, TOPICS_PROPERTY).flatMap((link) => {
    const name = topicNameOf(link)
    const topic = name === null ? undefined : byName(state, name)
    return topic === undefined ? [] : [topic.id]
  })
