import { diffLines } from './line-diff'

/**
 * A three-way merge by lines: the text both sides started from (`base`), and
 * two sides each changed from it - what is being typed, and what another app
 * wrote meanwhile. Changes to different lines are both kept; changes to the
 * same lines (or one inserted where the other changed) are a conflict, and
 * the answer is null - the caller decides which side stands.
 *
 * Built on the line diff (shared/line-diff.ts): each side becomes the runs of
 * base lines it replaced and what it put there.
 */

/** Base lines [from, to) replaced by `lines`; from === to is an insertion before line `from`. */
type Hunk = { from: number; to: number; lines: string[] }

function hunksOf(base: readonly string[], side: readonly string[]): Hunk[] {
  const out: Hunk[] = []
  let at = 0
  let open: Hunk | null = null
  for (const d of diffLines(base, side)) {
    if (d.kind === 'same') {
      if (open !== null) out.push(open)
      open = null
      at++
      continue
    }
    open ??= { from: at, to: at, lines: [] }
    if (d.kind === 'removed') {
      at++
      open.to = at
    } else open.lines.push(d.text)
  }
  if (open !== null) out.push(open)
  return out
}

const sameHunk = (a: Hunk, b: Hunk): boolean => a.from === b.from && a.to === b.to && a.lines.join('\n') === b.lines.join('\n')
/** Two changes that touch the same base lines, or land at the same place. */
const clash = (a: Hunk, b: Hunk): boolean => (a.from < b.to && b.from < a.to) || a.from === b.from || (a.from === a.to && b.from < a.from && a.from < b.to) || (b.from === b.to && a.from < b.from && b.from < a.to)

export function mergeLines(base: string, ours: string, theirs: string): string | null {
  if (ours === theirs) return ours
  if (ours === base) return theirs
  if (theirs === base) return ours
  const lines = base.split('\n')
  const mine = hunksOf(lines, ours.split('\n'))
  const other = hunksOf(lines, theirs.split('\n'))
  const all: Hunk[] = [...mine]
  for (const h of other) {
    if (mine.some((m) => sameHunk(m, h))) continue // the same change, made on both sides
    if (mine.some((m) => clash(m, h))) return null
    all.push(h)
  }
  // Applied from the end, so earlier positions still mean what they did.
  const out = [...lines]
  for (const h of all.sort((a, b) => b.from - a.from || b.to - a.to)) out.splice(h.from, h.to - h.from, ...h.lines)
  return out.join('\n')
}
