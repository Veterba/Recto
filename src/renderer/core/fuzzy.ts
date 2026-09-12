/**
 * One fuzzy matcher for the whole app.
 *
 * The separation that matters is `match -> ranges -> render`: the matcher returns
 * character ranges and a score, and knows nothing about the DOM. That is why the
 * command palette, the quick switcher and settings search can all be one
 * implementation instead of three that drift.
 */

/** Inclusive-start, exclusive-end offsets into the haystack. */
export type MatchRange = readonly [start: number, end: number]

export type FuzzyMatch = {
  score: number
  ranges: MatchRange[]
}

const SEPARATORS = new Set([' ', '-', '_', '/', '.', ':', '\\'])

function isBoundary(text: string, i: number): boolean {
  if (i === 0) return true
  const prev = text[i - 1]
  const cur = text[i]
  if (prev === undefined || cur === undefined) return false
  if (SEPARATORS.has(prev)) return true
  // camelCase boundary
  return prev === prev.toLowerCase() && cur !== cur.toLowerCase()
}

/** Collapse adjacent indices into ranges so the renderer emits few spans. */
function toRanges(indices: number[]): MatchRange[] {
  const out: MatchRange[] = []
  for (const i of indices) {
    const last = out[out.length - 1]
    if (last && last[1] === i) out[out.length - 1] = [last[0], i + 1]
    else out.push([i, i + 1])
  }
  return out
}

/**
 * Subsequence match, case-insensitive, greedy left-to-right.
 *
 * Returns null when the query is not a subsequence of the text. Higher score is
 * better; scoring rewards matches at word boundaries and consecutive runs, which
 * is what makes "vc" rank "vault:close" above "editor:vertical-center".
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return { score: 0, ranges: [] }

  const lower = text.toLowerCase()
  const indices: number[] = []

  let ti = 0
  for (const char of q) {
    if (char === ' ') continue
    const found = lower.indexOf(char, ti)
    if (found === -1) return null
    indices.push(found)
    ti = found + 1
  }
  if (indices.length === 0) return { score: 0, ranges: [] }

  // Scoring, in one place so it can be reasoned about:
  //
  //  - a word-boundary hit is worth far more than a mid-word hit, because
  //    typing initials ("cp" for "Command Palette") is how people actually
  //    drive a palette;
  //  - a gap is only penalised when the character AFTER it is NOT on a
  //    boundary. Penalising raw distance instead punishes initials matches for
  //    the words being long, which is exactly backwards;
  //  - consecutive characters compound, so a literal substring still wins
  //    against an equally-positioned scattered match;
  //  - length is a tiebreak only: between two equally good matches the shorter
  //    haystack is the tighter one.
  const BASE = 10
  const BOUNDARY = 18
  const AT_START = 10
  const RUN_STEP = 8
  const GAP_PER_CHAR = 2
  const GAP_CAP = 8

  let score = 0
  let run = 0
  for (let i = 0; i < indices.length; i++) {
    const at = indices[i]
    if (at === undefined) continue
    const prev = i > 0 ? indices[i - 1] : undefined
    const consecutive = prev !== undefined && at === prev + 1
    run = consecutive ? run + 1 : 0

    score += BASE
    if (run > 0) score += run * RUN_STEP

    const boundary = isBoundary(text, at)
    if (boundary) score += BOUNDARY
    if (at === 0) score += AT_START

    if (prev !== undefined && !consecutive && !boundary) {
      score -= Math.min(GAP_CAP, (at - prev - 1) * GAP_PER_CHAR)
    }
  }
  score -= Math.max(0, text.length - q.length) * 0.1

  return { score, ranges: toRanges(indices) }
}

export type Scored<T> = { item: T; match: FuzzyMatch }

/** Filter + rank a list by a query, using `key` as the haystack. */
export function fuzzyFilter<T>(query: string, items: readonly T[], key: (item: T) => string): Scored<T>[] {
  const out: Scored<T>[] = []
  for (const item of items) {
    const match = fuzzyMatch(query, key(item))
    if (match) out.push({ item, match })
  }
  out.sort((a, b) => b.match.score - a.match.score || key(a.item).length - key(b.item).length)
  return out
}

/** Split text into alternating plain/highlighted segments for rendering. */
export function toSegments(text: string, ranges: readonly MatchRange[]): { text: string; hit: boolean }[] {
  if (ranges.length === 0) return [{ text, hit: false }]
  const out: { text: string; hit: boolean }[] = []
  let at = 0
  for (const [start, end] of ranges) {
    if (start > at) out.push({ text: text.slice(at, start), hit: false })
    out.push({ text: text.slice(start, end), hit: true })
    at = end
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false })
  return out
}
