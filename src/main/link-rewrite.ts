/**
 * Rewriting `[[wikilinks]]` when the note they point at is renamed.
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

const FENCE = /^\s*(```|~~~)/
const WIKILINK = /\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g

const normalize = (value: string): string =>
  value.normalize('NFC').toLowerCase().replace(/\.md$/, '')

/** Does this link target refer to `path`? */
function pointsAt(target: string, path: string): boolean {
  const cleanTarget = normalize(target.replace(/\\/g, '/').replace(/^\.\//, '').trim())
  const cleanPath = normalize(path)
  if (cleanTarget === cleanPath) return true
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

export type RewriteResult = { text: string; count: number }

/**
 * Rewrite every link in `text` that points at `oldPath` so it points at
 * `newPath`. Returns the new text and how many links changed.
 */
export function rewriteWikiLinks(text: string, oldPath: string, newPath: string): RewriteResult {
  const lines = text.split(/\r?\n/)
  let count = 0
  let inCode = false

  const out = lines.map((line) => {
    if (FENCE.test(line)) {
      inCode = !inCode
      return line
    }
    if (inCode) return line

    return line.replace(WIKILINK, (whole, target: string, heading = '', alias = '') => {
      if (!pointsAt(target, oldPath)) return whole
      count++
      // Leading/trailing spaces inside the brackets are preserved so the
      // rewrite is as small an edit as possible.
      const leading = /^\s*/.exec(target)?.[0] ?? ''
      const trailing = /\s*$/.exec(target)?.[0] ?? ''
      return `[[${leading}${replacementTarget(target, oldPath, newPath)}${trailing}${heading}${alias}]]`
    })
  })

  return { text: out.join('\n'), count }
}

/** Every distinct wikilink target in a document, for resolution checks. */
export function extractTargets(text: string): string[] {
  const found = new Set<string>()
  const lines = text.split(/\r?\n/)
  let inCode = false

  for (const line of lines) {
    if (FENCE.test(line)) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    for (const match of line.matchAll(WIKILINK)) {
      const target = match[1]?.trim()
      if (target !== undefined && target !== '') found.add(target)
    }
  }
  return [...found]
}
