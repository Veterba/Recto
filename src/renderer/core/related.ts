/**
 * The auto-links property (`related` by default): reading its links and
 * writing a new set of them.
 *
 * Shared by main (Auto mode, cleanups) and the renderer (a clicked
 * suggestion), so both write the same shape. Every write goes through
 * `setField` / `removeField` - the tested frontmatter editor - and nothing
 * outside the one key changes, byte for byte.
 */

import { parseFrontmatter, removeField, setField } from './frontmatter'

const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g

/** The link targets in `key`, as written (`Note`, `folder/Note`). */
export function relatedTargets(text: string, key: string): string[] {
  const field = parseFrontmatter(text).fields.find((f) => f.key === key)
  if (field === undefined || field.value === null) return []
  const values = Array.isArray(field.value) ? field.value : [String(field.value)]
  return values.flatMap((value) => [...value.matchAll(WIKILINK)].map((m) => (m[1] ?? '').trim())).filter((t) => t !== '')
}

/**
 * Set `key` to exactly these links, in this order. An empty list removes the
 * key. Line endings are kept: a CRLF note stays CRLF, since `setField` itself
 * joins on `\n`.
 */
export function writeRelated(text: string, key: string, targets: readonly string[]): string {
  const crlf = text.includes('\r\n') && !/(?<!\r)\n/.test(text)
  const plain = crlf ? text.replace(/\r\n/g, '\n') : text
  const next =
    targets.length === 0 ? removeField(plain, key) : setField(plain, key, targets.map((target) => `[[${target}]]`))
  // The safety net: this writes one key. If anything else in the note came
  // out different, the editor misread something - keep the note as it was.
  if (!onlyKeyChanged(plain, next, key)) {
    console.error(`[related] refused a write that would change more than "${key}"`, new Error().stack)
    return text
  }
  return crlf ? next.replace(/\n/g, '\r\n') : next
}

/**
 * Everything in the note except `key`: the other frontmatter lines, as
 * written, and the body. Leading blank lines of the body are not compared -
 * creating or removing a frontmatter block adds or drops the one after it.
 */
function allBut(text: string, key: string): { frontmatter: string[]; body: string } {
  const lines = text.split('\n')
  const parsed = parseFrontmatter(text)
  if (!parsed.present) return { frontmatter: [], body: text.replace(/^\n+/, '') }
  const own = parsed.fields.find((f) => f.key === key)
  // +1: field lines are counted from inside the opening fence.
  const skip = own === undefined ? new Set<number>() : new Set(Array.from({ length: own.span }, (_, i) => own.line + 1 + i))
  return {
    frontmatter: lines.slice(1, parsed.bodyStart - 1).filter((_, i) => !skip.has(i + 1)),
    body: lines.slice(parsed.bodyStart).join('\n').replace(/^\n+/, ''),
  }
}

function onlyKeyChanged(before: string, after: string, key: string): boolean {
  const a = allBut(before, key)
  const b = allBut(after, key)
  return a.body === b.body && a.frontmatter.length === b.frontmatter.length && a.frontmatter.every((line, i) => line === b.frontmatter[i])
}

/**
 * How to write a link to `path`: its bare name when that is unique in the
 * vault, the path without `.md` when it is not - the same rule a rename
 * rewrite follows, so the link survives one.
 */
export function linkTextFor(path: string, allPaths: Iterable<string>): string {
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  const key = name.normalize('NFC').toLowerCase()
  let same = 0
  for (const other of allPaths) {
    if (other.slice(other.lastIndexOf('/') + 1).replace(/\.md$/i, '').normalize('NFC').toLowerCase() === key) same++
  }
  return same > 1 ? path.replace(/\.md$/i, '') : name
}
