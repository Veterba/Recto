/**
 * What of a note is worth embedding, and in what pieces.
 *
 * Pure and string-only, so it is tested without a model. The rule is "own
 * text": the words the user actually wrote here, not the scaffolding a
 * template put in, not code, not a list of links. Otherwise every daily note
 * would look like every other daily note, and a note that is mostly links
 * would look like the notes it links to.
 */

import { createHash } from 'node:crypto'
import { parseFrontmatter } from '../../renderer/core/frontmatter'

const FENCE = /^\s*(```|~~~)/
const HEADING = /^(#{1,6})\s+(.*)$/
/** `[[target#heading|alias]]`, and `![[embed]]` in front of it. */
const WIKILINK = /(!?)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g
/** `[text](url)` and `![alt](image)`. */
const MD_LINK = /(!?)\[([^\]]*)\]\([^)\n]*\)/g
/** List markers and quote marks, so `- [[a]]` still counts as only a link. */
const LINE_PREFIX = /^\s*(?:>\s*)*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/

export const MIN_CHUNK_WORDS = 40
export const MAX_CHUNK_WORDS = 300

/** Words are runs of letters or digits, in any script. */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0
}

/** `[[a|b]]` -> `b`, `[[a]]` -> `a`, `[t](u)` -> `t`; embeds vanish. */
export function unlink(line: string): string {
  return line
    .replace(WIKILINK, (_m, bang: string, target: string, alias?: string) =>
      bang === '!' ? '' : (alias ?? target).trim(),
    )
    .replace(MD_LINK, (_m, bang: string, text: string) => (bang === '!' ? '' : text))
}

/** A line with links and punctuation but no words of its own. */
function isOnlyLinks(line: string): boolean {
  const body = line.replace(LINE_PREFIX, '')
  const rest = body.replace(WIKILINK, ' ').replace(MD_LINK, ' ')
  return rest !== body && countWords(rest) === 0
}

/**
 * Every line of every template, trimmed. A note line identical to one of these
 * came from a template, not from the user. Lines with no words (`- [ ]`, `---`)
 * are left out: they would match everything and say nothing.
 */
export function templateLines(templates: readonly string[]): Set<string> {
  const lines = new Set<string>()
  for (const text of templates) {
    const body = text.split(/\r?\n/).slice(parseFrontmatter(text).bodyStart)
    for (const line of body) {
      const trimmed = line.trim()
      if (countWords(trimmed) > 0) lines.add(trimmed)
    }
  }
  return lines
}

/**
 * One line of own text. `text` has links turned into their words, for the
 * model; `plain` has them removed, for the title bonus - a name inside a
 * link is the link, not a mention.
 */
export type OwnLine = { text: string; plain: string; heading: string | null; blank: boolean }

/** Links removed entirely, embeds too. */
const stripLinks = (line: string): string => line.replace(WIKILINK, ' ').replace(MD_LINK, ' ')

/**
 * The note's own lines: body minus frontmatter, code blocks, template lines
 * and link-only lines, with links turned into their words. Headings are kept
 * as structure (`heading`) rather than as text, so the chunker can use them.
 */
export function ownLines(text: string, template: ReadonlySet<string>): OwnLine[] {
  const lines = text.split(/\r?\n/).slice(parseFrontmatter(text).bodyStart)
  const out: OwnLine[] = []
  let inCode = false
  let heading: string | null = null
  for (const raw of lines) {
    if (FENCE.test(raw)) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const trimmed = raw.trim()
    const match = HEADING.exec(trimmed)
    if (match !== null) {
      // A template's own heading ("## Tasks") is not the user's structure.
      heading = template.has(trimmed) ? null : unlink(match[2] ?? '').trim() || null
      out.push({ text: '', plain: '', heading, blank: true })
      continue
    }
    if (trimmed === '' || template.has(trimmed) || isOnlyLinks(trimmed)) {
      out.push({ text: '', plain: '', heading, blank: true })
      continue
    }
    out.push({ text: unlink(trimmed).trim(), plain: stripLinks(trimmed).trim(), heading, blank: false })
  }
  return out
}

/** The own text as one string, for word counts and title matching. */
export const ownText = (lines: readonly OwnLine[]): string =>
  lines
    .filter((line) => !line.blank)
    .map((line) => line.text)
    .join('\n')

/** The own text with links taken out, for matching a target's name. Code is already gone. */
export const plainText = (lines: readonly OwnLine[]): string =>
  lines
    .filter((line) => !line.blank)
    .map((line) => line.plain)
    .join('\n')

/**
 * How much of a note is links, by words: link words over all words, in the
 * body outside code and template lines. A note that is mostly links is a map
 * of other notes - a hub - not a topic of its own.
 */
export function linkShare(text: string, template: ReadonlySet<string>): number {
  const lines = text.split(/\r?\n/).slice(parseFrontmatter(text).bodyStart)
  let inCode = false
  let all = 0
  let linked = 0
  for (const raw of lines) {
    if (FENCE.test(raw)) {
      inCode = !inCode
      continue
    }
    const trimmed = raw.trim()
    if (inCode || trimmed === '' || template.has(trimmed)) continue
    const words = countWords(unlink(trimmed))
    all += words
    linked += words - countWords(stripLinks(trimmed))
  }
  return all === 0 ? 0 : linked / all
}

