/**
 * A line diff: which lines of `after` are new, and which lines of `before`
 * are gone. Used for AI proposals - the diff a person reviews, and the lines
 * formatting is allowed to touch.
 *
 * The common head and tail are matched first, so an edit in a long note costs
 * only its changed middle; the middle is an LCS, which is exact and fine for
 * the sizes notes have. A middle too large for that is treated as all changed.
 */

export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string }

/** Middles larger than this (lines before × lines after) are not aligned line by line. */
const MAX_CELLS = 4_000_000

export function diffLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail])
    tail++

  const a = before.slice(head, before.length - tail)
  const b = after.slice(head, after.length - tail)
  const middle: DiffLine[] = []
  if (a.length * b.length > MAX_CELLS) {
    for (const text of a) middle.push({ kind: 'removed', text })
    for (const text of b) middle.push({ kind: 'added', text })
  } else {
    // lcs[i][j]: the longest common run of a[i..] and b[j..].
    const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    let i = 0
    let j = 0
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        middle.push({ kind: 'same', text: a[i]! })
        i++
        j++
      } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) middle.push({ kind: 'removed', text: a[i++]! })
      else middle.push({ kind: 'added', text: b[j++]! })
    }
    while (i < a.length) middle.push({ kind: 'removed', text: a[i++]! })
    while (j < b.length) middle.push({ kind: 'added', text: b[j++]! })
  }

  return [
    ...before.slice(0, head).map((text): DiffLine => ({ kind: 'same', text })),
    ...middle,
    ...before.slice(before.length - tail).map((text): DiffLine => ({ kind: 'same', text })),
  ]
}

/** Which line numbers of `after` (0-based) are not in `before`. */
export function changedLines(before: readonly string[], after: readonly string[]): Set<number> {
  const changed = new Set<number>()
  let at = 0
  for (const line of diffLines(before, after)) {
    if (line.kind === 'removed') continue
    if (line.kind === 'added') changed.add(at)
    at++
  }
  return changed
}

/** A unified diff with three lines of context, as text a model or a person can read. */
export function unifiedDiff(before: string, after: string, context = 3): string {
  const lines = diffLines(before === '' ? [] : before.split('\n'), after.split('\n'))
  const keep = new Set<number>()
  lines.forEach((line, i) => {
    if (line.kind === 'same') return
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep.add(k)
  })
  const out: string[] = []
  let last = -1
  for (const i of [...keep].sort((x, y) => x - y)) {
    if (last !== -1 && i > last + 1) out.push('…')
    const line = lines[i]!
    out.push(`${line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '} ${line.text}`)
    last = i
  }
  return out.join('\n')
}
