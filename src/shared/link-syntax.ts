/**
 * How a link is written, read the same everywhere: the index, the editor,
 * a rename's rewrite, boards and the AI tools. Each used to have its own
 * pattern, so a link one of them saw another missed - a rename left links
 * the index counted, a table's `[[Note\|alias]]` read as a link to `Note\`.
 */

/**
 * `[[target#subpath|alias]]`: groups target, `#subpath` and `|alias` (both
 * with their marks, as written). In a table the pipe is written `\|`; the
 * backslash belongs to the alias part, never to the target.
 */
export const WIKILINK = /\[\[([^\]|#\n]+?)(#[^\]|\n]+?)?(\\?\|[^\]\n]+)?\]\]/g

/** A wikilink's alias without its `|` or `\|`; undefined for none. */
export const aliasOf = (part: string | undefined): string | undefined => part?.replace(/^\\?\|/, '')

/**
 * `[text](target)`, and `![text](target)` with `!` in the first group. The
 * target is everything up to `)` on the line: `<a b.md>`, `a%20b.md "Title"`
 * and `a b.md` are all links to `a b.md`.
 */
export const MARKDOWN_LINK = /(!?)\[([^\]]*)\]\(([^)\n]*)\)/g

/** Schemes and shapes that are not a file in this vault. */
const NOT_A_FILE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

/**
 * A Markdown link's `(...)` taken apart: the path it points at (decoded, as
 * `%20` is how a space is written), its `#subpath`, and what stays around the
 * path when it is written again - angle brackets, the subpath, a `"title"`.
 * Null when it points at no file in the vault (a URL, `#heading` alone).
 */
export function markdownTarget(url: string): { path: string; subpath: string; prefix: string; suffix: string; encoded: boolean } | null {
  const value = url.trim()
  const title = /\s+"[^"]*"$/.exec(value)
  const destination = (title === null ? value : value.slice(0, title.index)).trim()
  const angled = /^<(.*)>$/.exec(destination)
  const inner = angled?.[1] ?? destination
  const hash = inner.indexOf('#')
  const raw = (hash === -1 ? inner : inner.slice(0, hash)).trim()
  if (raw === '' || NOT_A_FILE.test(raw)) return null
  let path = raw
  try {
    path = decodeURIComponent(raw)
  } catch {
    // A stray '%' is not an escape; take the path as written.
  }
  const subpath = hash === -1 ? '' : inner.slice(hash)
  return {
    path: path.trim(),
    subpath,
    prefix: angled === null ? '' : '<',
    suffix: `${subpath}${angled === null ? '' : '>'}${title?.[0] ?? ''}`,
    encoded: raw.includes('%20'),
  }
}