export type Chunk = { heading: string | null; text: string; words: number }

/**
 * Split by headings and blank lines, then merge short neighbours so each chunk
 * is 40-300 words. A paragraph over 300 is cut at sentence ends. The heading
 * the chunk starts under is kept as its first line - it is often the one
 * sentence that says what the paragraph is about.
 */
export function chunk(lines: readonly OwnLine[]): Chunk[] {
  // Paragraphs: runs of non-blank lines under one heading.
  const paragraphs: Chunk[] = []
  let current: string[] = []
  let heading: string | null = null
  const close = (): void => {
    if (current.length === 0) return
    const text = current.join('\n')
    paragraphs.push({ heading, text, words: countWords(text) })
    current = []
  }
  for (const line of lines) {
    if (line.blank || line.heading !== heading) close()
    heading = line.heading
    if (!line.blank) current.push(line.text)
  }
  close()

  const pieces = paragraphs.flatMap(splitLong)

  const merged: Chunk[] = []
  for (const piece of pieces) {
    const last = merged[merged.length - 1]
    // A new heading starts a new chunk once the current one is big enough
    // to stand on its own; below that, neighbours are merged regardless.
    const fits = last !== undefined && last.words + piece.words <= MAX_CHUNK_WORDS
    const sameSection = last !== undefined && last.heading === piece.heading
    if (last !== undefined && fits && (last.words < MIN_CHUNK_WORDS || (sameSection && piece.words < MIN_CHUNK_WORDS))) {
      // Merging across a heading keeps that heading as a line of the chunk.
      const lead = sameSection || piece.heading === null ? '' : `${piece.heading}\n`
      last.text = `${last.text}\n\n${lead}${piece.text}`
      last.words += piece.words
      continue
    }
    merged.push({ ...piece })
  }
  // A short tail goes into the chunk before it when there is room.
  const tail = merged[merged.length - 1]
  const before = merged[merged.length - 2]
  if (tail !== undefined && before !== undefined && tail.words < MIN_CHUNK_WORDS && before.words + tail.words <= MAX_CHUNK_WORDS) {
    before.text = `${before.text}\n\n${tail.text}`
    before.words += tail.words
    merged.pop()
  }
  return merged
}

/** Cut a paragraph over the limit at sentence ends, or at words if it has none. */
function splitLong(paragraph: Chunk): Chunk[] {
  if (paragraph.words <= MAX_CHUNK_WORDS) return [paragraph]
  const sentences = paragraph.text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [paragraph.text]
  const out: Chunk[] = []
  let text = ''
  let words = 0
  const push = (): void => {
    if (words > 0) out.push({ heading: paragraph.heading, text: text.trim(), words })
    text = ''
    words = 0
  }
  for (const sentence of sentences) {
    const n = countWords(sentence)
    if (n > MAX_CHUNK_WORDS) {
      push()
      const tokens = sentence.split(/\s+/).filter((t) => t !== '')
      for (let i = 0; i < tokens.length; i += MAX_CHUNK_WORDS) {
        const part = tokens.slice(i, i + MAX_CHUNK_WORDS).join(' ')
        out.push({ heading: paragraph.heading, text: part, words: countWords(part) })
      }
      continue
    }
    if (words + n > MAX_CHUNK_WORDS) push()
    text += sentence
    words += n
  }
  push()
  return out
}

/** A chunk as a one-line quote: no list markers, no emphasis, trimmed to `max`. */
export function snippet(text: string, max: number): string {
  const plain = text
    .split('\n')
    .map((line) => line.replace(LINE_PREFIX, '').replace(/(\*\*|__|`)/g, '').trim())
    .filter((line) => line !== '')
    .join(' · ')
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain
}

/** What gets embedded for a chunk: its heading, then its text. */
export const chunkInput = (c: Chunk): string => (c.heading === null ? c.text : `${c.heading}\n${c.text}`)

/** The note's name: the file name, which is what the app calls it everywhere. */
export const noteTitle = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

/** `aliases:` / `alias:` from frontmatter, as a list. */
export function aliasesOf(text: string): string[] {
  const field = parseFrontmatter(text).fields.find((f) => /^alias(es)?$/i.test(f.key))
  if (field === undefined || field.value === null) return []
  const values = Array.isArray(field.value) ? field.value : [String(field.value)]
  return values.map((v) => unlink(v).trim()).filter((v) => v !== '')
}

/** Title + aliases + headings: the one "what is this note" vector. */
export function titleInput(path: string, text: string): string {
  const headings = text
    .split(/\r?\n/)
    .slice(parseFrontmatter(text).bodyStart)
    .map((line) => HEADING.exec(line.trim())?.[2])
    .filter((h): h is string => h !== undefined)
    .map((h) => unlink(h).trim())
    .filter((h) => h !== '')
  const parts = [noteTitle(path), ...aliasesOf(text)]
  return headings.length === 0 ? parts.join(', ') : `${parts.join(', ')}\n${[...new Set(headings)].join('; ')}`
}

/** Does `name` appear in `text` as a whole phrase, ignoring case? */
export function mentions(text: string, name: string): boolean {
  const needle = name.trim()
  if (needle === '') return false
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // \b is ASCII-only in JS; lookarounds on letters/digits work for any script.
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text)
}

/** A stable content hash, so an unchanged chunk is never embedded twice. */
export const hashText = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 16)
