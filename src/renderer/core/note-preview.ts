import { bodyOf, parseFrontmatter } from './frontmatter'
import { extractTargets } from './link-targets'

/**
 * The gist of a note, compiled from the note itself.
 *
 * Local and deterministic on purpose. A hover preview fires every time the
 * pointer rests on a row; making each of those an AI call would spend money
 * and send note contents off the machine for a glance. Most of what a person
 * wants from a glance is structure anyway - what it is titled, what it is
 * tagged, how it is laid out, how it starts, how done its checklist is - and
 * all of that is in the file. The AI summary is a button in the preview, for
 * when you actually want one.
 */

export type NotePreview = {
  title: string
  /** Frontmatter, minus tags (shown separately), as display strings. */
  properties: { key: string; value: string }[]
  tags: string[]
  /** H2/H3 headings, in order - the note's shape at a glance. */
  outline: { level: 2 | 3; text: string }[]
  /** The opening prose, markdown stripped. Empty if the note has none. */
  excerpt: string
  tasks: { done: number; total: number }
  words: number
  /** Outgoing `[[links]]`, de-duplicated. */
  links: number
  images: number
}

const MAX_PROPERTIES = 4
const MAX_OUTLINE = 6
const EXCERPT_CHARS = 280

const FENCE = /^\s*(```|~~~)/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const TASK = /^\s*[-*+]\s+\[([ xX])\]\s/
const IMAGE = /!\[[^\]]*\]\([^)]+\)/g
const INLINE_TAG = /(?:^|\s)#([\p{L}\p{N}_/-]+)/gu

/**
 * Markdown to plain words, for the excerpt.
 *
 * Aliases win over targets in `[[target|alias]]` because the alias is what the
 * author wanted read; images vanish rather than leaving their alt text
 * mid-sentence.
 */
export function plainText(line: string): string {
  return line
    .replace(IMAGE, '')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function display(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (value === null || value === undefined) return ''
  return String(value)
}

export function summariseNote(text: string, fileName: string): NotePreview {
  const front = parseFrontmatter(text)
  const body = bodyOf(text)

  const tags = new Set<string>()
  const properties: NotePreview['properties'] = []
  for (const field of front.fields) {
    if (field.key === 'tags' || field.key === 'tag') {
      const values = Array.isArray(field.value) ? field.value : display(field.value).split(/[,\s]+/)
      for (const tag of values) if (tag.trim() !== '') tags.add(tag.trim().replace(/^#/, ''))
      continue
    }
    const shown = display(field.value)
    if (shown !== '' && properties.length < MAX_PROPERTIES) properties.push({ key: field.key, value: shown })
  }

  let title = ''
  const outline: NotePreview['outline'] = []
  const excerpt: string[] = []
  let excerptDone = false
  let inFence = false
  let done = 0
  let total = 0
  let words = 0
  let images = 0

  for (const line of body.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      inFence = !inFence
      // A code block ends the opening prose: code is not a gist.
      if (excerpt.length > 0) excerptDone = true
      continue
    }
    if (inFence) continue

    words += line.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
    images += line.match(IMAGE)?.length ?? 0
    for (const match of line.matchAll(INLINE_TAG)) if (match[1] !== undefined) tags.add(match[1])

    const task = TASK.exec(line)
    if (task !== null) {
      total++
      if (task[1] !== ' ') done++
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      const level = heading[1]!.length
      const textOf = plainText(heading[2] ?? '')
      if (level === 1 && title === '') title = textOf
      else if ((level === 2 || level === 3) && outline.length < MAX_OUTLINE && textOf !== '') {
        outline.push({ level, text: textOf })
      }
      // The excerpt is the note's OPENING prose: once a section heading
      // follows some text, the opening is over.
      if (level > 1 && excerpt.length > 0) excerptDone = true
      continue
    }

    if (!excerptDone && task === null) {
      const plain = plainText(line)
      if (plain === '') {
        if (excerpt.join(' ').length >= EXCERPT_CHARS / 2) excerptDone = true
        continue
      }
      if (/^[-*_]{3,}$/.test(line.trim())) continue
      excerpt.push(plain)
      if (excerpt.join(' ').length >= EXCERPT_CHARS) excerptDone = true
    }
  }

  let joined = excerpt.join(' ')
  if (joined.length > EXCERPT_CHARS) {
    // Cut at a word, not mid-word.
    const cut = joined.slice(0, EXCERPT_CHARS)
    joined = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), EXCERPT_CHARS - 40)).trimEnd()}…`
  }

  const frontTitle = front.fields.find((field) => field.key === 'title')
  return {
    title: title || display(frontTitle?.value) || fileName.replace(/\.md$/i, ''),
    properties: properties.filter((p) => p.key !== 'title'),
    tags: [...tags],
    outline,
    excerpt: joined,
    tasks: { done, total },
    words,
    links: extractTargets(body).length,
    images,
  }
}

/** "3 min", "under a minute" - at an ordinary 230 words a minute. */
export function readingTime(words: number): string {
  if (words === 0) return 'empty'
  const minutes = Math.round(words / 230)
  return minutes < 1 ? 'under a minute' : `${minutes} min read`
}

/** "just now", "5 min ago", "yesterday", "12 Sep" - relative while it is recent. */
export function edited(mtime: number, now: number = Date.now()): string {
  const seconds = Math.max(0, (now - mtime) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`
  if (seconds < 172_800) return 'yesterday'
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)} days ago`
  const date = new Date(mtime)
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
  })
}
