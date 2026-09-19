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

const FENCE = /^\s*(```|~~~)/
const WIKILINK = /\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g
/** `[text](target)`, the other way to write a link. `!` in front is an embed. */
const MARKDOWN_LINK = /(?<!!)(\[[^\]]*\])\(([^)\n]*)\)/g
/** Schemes and shapes that are not a note in this vault. */
const NOT_A_NOTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i

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

/**
 * Take a markdown link's `(...)` apart: the note it points at, and everything
 * around it that has to come back untouched - angle brackets, a `#heading`, a
 * `"title"`. Returns null when it does not point at a note in this vault.
 */
function splitUrl(
  url: string,
): { path: string; prefix: string; suffix: string; encoded: boolean } | null {
  const angled = /^<(.*)>$/.exec(url.trim())
  const inner = angled?.[1] ?? url
  const title = /\s+"[^"]*"$/.exec(inner)
  const withoutTitle = title === null ? inner : inner.slice(0, title.index)
  const hash = withoutTitle.indexOf('#')
  const raw = hash === -1 ? withoutTitle : withoutTitle.slice(0, hash)
  const heading = hash === -1 ? '' : withoutTitle.slice(hash)
  const trimmed = raw.trim()
  if (trimmed === '' || NOT_A_NOTE.test(trimmed)) return null
  let decoded = trimmed
  try {
    decoded = decodeURIComponent(trimmed)
  } catch {
    // A stray '%' is not an escape; take the path as written.
  }
  return {
    path: decoded,
    prefix: angled === null ? '' : '<',
    suffix: `${heading}${title?.[0] ?? ''}${angled === null ? '' : '>'}`,
    encoded: trimmed.includes('%20'),
  }
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

    const wiki = line.replace(WIKILINK, (whole, target: string, heading = '', alias = '') => {
      if (!pointsAt(target, oldPath)) return whole
      count++
      // Leading/trailing spaces inside the brackets are preserved so the
      // rewrite is as small an edit as possible.
      const leading = /^\s*/.exec(target)?.[0] ?? ''
      const trailing = /\s*$/.exec(target)?.[0] ?? ''
      return `[[${leading}${replacementTarget(target, oldPath, newPath)}${trailing}${heading}${alias}]]`
    })

    return wiki.replace(MARKDOWN_LINK, (whole, text: string, url: string) => {
      const parsed = splitUrl(url)
      if (parsed === null || !pointsAt(parsed.path, oldPath)) return whole
      count++
      const replaced = replacementTarget(parsed.path, oldPath, newPath)
      // A link written with `%20` keeps its encoding; one written with plain
      // spaces keeps those. Either is valid markdown, and the smaller edit is
      // the one that does not change how the rest of the note is written.
      const encoded = parsed.encoded ? replaced.replace(/ /g, '%20') : replaced
      return `${text}(${parsed.prefix}${encoded}${parsed.suffix})`
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
