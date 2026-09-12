/**
 * Extracts the metadata the index needs from a markdown file.
 *
 * Deliberately hand-rolled and dependency-free: this runs once per file on every
 * change, and the things it needs (frontmatter, headings, wikilinks, tags) are
 * line-oriented. Pulling remark in here would mean building a full AST to read
 * five things off it.
 *
 * Pure and synchronous, so it is tested in plain Node with no Electron.
 */

export type WikiLink = {
  /** The raw target as written, before resolution. */
  target: string
  heading: string | null
  alias: string | null
  line: number
}

export type Heading = { text: string; level: number; line: number }
export type Tag = { tag: string; line: number }

export type ParsedNote = {
  title: string | null
  frontmatter: Record<string, string | number | boolean | null>
  headings: Heading[]
  links: WikiLink[]
  tags: Tag[]
  /** Body with frontmatter stripped - what goes into the FTS index. */
  body: string
}

const FRONTMATTER_FENCE = /^---\s*$/
const HEADING = /^(#{1,6})\s+(.*)$/
const CODE_FENCE = /^\s*(```|~~~)/
/** `[[target#heading|alias]]`, all parts optional but the target. */
const WIKILINK = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g
/**
 * `#tag`, Unicode-aware.
 *
 * Obsidian's rule, kept deliberately: a tag must contain at least one
 * non-numeric character, so `#2026` is not a tag but `#w37` is. Note this means
 * `#ffcc00` IS a tag - a hex colour in prose is genuinely indistinguishable
 * from one, and inventing a heuristic to tell them apart would misfire on real
 * tags far more often than it would help.
 */
const TAG = /(^|[\s(<])#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu
const PURELY_NUMERIC = /^[\p{N}]+$/u

/** Split frontmatter from body without pulling in a YAML parser. */
function splitFrontmatter(lines: readonly string[]): { yaml: string[]; bodyStart: number } {
  if (lines.length === 0 || !FRONTMATTER_FENCE.test(lines[0] ?? '')) return { yaml: [], bodyStart: 0 }
  for (let i = 1; i < lines.length; i++) {
    if (FRONTMATTER_FENCE.test(lines[i] ?? '')) return { yaml: lines.slice(1, i), bodyStart: i + 1 }
  }
  // An unterminated fence is a broken file, not frontmatter. Treat it as body
  // so the note still indexes instead of silently disappearing from search.
  return { yaml: [], bodyStart: 0 }
}

/**
 * Flat `key: value` only. Nested YAML is not something the index needs, and a
 * real parser can be swapped in later without touching callers.
 */
function parseFrontmatter(lines: readonly string[]): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  for (const raw of lines) {
    const at = raw.indexOf(':')
    if (at <= 0 || raw.startsWith('#') || raw.startsWith(' ') || raw.startsWith('-')) continue
    const key = raw.slice(0, at).trim()
    if (key === '') continue

    let value = raw.slice(at + 1).trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) value = value.slice(1, -1)
    else if (value.startsWith("'") && value.endsWith("'") && value.length > 1) value = value.slice(1, -1)

    if (value === '') out[key] = null
    else if (value === 'true') out[key] = true
    else if (value === 'false') out[key] = false
    else if (/^-?\d+(\.\d+)?$/.test(value)) out[key] = Number(value)
    else out[key] = value
  }
  return out
}

export function parseNote(content: string): ParsedNote {
  const lines = content.split(/\r?\n/)
  const { yaml, bodyStart } = splitFrontmatter(lines)
  const frontmatter = parseFrontmatter(yaml)

  const headings: Heading[] = []
  const links: WikiLink[] = []
  const tags: Tag[] = []
  const bodyLines: string[] = []

  let inCode = false

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i] ?? ''
    bodyLines.push(line)

    if (CODE_FENCE.test(line)) {
      inCode = !inCode
      continue
    }
    // Links and tags inside a fenced block are code, not references.
    if (inCode) continue

    const heading = HEADING.exec(line)
    let scannable = line
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      headings.push({ text: heading[2].trim(), level: heading[1].length, line: i })
      // Scan the heading's text for links, but not its leading '#' marks.
      scannable = heading[2]
    }

    for (const match of scannable.matchAll(WIKILINK)) {
      const target = match[1]?.trim()
      if (target === undefined || target === '') continue
      links.push({
        target,
        heading: match[2]?.trim() ?? null,
        alias: match[3]?.trim() ?? null,
        line: i,
      })
    }

    // Strip wikilinks before tag scanning, so `[[note#heading]]` is not a tag.
    for (const match of scannable.replace(WIKILINK, ' ').matchAll(TAG)) {
      const tag = match[2]
      if (tag !== undefined && !PURELY_NUMERIC.test(tag)) tags.push({ tag, line: i })
    }
  }

  const fmTitle = frontmatter['title']
  const title =
    typeof fmTitle === 'string' && fmTitle !== ''
      ? fmTitle
      : (headings.find((h) => h.level === 1)?.text ?? null)

  return { title, frontmatter, headings, links, tags, body: bodyLines.join('\n') }
}

/**
 * Resolve a wikilink target against known note paths, Obsidian-style: prefer an
 * exact path, then the shortest unique path whose filename matches.
 *
 * Case-insensitive and Unicode-normalised, because `Заметка` typed two different
 * ways is the same file to a user.
 */
export function resolveLink(target: string, pathsByName: ReadonlyMap<string, string[]>, allPaths: ReadonlySet<string>): string | null {
  const clean = target.replace(/\\/g, '/').replace(/^\.\//, '').trim()

  for (const candidate of [clean, `${clean}.md`]) {
    if (allPaths.has(candidate)) return candidate
  }

  const name = normalizeName(clean.slice(clean.lastIndexOf('/') + 1))
  const matches = pathsByName.get(name)
  if (matches === undefined || matches.length === 0) return null
  if (matches.length === 1) return matches[0] ?? null

  // Ambiguous name: prefer one whose path ends with what was written - but only
  // when a path was actually written. For a bare name every candidate ends with
  // it, so this branch would just return whichever happened to be first.
  if (clean.includes('/')) {
    const suffix = normalizeName(clean)
    const exact = matches.find((p) => normalizeName(p.replace(/\.md$/, '')).endsWith(suffix))
    if (exact !== undefined) return exact
  }

  // Still ambiguous - shortest path wins, which is Obsidian's rule.
  return [...matches].sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)[0] ?? null
}

export const normalizeName = (value: string): string =>
  value.normalize('NFC').toLowerCase().replace(/\.md$/, '')
