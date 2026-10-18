/**
 * A board card's fields, read from and written to the note that is the card.
 *
 * Everything lives in plain frontmatter and Markdown that other editors read
 * too: `priority`, `start`, `due`, `tags`, `completed`, and the note's own
 * checkboxes. Reading is forgiving - a person may have typed any of it by
 * hand. Writing is minimal: only the key being edited changes, in the style
 * it was already written in, so editing a card from the board never reshapes
 * the rest of the file.
 */

import { bodyOf, parseFrontmatter, removeField, setField } from './frontmatter'

export type Priority = 'high' | 'medium' | 'low'
export const PRIORITIES: readonly Priority[] = ['high', 'medium', 'low']

/** `high`, `High`, ` HIGH ` - or null for no priority, or one Recto does not know. */
export function readPriority(raw: unknown): Priority | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toLowerCase()
  return (PRIORITIES as readonly string[]).includes(value) ? (value as Priority) : null
}

/** The date of a date or datetime value, `2026-10-16`; null when it is not one. */
export function dateOnly(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const match = /^\s*["']?(\d{4}-\d{2}-\d{2})/.exec(raw)
  return match?.[1] ?? null
}

/** The local calendar day, `2026-10-16`. */
export function isoDay(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** A date `days` after another, both `YYYY-MM-DD`. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return isoDay(new Date(y!, m! - 1, d! + days))
}

/**
 * The days a card covers. Only one of start and due is a single day. A start
 * after the due date - which the panel refuses to save, but a file can say -
 * is read as the due day alone.
 */
export function cardSpan(start: string | null, due: string | null): { from: string; to: string } | null {
  if (start === null && due === null) return null
  if (start === null) return { from: due!, to: due! }
  if (due === null) return { from: start, to: start }
  return start > due ? { from: due, to: due } : { from: start, to: due }
}

/** Late once its last day has passed; due soon when that day is today or within two days. */
export function dueState(span: { from: string; to: string } | null, today: string): 'late' | 'soon' | null {
  if (span === null) return null
  if (span.to < today) return 'late'
  if (span.to <= addDays(today, 2)) return 'soon'
  return null
}

/**
 * Tags as written in any of the shapes they come in: `ui`, `ui, editor`,
 * `[ui, editor]`, a block list, or the index's comma-joined copy of a list.
 * A leading `#` is dropped - Obsidian accepts both.
 */
export function readTags(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.replace(/^\s*\[|\]\s*$/g, '').split(',') : []
  return items
    .map((item) =>
      item
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/^#/, ''),
    )
    .filter((item) => item !== '')
}

const FENCE = /^\s*(```|~~~)/
const CHECKBOX = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s*)(.*)$/

/** Markdown that only decorates text, taken off: links to their words, emphasis to plain. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](.+?)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A card's description: the first paragraph of the note's body, Markdown
 * stripped. Headings, checkboxes, code and tables are not description - the
 * title and the checklist are shown on their own.
 */
export function cardDescription(body: string): string {
  const lines = body.split('\n')
  const paragraph: string[] = []
  let fenced = false
  for (const raw of lines) {
    if (FENCE.test(raw)) {
      fenced = !fenced
      if (paragraph.length > 0) break
      continue
    }
    if (fenced) continue
    const line = raw.trim()
    const prose = line !== '' && !line.startsWith('#') && !line.startsWith('|') && !CHECKBOX.test(raw) && !/^(-{3,}|\*{3,})$/.test(line)
    if (prose) paragraph.push(line.replace(/^>\s?/, '').replace(/^(?:[-*+]|\d+[.)])\s+/, ''))
    else if (paragraph.length > 0) break
  }
  return stripMarkdown(paragraph.join(' '))
}

export type CheckItem = { text: string; done: boolean }

/** The note's checkboxes, in order, outside code blocks. */
export function checklist(body: string): CheckItem[] {
  const out: CheckItem[] = []
  let fenced = false
  for (const line of body.split(/\r?\n/)) {
    if (FENCE.test(line)) fenced = !fenced
    if (fenced) continue
    const match = CHECKBOX.exec(line)
    if (match !== null) out.push({ text: stripMarkdown(match[4] ?? ''), done: match[2] !== ' ' })
  }
  return out
}

/** Tick or untick the `n`th checkbox of the note's body; every other byte stays. */
export function toggleCheck(text: string, n: number): string {
  const lines = text.split('\n')
  const start = parseFrontmatter(text).bodyStart
  let seen = 0
  let fenced = false
  for (let i = start; i < lines.length; i++) {
    // A file with Windows line ends keeps them.
    const cr = lines[i]!.endsWith('\r') ? '\r' : ''
    const line = cr === '' ? lines[i]! : lines[i]!.slice(0, -1)
    if (FENCE.test(line)) fenced = !fenced
    if (fenced) continue
    const match = CHECKBOX.exec(line)
    if (match === null) continue
    if (seen++ !== n) continue
    lines[i] = `${match[1]}${match[2] === ' ' ? 'x' : ' '}${match[3]}${match[4]}${cr}`
    return lines.join('\n')
  }
  return text
}

/** A comment at the end of a frontmatter line - ` # why` - kept when the value before it changes. */
function trailingComment(text: string, key: string): string {
  const field = parseFrontmatter(text).fields.find((f) => f.key === key)
  if (field === undefined || field.block !== undefined || /^["']/.test(field.raw)) return ''
  return /\s+#.*$/.exec(field.raw)?.[0] ?? ''
}

/**
 * Set one card field, or remove it with null. Only that key's line changes,
 * and a trailing comment on it survives. Dates go in as `YYYY-MM-DD`.
 */
export function setCardField(text: string, key: string, value: string | number | null): string {
  if (value === null) return removeField(text, key)
  const comment = trailingComment(text, key)
  const next = setField(text, key, value)
  if (comment === '') return next
  const field = parseFrontmatter(next).fields.find((f) => f.key === key)!
  const lines = next.split('\n')
  lines[field.line + 1] += comment
  return lines.join('\n')
}

/**
 * Set a card's tags in the shape the file already uses: `tags: ui` stays a
 * scalar while there is one tag, `tags: a, b` stays a bare list, `[a, b]` and
 * block lists stay as they are. A new key is written `tags: [ui]`.
 */
export function setCardTags(text: string, tags: readonly string[]): string {
  const clean = tags.map((tag) => tag.trim().replace(/^#/, '')).filter((tag) => tag !== '')
  if (clean.length === 0) return removeField(text, 'tags')
  const field = parseFrontmatter(text).fields.find((f) => f.key === 'tags')
  if (field === undefined || field.block !== undefined || field.raw.startsWith('[')) return setField(text, 'tags', clean)
  // A scalar, or a bare comma list: written back as text, which the parser reads as the same shape.
  const comment = trailingComment(text, 'tags')
  const bare = clean.join(', ')
  if (clean.length === 1 && field.type !== 'list') return setCardField(text, 'tags', bare)
  const lines = text.split('\n')
  lines[field.line + 1] = `tags: ${bare}${comment}`
  return lines.join('\n')
}

/** What a card shows, read from its note's text the way the index reads it. */
export type CardFields = {
  start: string | null
  due: string | null
  completed: string | null
  priority: string | null
  /** Comma-joined, as the index keeps a list. */
  tags: string | null
  description: string
  checklist: { done: number; total: number }
}

/**
 * A card's fields straight from the text being written, so the board can show
 * an edit before the index has seen the file.
 */
export function cardFields(text: string): CardFields {
  const fields = parseFrontmatter(text).fields
  const value = (key: string): string | null => {
    const raw = fields.find((f) => f.key === key)?.value ?? null
    if (raw === null) return null
    return Array.isArray(raw) ? raw.join(',') : String(raw)
  }
  const body = bodyOf(text)
  const items = checklist(body)
  return {
    start: value('start'),
    due: value('due'),
    completed: value('completed'),
    priority: value('priority'),
    tags: value('tags'),
    description: cardDescription(body),
    checklist: { done: items.filter((item) => item.done).length, total: items.length },
  }
}
