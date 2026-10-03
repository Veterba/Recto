import { createHash } from 'node:crypto'
import { CODE_FENCE } from '../../shared/parse'
import { frontmatterClose } from '../../shared/frontmatter'

/**
 * A note in the pieces a bot searches and reads: split at its headings, then
 * into pieces of about 250–400 tokens with a little overlap, each knowing the
 * headings above it. The same pieces are embedded (chunk vectors) and read
 * (context), so a piece found by its vector and the same piece found by the
 * words in it are one piece.
 *
 * A line that is only bold text ("**Бюджет:**") counts as a heading below
 * the real ones: many notes use bold lines instead of headings.
 *
 * Pure, so it is tested without a vault or a model.
 */

export type NoteChunk = {
  /** Position in the note, from 0. */
  idx: number
  /** The headings above it, outermost first. */
  path: string[]
  text: string
  /** Of what is embedded: changes when the text, the headings or the title change. */
  hash: string
}

/** About 300 tokens, at three characters a token. */
const TARGET_CHARS = 1000
/** A piece is cut once it would pass this (about 400 tokens). */
const MAX_CHARS = 1200
/** Carried over into the next piece when a long section is cut. */
const OVERLAP_CHARS = 150

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const BOLD_LINE = /^\s*\*\*([^*\n]{1,80}?)\*\*\s*:?\s*$/

/** What is embedded for a piece: the note's title and headings, then the text (EmbeddingGemma's document form). */
export const chunkInput = (title: string, chunk: Pick<NoteChunk, 'path' | 'text'>): string =>
  `title: ${[title, ...chunk.path].join(' > ')} | text: ${chunk.text}`

const hashOf = (text: string): string => createHash('sha1').update(text).digest('hex')

/** The end of the overlap: the last sentence or line of a piece, at most OVERLAP_CHARS. */
function tail(text: string): string {
  const end = text.slice(-OVERLAP_CHARS)
  const cut = end.search(/(?<=[.!?\n])\s+\S/)
  return (cut === -1 ? end : end.slice(cut)).trim()
}

export function chunkNote(title: string, markdown: string): NoteChunk[] {
  const lines = markdown.split(/\r?\n/)
  const close = frontmatterClose(lines)
  const body = close === -1 ? lines : lines.slice(close + 1)

  const sections: { path: string[]; text: string }[] = []
  const stack: { level: number; text: string }[] = []
  let buffer: string[] = []
  let inFence = false
  const flush = (): void => {
    const text = buffer.join('\n').trim()
    buffer = []
    if (text !== '') sections.push({ path: stack.map((h) => h.text), text })
  }
  const enter = (level: number, text: string): void => {
    flush()
    while (stack.length > 0 && stack.at(-1)!.level >= level) stack.pop()
    stack.push({ level, text })
  }
  for (const line of body) {
    if (CODE_FENCE.test(line)) inFence = !inFence
    const h = inFence ? null : HEADING.exec(line)
    if (h !== null) {
      enter(h[1]!.length, h[2]!.trim())
      continue
    }
    const bold = inFence ? null : BOLD_LINE.exec(line)
    if (bold !== null) {
      enter(7, bold[1]!.trim().replace(/:$/, ''))
      continue
    }
    buffer.push(line)
  }
  flush()

  // Small neighbours are joined, keeping the piece's shared headings as its path and their own
  // headings as lines in the text; long sections are cut by paragraph, then by line.
  const pieces: { path: string[]; text: string }[] = []
  let joinable = false
  for (const section of sections) {
    const last = pieces.at(-1)
    if (joinable && last !== undefined && last.text.length + section.text.length < TARGET_CHARS) {
      let common = 0
      while (common < last.path.length && last.path[common] === section.path[common]) common++
      const own = section.path.slice(common).map((h) => `**${h}**`)
      const dropped = last.path.slice(common).map((h) => `**${h}**`)
      last.text = [...dropped, last.text, '', ...own, section.text].join('\n').trim()
      last.path = last.path.slice(0, common)
      continue
    }
    const before = pieces.length
    const units = section.text.split(/\n\s*\n/).flatMap((p) => (p.length > MAX_CHARS ? p.split('\n') : [p]))
    let piece = ''
    for (const unit of units) {
      const u = unit.length > MAX_CHARS * 2 ? unit.slice(0, MAX_CHARS * 2) : unit
      if (piece !== '' && piece.length + u.length > MAX_CHARS) {
        pieces.push({ path: section.path, text: piece })
        piece = `${tail(piece)}\n${u}`.trim()
      } else piece = piece === '' ? u : `${piece}\n\n${u}`
    }
    if (piece.trim() !== '') pieces.push({ path: section.path, text: piece })
    // Only a section that fit in one piece takes small neighbours after it.
    joinable = pieces.length - before === 1
  }
  return pieces.map((p, idx) => ({ idx, path: p.path, text: p.text, hash: hashOf(chunkInput(title, p)) }))
}
