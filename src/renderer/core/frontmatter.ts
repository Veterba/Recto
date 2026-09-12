/**
 * Reading and editing YAML frontmatter without corrupting the note.
 *
 * This is the highest-risk text manipulation in the app so far: it rewrites the
 * top of a file the user is looking at, and a bad write silently destroys
 * metadata. So the rules are explicit and pure, and every one has a test.
 *
 * The central rule: **anything this module does not fully understand is
 * preserved verbatim and never edited.** Nested maps, multi-line YAML lists,
 * anchors, comments - all kept byte-for-byte and surfaced as read-only. A
 * frontmatter editor that quietly flattens a nested key is worse than one that
 * refuses to touch it.
 */

export type FieldType = 'text' | 'number' | 'boolean' | 'list' | 'date' | 'empty'

export type Field = {
  key: string
  /** Raw text after the colon, exactly as written. */
  raw: string
  value: string | number | boolean | string[] | null
  type: FieldType
  /** Index into the frontmatter lines, for in-place replacement. */
  line: number
}

export type Frontmatter = {
  /** True when the file opens with a `---` block. */
  present: boolean
  fields: Field[]
  /**
   * Frontmatter lines this module will not edit - nested structures, comments,
   * list continuations. Shown read-only so nothing is hidden from the user.
   */
  opaque: string[]
  /** Line index in the whole document where the body starts. */
  bodyStart: number
}

const FENCE = /^---\s*$/
/**
 * A frontmatter key. Unicode-aware on purpose: an ASCII-only key pattern makes
 * `название: заметка` unrecognisable, so it would be shown as un-editable
 * "opaque" text. That is the same ASCII-only mistake this project keeps
 * pointing at in its reference app.
 */
const KEY_VALUE = /^([\p{L}\p{N}_][\p{L}\p{N}_ .-]*):(.*)$/u
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/

function unquote(raw: string): string {
  const value = raw.trim()
  if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1)
  if (value.length > 1 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
  return value
}

/** Classify a scalar. Order matters: a date is text-shaped, so test it first. */
function classify(raw: string): { value: Field['value']; type: FieldType } {
  const trimmed = raw.trim()
  if (trimmed === '') return { value: null, type: 'empty' }

  // `[a, b]` or a bare comma list.
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim()
    const items = inner === '' ? [] : inner.split(',').map((part) => unquote(part))
    return { value: items, type: 'list' }
  }

  const unquoted = unquote(trimmed)
  if (unquoted !== trimmed) {
    // It was quoted, so it is text no matter what it looks like inside.
    return { value: unquoted, type: 'text' }
  }

  if (trimmed === 'true' || trimmed === 'false') return { value: trimmed === 'true', type: 'boolean' }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return { value: Number(trimmed), type: 'number' }
  if (ISO_DATE.test(trimmed)) return { value: trimmed, type: 'date' }
  if (trimmed.includes(',')) {
    return { value: trimmed.split(',').map((part) => part.trim()).filter((part) => part !== ''), type: 'list' }
  }
  return { value: trimmed, type: 'text' }
}

export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.split(/\r?\n/)

  if (lines.length === 0 || !FENCE.test(lines[0] ?? '')) {
    return { present: false, fields: [], opaque: [], bodyStart: 0 }
  }

  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(lines[i] ?? '')) {
      close = i
      break
    }
  }
  // An unterminated fence is a broken file, not frontmatter. Treating it as
  // frontmatter would mean "editing a property" rewrote the whole note.
  if (close === -1) return { present: false, fields: [], opaque: [], bodyStart: 0 }

  const block = lines.slice(1, close)
  const fields: Field[] = []
  const opaque: string[] = []

  block.forEach((line, index) => {
    if (line.trim() === '') return
    // Indented lines and list items belong to a structure we do not model.
    if (/^\s/.test(line) || line.trimStart().startsWith('-') || line.trimStart().startsWith('#')) {
      opaque.push(line)
      return
    }
    const match = KEY_VALUE.exec(line)
    if (!match?.[1]) {
      opaque.push(line)
      return
    }
    const key = match[1].trim()
    const raw = match[2] ?? ''
    // A key whose value is empty and whose next line is indented is a nested
    // map or list; leave the whole thing alone.
    const next = block[index + 1]
    if (raw.trim() === '' && next !== undefined && /^\s+\S/.test(next)) {
      opaque.push(line)
      return
    }
    const { value, type } = classify(raw)
    fields.push({ key, raw: raw.trim(), value, type, line: index })
  })

  return { present: true, fields, opaque, bodyStart: close + 1 }
}

/** Render a value back to YAML scalar text. */
export function serialize(value: Field['value']): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.map((item) => item.trim()).filter((i) => i !== '').join(', ')}]`

  const text = value.trim()
  // Quote anything that would otherwise change type on the way back in.
  if (text === '') return '""'
  if (text === 'true' || text === 'false') return `"${text}"`
  if (/^-?\d+(\.\d+)?$/.test(text)) return `"${text}"`
  if (/^[[{>|*&!%@`]/.test(text) || text.includes(': ') || text.endsWith(':')) {
    return `"${text.replace(/"/g, '\\"')}"`
  }
  return text
}

/**
 * Set (or add) one key, leaving the body and every other line untouched.
 *
 * Creates the frontmatter block if the file has none.
 */
export function setField(text: string, key: string, value: Field['value']): string {
  const lines = text.split(/\r?\n/)
  const parsed = parseFrontmatter(text)
  const rendered = `${key}: ${serialize(value)}`.trimEnd()

  if (!parsed.present) {
    // A new block goes above everything, with a blank line after it so the
    // first heading is not glued to the closing fence.
    return ['---', rendered, '---', '', ...lines].join('\n')
  }

  const existing = parsed.fields.find((field) => field.key === key)
  if (existing !== undefined) {
    // +1 because the block starts after the opening fence.
    lines[existing.line + 1] = rendered
    return lines.join('\n')
  }

  // Append inside the block, just before the closing fence.
  const closeIndex = parsed.bodyStart - 1
  lines.splice(closeIndex, 0, rendered)
  return lines.join('\n')
}

/**
 * Remove one key. Removing the last key removes the whole block, because an
 * empty `---\n---` at the top of a note is noise.
 */
export function removeField(text: string, key: string): string {
  const parsed = parseFrontmatter(text)
  if (!parsed.present) return text

  const existing = parsed.fields.find((field) => field.key === key)
  if (existing === undefined) return text

  const lines = text.split(/\r?\n/)

  if (parsed.fields.length === 1 && parsed.opaque.length === 0) {
    const after = lines.slice(parsed.bodyStart)
    // Drop one leading blank line, which is the one setField would have added.
    if (after[0]?.trim() === '') after.shift()
    return after.join('\n')
  }

  lines.splice(existing.line + 1, 1)
  return lines.join('\n')
}

/** Rename a key in place, keeping its value and position. */
export function renameField(text: string, from: string, to: string): string {
  const parsed = parseFrontmatter(text)
  const existing = parsed.fields.find((field) => field.key === from)
  if (existing === undefined || from === to) return text
  if (parsed.fields.some((field) => field.key === to)) return text

  const lines = text.split(/\r?\n/)
  lines[existing.line + 1] = `${to}: ${existing.raw}`.trimEnd()
  return lines.join('\n')
}

/** The document body, with the frontmatter block removed. */
export const bodyOf = (text: string): string =>
  text.split(/\r?\n/).slice(parseFrontmatter(text).bodyStart).join('\n')
