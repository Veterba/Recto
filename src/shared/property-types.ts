import { splitItems, type Field } from './frontmatter'

/**
 * What a property is, as the panel shows and edits it - Notion's types, kept
 * the Obsidian way: the value in the note is plain YAML whatever its type, and
 * the type itself is the vault's (`.recto/properties.json`, or Obsidian's own
 * `.obsidian/types.json`), one per property name, as Obsidian has it.
 *
 * A property with no type set takes one from its value (`kindFromValue`).
 */
export type PropertyKind = 'text' | 'number' | 'checkbox' | 'date' | 'list' | 'link' | 'url' | 'email'

export const KINDS: readonly { kind: PropertyKind; label: string; icon: string }[] = [
  { kind: 'text', label: 'Text', icon: 'type' },
  { kind: 'number', label: 'Number', icon: 'hash' },
  { kind: 'checkbox', label: 'Checkbox', icon: 'square-check' },
  { kind: 'date', label: 'Date', icon: 'calendar' },
  { kind: 'list', label: 'List', icon: 'tags' },
  { kind: 'link', label: 'Note link', icon: 'link' },
  { kind: 'url', label: 'URL', icon: 'globe' },
  { kind: 'email', label: 'Email', icon: 'at-sign' },
]

export const kindInfo = (kind: PropertyKind): (typeof KINDS)[number] => KINDS.find((k) => k.kind === kind)!

/** The property shown under the title, not as a row. */
export const DESCRIPTION_KEY = 'description'

/** The vault's settings for properties: the type chosen for each property name. */
export type PropertySettings = { types: Record<string, PropertyKind> }

const isKind = (value: unknown): value is PropertyKind => typeof value === 'string' && KINDS.some((k) => k.kind === value)

/** `.recto/properties.json` as read: anything unknown left out. */
export function coerceSettings(raw: unknown): PropertySettings {
  const types: Record<string, PropertyKind> = {}
  const record = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>)['types'] : null
  if (record !== null && typeof record === 'object')
    for (const [key, kind] of Object.entries(record as Record<string, unknown>)) if (isKind(kind)) types[key] = kind
  return { types }
}

/** Obsidian's names for its property types (`.obsidian/types.json`), as Recto's. */
const FROM_OBSIDIAN: Record<string, PropertyKind> = {
  text: 'text',
  multitext: 'list',
  aliases: 'list',
  tags: 'list',
  number: 'number',
  checkbox: 'checkbox',
  date: 'date',
  datetime: 'date',
}

/** `.obsidian/types.json`'s text, as Recto's types; null when it is not there or not JSON. */
export function typesFromObsidian(text: string | null): Record<string, PropertyKind> {
  if (text === null) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {}
  }
  const record = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>)['types'] : null
  const out: Record<string, PropertyKind> = {}
  if (record !== null && typeof record === 'object')
    for (const [key, name] of Object.entries(record as Record<string, unknown>)) {
      const kind = typeof name === 'string' ? FROM_OBSIDIAN[name] : undefined
      if (kind !== undefined) out[key] = kind
    }
  return out
}

const URL_VALUE = /^https?:\/\/\S+$/i
const EMAIL_VALUE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/

/** The kind a value reads as, when its property has none set. */
export function kindFromValue(field: Field): PropertyKind {
  switch (field.type) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'checkbox'
    case 'date':
      return 'date'
    case 'list':
      return 'list'
    case 'link':
      return 'link'
    case 'empty':
      return 'text'
    case 'text': {
      const value = typeof field.value === 'string' ? field.value.trim() : ''
      if (URL_VALUE.test(value)) return 'url'
      if (EMAIL_VALUE.test(value)) return 'email'
      return 'text'
    }
  }
}

/**
 * A property's kind: the one set for its name - Recto's first, then
 * Obsidian's - else what its value reads as.
 */
export function kindOf(field: Field, own: Readonly<Record<string, PropertyKind>>, obsidian: Readonly<Record<string, PropertyKind>>): PropertyKind {
  return own[field.key] ?? obsidian[field.key] ?? kindFromValue(field)
}

/** What a new property of a kind starts as: nothing, but a checkbox is off. */
export const emptyValue = (kind: PropertyKind): Field['value'] => (kind === 'checkbox' ? false : null)

const asText = (value: Field['value']): string =>
  value === null ? '' : Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)

/**
 * A value made into another kind, keeping what can be kept: `12` stays 12 as
 * a number, `a, b` becomes a list of two, a list a line of text. What cannot be
 * kept - words made a number, a date - becomes nothing rather than nonsense.
 */
export function convertValue(value: Field['value'], to: PropertyKind): Field['value'] {
  const text = asText(value).trim()
  switch (to) {
    case 'number': {
      if (typeof value === 'number') return value
      const n = Number(text)
      return text !== '' && Number.isFinite(n) ? n : null
    }
    case 'checkbox':
      return value === true || text.toLowerCase() === 'true'
    case 'date':
      return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null
    case 'list':
      if (Array.isArray(value)) return value
      return text === '' ? null : splitItems(text)
    case 'text':
    case 'link':
    case 'url':
    case 'email':
      return text === '' ? null : text
  }
}
