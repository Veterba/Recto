import { useSyncExternalStore } from 'react'

/**
 * A note's headings, as an outline - and whether the outline panel is open.
 *
 * Read from the text rather than the editor's syntax tree so the panel can be a
 * plain React component, and so it can be tested without an editor. It follows
 * the same rules the editor does for what counts as a heading: `#` to `######`
 * followed by a space, and never inside a fenced code block, a `$$` maths block
 * or the frontmatter - a `# comment` in a bash snippet is not a section.
 */

export type OutlineItem = {
  level: number
  text: string
  /** 1-based, as the editor counts lines. */
  line: number
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const HEADING = /^\s{0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/

/** Inline markdown stripped down to what a reader sees. */
const plain = (text: string): string =>
  text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|==|~~|`)(.+?)\1/g, '$2')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .trim()

export function outlineOf(text: string): OutlineItem[] {
  const lines = text.split('\n')
  const items: OutlineItem[] = []
  let start = 0

  // Frontmatter: a `---` on the very first line, closed by the next one.
  if (/^---\s*$/.test(lines[0] ?? '')) {
    const close = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line))
    if (close > 0) start = close + 1
  }

  let fence: string | null = null
  let maths = false
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const opener = FENCE.exec(line)
    if (fence !== null) {
      if (opener !== null && opener[1]?.[0] === fence[0] && (opener[1]?.length ?? 0) >= fence.length) fence = null
      continue
    }
    if (opener?.[1] !== undefined) {
      fence = opener[1]
      continue
    }
    if (/^\s*\$\$/.test(line)) {
      // `$$ x $$` on one line opens and closes.
      if (!(maths === false && /\$\$.*\S.*\$\$\s*$/.test(line.trim()))) maths = !maths
      continue
    }
    if (maths) continue
    const heading = HEADING.exec(line)
    if (heading?.[1] === undefined) continue
    const label = plain(heading[2] ?? '')
    if (label === '') continue
    items.push({ level: heading[1].length, text: label, line: i + 1 })
  }
  return items
}

/** The heading whose section contains this line, as an index into `items`. */
export function currentSection(items: readonly OutlineItem[], line: number): number {
  let found = -1
  for (let i = 0; i < items.length; i++) {
    if ((items[i]?.line ?? Infinity) <= line) found = i
    else break
  }
  return found
}

// --- the panel's open state ----------------------------------------------------

const KEY = 'recto.outline.open'
const listeners = new Set<() => void>()

let open = ((): boolean => {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
})()

export function setOutlineOpen(next: boolean): void {
  open = next
  try {
    window.localStorage.setItem(KEY, next ? '1' : '0')
  } catch {
    // Storage can be unavailable; the panel still toggles for this session.
  }
  for (const listener of listeners) listener()
}

export const toggleOutline = (): void => setOutlineOpen(!open)

export function useOutlineOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => open,
  )
}

// --- remembered folds ------------------------------------------------------------

const foldKey = (path: string): string => `recto.folds:${path}`

/** Folded line numbers for a note, as last left. */
export function readFolds(path: string): number[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(foldKey(path)) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((n): n is number => Number.isInteger(n) && n > 0) : []
  } catch {
    return []
  }
}

export function writeFolds(path: string, lines: readonly number[]): void {
  try {
    if (lines.length === 0) window.localStorage.removeItem(foldKey(path))
    else window.localStorage.setItem(foldKey(path), JSON.stringify(lines))
  } catch {
    // Folds are a convenience; losing them is not worth an error.
  }
}
