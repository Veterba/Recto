/**
 * Rewriting links when the note they point at is renamed.
 *
 * Pure and string-only, so it is tested directly. This is the operation that
 * silently corrupts notes if it is slightly wrong - it edits files the user is
 * not looking at - so the rules are written out rather than inferred:
 *
 *  - only the *target* part changes; an alias and a `#heading` are preserved
 *    exactly, because they are the user's words, not a path;
 *  - a link that was written as a bare name stays a bare name; one written with
 *    a path keeps its directory prefix replaced wholesale by the new location;
 *  - an explicit `.md` suffix is preserved if it was there;
 *  - links inside fenced code blocks are left alone, for the same reason the
 *    indexer ignores them: that is code, not a reference.
 */

import { MARKDOWN_LINK, markdownTarget, WIKILINK } from '../shared/link-syntax'
import { nextFence, type Fence } from '../shared/parse'
import { isCrlf } from '../shared/line-endings'

const normalize = (value: string): string => value.normalize('NFC').toLowerCase().replace(/\.md$/, '')

/**
 * Does this link target refer to `path`? With `exact`, only a link that spells
 * out the whole path does - how a topic (`topics/Python`) is renamed without
 * touching `[[Python]]`, which names an ordinary note.
 */
function pointsAt(target: string, path: string, exact = false): boolean {
  const cleanTarget = normalize(target.replace(/\\/g, '/').replace(/^\.\//, '').trim())
  const cleanPath = normalize(path)
  if (cleanTarget === cleanPath) return true
  if (exact) return false
  // A bare name matches the note's filename.
  const basename = cleanPath.slice(cleanPath.lastIndexOf('/') + 1)
  if (!cleanTarget.includes('/') && cleanTarget === basename) return true
  // A partial path matches if it is a suffix on a segment boundary.
  return cleanTarget.includes('/') && cleanPath.endsWith(`/${cleanTarget}`)
}

/** Build the replacement target, matching how the original was written. */
function replacementTarget(original: string, oldPath: string, newPath: string): string {
  const trimmed = original.trim()
  const hadExtension = /\.md$/i.test(trimmed)
  const hadPath = trimmed.includes('/')

  const newBase = newPath.slice(newPath.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  const newWithoutExtension = newPath.replace(/\.md$/i, '')

  if (!hadPath) return hadExtension ? `${newBase}.md` : newBase

  // The original spelled out a path. How much of it? Keep the same depth so a
  // link written as 'folder/note' does not become an absolute vault path.
  const depth = trimmed.replace(/\.md$/i, '').split('/').length
  const segments = newWithoutExtension.split('/')
  const kept = segments.slice(Math.max(0, segments.length - depth)).join('/')
  return hadExtension ? `${kept}.md` : kept
}

type RewriteResult = { text: string; count: number }

/**
 * Rewrite every link in `text` that points at `oldPath` so it points at
 * `newPath`. Returns the new text and how many links changed.
 */
export function rewriteWikiLinks(text: string, oldPath: string, newPath: string, exact = false): RewriteResult {
  const lines = text.split(/\r?\n/)
  let count = 0
  let fence: Fence = null

  const out = lines.map((line) => {
    const next = nextFence(line, fence)
    if (next !== fence) {
      fence = next
      return line
    }
    if (fence !== null) return line

    const wiki = line.replace(WIKILINK, (whole, target: string, heading = '', alias = '') => {
      if (!pointsAt(target, oldPath, exact)) return whole
      count++
      // Leading/trailing spaces inside the brackets are preserved so the
      // rewrite is as small an edit as possible.
      const leading = /^\s*/.exec(target)?.[0] ?? ''
      const trailing = /\s*$/.exec(target)?.[0] ?? ''
      return `[[${leading}${replacementTarget(target, oldPath, newPath)}${trailing}${heading}${alias}]]`
    })

    return wiki.replace(MARKDOWN_LINK, (whole, bang: string, text: string, url: string) => {
      // `![alt](image.png)` is an embed, not a link to a note.
      const parsed = bang === '!' ? null : markdownTarget(url)
      if (parsed === null || !pointsAt(parsed.path, oldPath, exact)) return whole
      count++
      const replaced = replacementTarget(parsed.path, oldPath, newPath)
      // A link written with `%20` keeps its encoding; one written with plain
      // spaces keeps those. Either is valid markdown, and the smaller edit is
      // the one that does not change how the rest of the note is written.
      const encoded = parsed.encoded ? replaced.replace(/ /g, '%20') : replaced
      return `[${text}](${parsed.prefix}${encoded}${parsed.suffix})`
    })
  })

  // A CRLF note stays CRLF: only the links change, not every line ending.
  return { text: out.join(isCrlf(text) ? '\r\n' : '\n'), count }
}

/**
 * Change link targets one by one: `map` is handed each target as written (a
 * markdown link's decoded path) and returns its replacement, or null to leave
 * it. Aliases, headings, encoding and code blocks are kept as
 * `rewriteWikiLinks` keeps them. Returns the new text and each change.
 */
export function mapLinkTargets(
  text: string,
  map: (target: string, kind: 'wiki' | 'markdown') => string | null,
): { text: string; changes: { from: string; to: string }[] } {
  const changes: { from: string; to: string }[] = []
  let fence: Fence = null
  const out = text.split(/\r?\n/).map((line) => {
    const next = nextFence(line, fence)
    if (next !== fence) {
      fence = next
      return line
    }
    if (fence !== null) return line
    const wiki = line.replace(WIKILINK, (whole, target: string, heading = '', alias = '') => {
      const next = map(target.trim(), 'wiki')
      if (next === null) return whole
      changes.push({ from: target.trim(), to: next })
      const leading = /^\s*/.exec(target)?.[0] ?? ''
      const trailing = /\s*$/.exec(target)?.[0] ?? ''
      return `[[${leading}${next}${trailing}${heading}${alias}]]`
    })
    return wiki.replace(MARKDOWN_LINK, (whole, bang: string, label: string, url: string) => {
      const parsed = bang === '!' ? null : markdownTarget(url)
      if (parsed === null) return whole
      const next = map(parsed.path, 'markdown')
      if (next === null) return whole
      changes.push({ from: parsed.path, to: next })
      const encoded = parsed.encoded ? next.replace(/ /g, '%20') : next
      return `[${label}](${parsed.prefix}${encoded}${parsed.suffix})`
    })
  })
  return { text: out.join(isCrlf(text) ? '\r\n' : '\n'), changes }
}
