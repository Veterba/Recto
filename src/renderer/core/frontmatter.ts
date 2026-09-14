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

export type FieldType = 'text' | 'number' | 'boolean' | 'list' | 'date' | 'link' | 'empty'

export type Field = {
  key: string
  /** Raw text after the colon, exactly as written. */
  raw: string
  value: string | number | boolean | string[] | null
  type: FieldType
  /** Index into the frontmatter lines, for in-place replacement. */
  line: number
  /**
   * How many frontmatter lines the field occupies - 1 for `key: value`, more
   * for a block list, whose `- item` lines follow the key.
   */
  span: number
  /**
   * Written as a block list (`key:` then `  - item` lines) rather than inline
   * (`key: [a, b]`). Kept so an edit writes back the same shape: Obsidian
   * writes block lists, and rewriting every one of them inline on the first
   * edit would churn every synced note.
   */
  block?: { indent: string }
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
/** A value that is nothing but one or more `[[wikilinks]]`, space or comma separated. */
const ONLY_LINKS = /^\[\[[^\[\]]+\]\](?:\s*,?\s*\[\[[^\[\]]+\]\])*$/

function unquote(raw: string): string {
  const value = raw.trim()
  if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1)
  if (value.length > 1 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
  return value
}

/**
 * Split a flow list on commas that are not inside quotes or brackets.
 *
 * A plain `split(',')` cut `"[[Plan, v2]]"` - a link to a note with a comma in
 * its name - into two broken halves.
 */
export function splitItems(inner: string): string[] {
  const items: string[] = []
  let current = ''
  let quote: string | null = null
  let depth = 0
  for (const char of inner) {
    if (quote !== null) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") quote = char
    else if (char === '[') depth++
    else if (char === ']') depth--
    else if (char === ',' && depth === 0) {
      items.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim() !== '') items.push(current)
  return items.map((item) => item.trim())
}

/** Classify a scalar. Order matters: a date is text-shaped, so test it first. */
function classify(raw: string): { value: Field['value']; type: FieldType } {
  const trimmed = raw.trim()
  if (trimmed === '') return { value: null, type: 'empty' }

  // A wikilink, quoted or not. Checked before the list rule, because an
  // unquoted `[[Note]]` also starts with `[` and ends with `]` - it used to be
  // read as a one-item list containing the text `[Note]`, mangling the link.
  const bare = unquote(trimmed)
  if (ONLY_LINKS.test(bare)) return { value: bare, type: 'link' }

  // `[a, b]` or a bare comma list.
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim()
    const items = inner === '' ? [] : splitItems(inner).map((part) => unquote(part))
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

  for (let index = 0; index < block.length; index++) {
    const line = block[index]!
    if (line.trim() === '') continue
    // Indented lines and stray list items belong to a structure we do not model.
    if (/^\s/.test(line) || line.trimStart().startsWith('-') || line.trimStart().startsWith('#')) {
      opaque.push(line)
      continue
    }
    const match = KEY_VALUE.exec(line)
    if (!match?.[1]) {
      opaque.push(line)
      continue
    }
    const key = match[1].trim()
    const raw = match[2] ?? ''
    const next = block[index + 1]

    if (raw.trim() === '' && next !== undefined && /^\s+\S/.test(next)) {
      /**
       * A block list - `tags:` followed by `  - learning` lines.
       *
       * This is how Obsidian writes lists, so every synced note with tags used
       * to show its properties as locked, "kept exactly as written" text. It is
       * now an ordinary, editable list. Only a PURE list qualifies: an indented
       * `key: value` underneath is a nested map, which stays untouched.
       */
      let end = index + 1
      const items: string[] = []
      while (end < block.length && /^\s+-(\s|$)/.test(block[end]!)) {
        items.push(unquote(block[end]!.replace(/^\s+-\s?/, '')))
        end++
      }
      const nestedMap = end < block.length && /^\s+\S/.test(block[end]!)
      if (items.length > 0 && !nestedMap) {
        const linked = items.length > 0 && items.every((item) => ONLY_LINKS.test(item))
        fields.push({
          key,
          raw: '',
          value: linked && items.length === 1 ? items[0]! : items,
          type: linked && items.length === 1 ? 'link' : 'list',
          line: index,
          span: end - index,
          block: { indent: /^\s+/.exec(block[index + 1]!)?.[0] ?? '  ' },
        })
        index = end - 1
        continue
      }
      // A nested map, or a list mixed with one: leave the whole thing alone.
      opaque.push(line)
      while (index + 1 < block.length && /^\s/.test(block[index + 1]!)) opaque.push(block[++index]!)
      continue
    }
    const { value, type } = classify(raw)
    fields.push({ key, raw: raw.trim(), value, type, line: index, span: 1 })
  }

  return { present: true, fields, opaque, bodyStart: close + 1 }
}

/** Render a value back to YAML scalar text. */
export function serialize(value: Field['value']): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    // Each item quoted when it has to be. An unquoted `[[a]]` inside a flow
    // list is a nested list to every YAML reader, including the one in
    // Obsidian - so a list of links must come out as `["[[a]]", "[[b]]"]`.
    const items = value.map((item) => item.trim()).filter((item) => item !== '')
    return `[${items.map((item) => (/^[[{>|*&!%@`"']/.test(item) || item.includes(',') ? `"${item.replace(/"/g, '\\"')}"` : item)).join(', ')}]`
  }

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

/** `key:` and one `- item` line per value, at the indentation the file used. */
function renderBlockList(key: string, items: readonly string[], indent: string): string[] {
  const kept = items.map((item) => item.trim()).filter((item) => item !== '')
  // An emptied block list is written as a bare key, which is what Obsidian does.
  if (kept.length === 0) return [`${key}:`]
  return [`${key}:`, ...kept.map((item) => `${indent}- ${serialize(item)}`)]
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
    // Same shape it was written in: a block list stays a block list.
    const replacement =
      existing.block !== undefined && (Array.isArray(value) || existing.type === 'link')
        ? renderBlockList(key, Array.isArray(value) ? value : value === null ? [] : [String(value)], existing.block.indent)
        : [rendered]
    // +1 because the block starts after the opening fence.
    lines.splice(existing.line + 1, existing.span, ...replacement)
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

  lines.splice(existing.line + 1, existing.span)
  return lines.join('\n')
}

/** Rename a key in place, keeping its value and position. */
export function renameField(text: string, from: string, to: string): string {
  const parsed = parseFrontmatter(text)
  const existing = parsed.fields.find((field) => field.key === from)
  if (existing === undefined || from === to) return text
  if (parsed.fields.some((field) => field.key === to)) return text

  const lines = text.split(/\r?\n/)
  // Only the key line: a block list's items stay exactly where they are.
  lines[existing.line + 1] = `${to}: ${existing.raw}`.trimEnd()
  return lines.join('\n')
}

/** The document body, with the frontmatter block removed. */
export const bodyOf = (text: string): string =>
  text.split(/\r?\n/).slice(parseFrontmatter(text).bodyStart).join('\n')
