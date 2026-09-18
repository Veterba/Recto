import { useSyncExternalStore } from 'react'
import type { FocusUnit } from '../editor/focus-range'

/**
 * iA Writer's writing tools, as one settings object: focus mode, syntax
 * highlight, style check and authorship. Saved in `.recto/writing.json`.
 *
 * A module store rather than component state, because four places read it at
 * once - the editor's decorations, the shell (which hides its chrome in focus
 * mode), the toolbar menu and Settings - and they must never disagree about
 * whether focus mode is on.
 */

export type WritingSettings = {
  focus: boolean
  focusUnit: FocusUnit
  /** Keep the line being written in the middle of the window. */
  typewriter: boolean
  /** How faint the text outside focus is, 0.1-0.6 as opacity. */
  dim: number
  /**
   * Text size in focus mode, in pixels - its own setting, not the editor's.
   *
   * Focus mode is read at a different distance from the editor: people write
   * in it with the window full of one paragraph, and the size that suits a
   * note full of structure is not the size that suits that. Tying the two
   * together meant choosing one and living with it in the other.
   */
  fontSize: number
  syntax: {
    on: boolean
    adjectives: boolean
    nouns: boolean
    adverbs: boolean
    verbs: boolean
    conjunctions: boolean
  }
  style: {
    on: boolean
    fillers: boolean
    cliches: boolean
    redundancies: boolean
    custom: boolean
    customWords: string[]
  }
  authors: {
    /** Show who wrote what. Off is iA's "Hide authors". */
    on: boolean
    human: boolean
    ai: boolean
    reference: boolean
  }
  /** Red underlines under misspelt words, with suggestions on right-click. */
  spellcheck: boolean
}

export const DEFAULT_WRITING: WritingSettings = {
  focus: false,
  focusUnit: 'line',
  typewriter: false,
  dim: 0.28,
  fontSize: 19,
  syntax: { on: false, adjectives: true, nouns: true, adverbs: true, verbs: true, conjunctions: true },
  style: { on: false, fillers: true, cliches: true, redundancies: true, custom: true, customWords: [] },
  authors: { on: true, human: true, ai: true, reference: true },
  spellcheck: false,
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const flags = <T extends Record<string, boolean | string[]>>(raw: unknown, fallback: T): T => {
  const r = record(raw)
  const out = { ...fallback }
  for (const key of Object.keys(fallback) as (keyof T)[]) {
    const value = r[key as string]
    if (typeof fallback[key] === 'boolean' && typeof value === 'boolean') out[key] = value as T[keyof T]
  }
  return out
}

export function coerceWriting(raw: unknown): WritingSettings {
  const r = record(raw)
  const d = DEFAULT_WRITING
  const style = flags(r['style'], d.style)
  const words = record(r['style'])['customWords']
  style.customWords = Array.isArray(words)
    ? [...new Set(words.filter((w): w is string => typeof w === 'string').map((w) => w.trim()).filter((w) => w !== ''))].slice(0, 500)
    : []
  return {
    focus: typeof r['focus'] === 'boolean' ? r['focus'] : d.focus,
    focusUnit: r['focusUnit'] === 'sentence' || r['focusUnit'] === 'paragraph' || r['focusUnit'] === 'line' ? r['focusUnit'] : d.focusUnit,
    typewriter: typeof r['typewriter'] === 'boolean' ? r['typewriter'] : d.typewriter,
    dim: typeof r['dim'] === 'number' && Number.isFinite(r['dim']) ? Math.min(0.6, Math.max(0.1, r['dim'])) : d.dim,
    fontSize:
      typeof r['fontSize'] === 'number' && Number.isFinite(r['fontSize'])
        ? Math.min(32, Math.max(12, Math.round(r['fontSize'])))
        : d.fontSize,
    syntax: flags(r['syntax'], d.syntax),
    style,
    authors: flags(r['authors'], d.authors),
    spellcheck: typeof r['spellcheck'] === 'boolean' ? r['spellcheck'] : d.spellcheck,
  }
}

// --- the store -------------------------------------------------------------------

let current: WritingSettings = DEFAULT_WRITING
const listeners = new Set<() => void>()
let save: ((next: WritingSettings) => void) | null = null

export const getWriting = (): WritingSettings => current

export function subscribeWriting(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Load a vault's settings; `persist` is how later changes get written back. */
export function loadWriting(raw: unknown, persist: (next: WritingSettings) => void): void {
  save = persist
  current = coerceWriting(raw)
  for (const listener of listeners) listener()
}

export function updateWriting(patch: (settings: WritingSettings) => WritingSettings): void {
  current = patch(current)
  for (const listener of listeners) listener()
  save?.(current)
}

export const useWriting = (): WritingSettings => useSyncExternalStore(subscribeWriting, getWriting)

export const toggleFocus = (): void => updateWriting((s) => ({ ...s, focus: !s.focus }))
export const toggleTypewriter = (): void => updateWriting((s) => ({ ...s, typewriter: !s.typewriter }))
export const toggleSyntax = (): void => updateWriting((s) => ({ ...s, syntax: { ...s.syntax, on: !s.syntax.on } }))
export const toggleStyle = (): void => updateWriting((s) => ({ ...s, style: { ...s.style, on: !s.style.on } }))
export const toggleAuthors = (): void => updateWriting((s) => ({ ...s, authors: { ...s.authors, on: !s.authors.on } }))
export const setFocusUnit = (focusUnit: FocusUnit): void => updateWriting((s) => ({ ...s, focusUnit }))
