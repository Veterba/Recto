import { diffLines } from './line-diff'

/**
 * A suggested edit to a note, as the separate changes a person accepts or
 * rejects one by one - and applied to the note as it is now, not as it was
 * when the edit was suggested.
 *
 * A change is a run of removed and added lines with a little unchanged
 * context around it. Applying it looks for its old lines (with that context)
 * in the current text, nearest where they were: an unrelated edit elsewhere
 * in the note - another suggestion applied, a line typed, a sync's trailing
 * newline - leaves it applicable. Only a change whose own lines are gone
 * goes out of date.
 */

export type TextChange = {
  /** Where its old lines start in the text it was made from (0-based line). */
  at: number
  removed: string[]
  added: string[]
  /** Up to CONTEXT unchanged lines just above and just below it, to find it again. */
  above: string[]
  below: string[]
}

export type ChangeState = 'pending' | 'accepted' | 'rejected' | 'stale'

/** Unchanged lines kept around a change to find it again. */
const CONTEXT = 2

const linesOf = (text: string): string[] => text.split('\n')

/** The changes from `before` to `after`, top to bottom. A new note (`before` null) is one change: all of it. */
export function changesOf(before: string | null, after: string): TextChange[] {
  if (before === null) return [{ at: 0, removed: [], added: linesOf(after), above: [], below: [] }]
  const old = linesOf(before)
  const diff = diffLines(old, linesOf(after))
  const changes: TextChange[] = []
  let line = 0
  let i = 0
  while (i < diff.length) {
    if (diff[i]!.kind === 'same') {
      line++
      i++
      continue
    }
    const at = line
    const removed: string[] = []
    const added: string[] = []
    while (i < diff.length && diff[i]!.kind !== 'same') {
      const d = diff[i]!
      if (d.kind === 'removed') {
        removed.push(d.text)
        line++
      } else added.push(d.text)
      i++
    }
    changes.push({ at, removed, added, above: old.slice(Math.max(0, at - CONTEXT), at), below: old.slice(line, line + CONTEXT) })
  }
  return changes
}

const matches = (lines: readonly string[], from: number, want: readonly string[]): boolean =>
  from >= 0 && from + want.length <= lines.length && want.every((w, k) => lines[from + k] === w)

/**
 * Where a change's old lines are in `lines` now, nearest `near`; null when they are not there. Its context
 * must match too when the change has no old lines of its own (an insertion), or when its old lines are found
 * more than once - the context tells those apart.
 */
function locate(lines: readonly string[], change: TextChange, near: number): number | null {
  const fits = (p: number, strict: boolean): boolean =>
    matches(lines, p, change.removed) &&
    (!strict || (matches(lines, p - change.above.length, change.above) && matches(lines, p + change.removed.length, change.below)))
  const strict = change.removed.length === 0
  let found: number[] = []
  for (let p = 0; p <= lines.length - change.removed.length; p++) if (fits(p, strict)) found.push(p)
  if (!strict && found.length > 1) {
    const exact = found.filter((p) => fits(p, true))
    if (exact.length > 0) found = exact
  }
  if (found.length === 0) return null
  return found.reduce((best, p) => (Math.abs(p - near) < Math.abs(best - near) ? p : best))
}

/**
 * `picks` of `changes` applied to `current`, top to bottom: the text after, and what became of each pick -
 * accepted, or stale when its old lines are no longer there. A new note (one change from nothing) is its
 * whole text, and stale once a note is there.
 */
export function applyChanges(
  current: string | null,
  changes: readonly TextChange[],
  picks: readonly number[],
): { text: string | null; states: Map<number, 'accepted' | 'stale'> } {
  const states = new Map<number, 'accepted' | 'stale'>()
  const order = [...new Set(picks)].filter((i) => changes[i] !== undefined).sort((a, b) => changes[a]!.at - changes[b]!.at)
  if (
    changes.length === 1 &&
    changes[0]!.removed.length === 0 &&
    changes[0]!.above.length === 0 &&
    changes[0]!.below.length === 0 &&
    order.length === 1
  ) {
    // All of a note from nothing: a new note, or one that was empty.
    if (current === null || current === '') {
      states.set(order[0]!, 'accepted')
      return { text: changes[0]!.added.join('\n'), states }
    }
    states.set(order[0]!, 'stale')
    return { text: current, states }
  }
  if (current === null) {
    for (const i of order) states.set(i, 'stale')
    return { text: null, states }
  }
  const lines = linesOf(current)
  // How far the lines below have moved, from the changes already made here.
  let shift = 0
  for (const i of order) {
    const change = changes[i]!
    const at = locate(lines, change, change.at + shift)
    if (at === null) {
      states.set(i, 'stale')
      continue
    }
    lines.splice(at, change.removed.length, ...change.added)
    shift += change.added.length - change.removed.length
    states.set(i, 'accepted')
  }
  return { text: lines.join('\n'), states }
}

/**
 * What became of a suggestion from its changes' states: pending while any is; then applied when any went in
 * (all or some), discarded when the person rejected them, out of date when none could go in.
 */
export function statusOf(states: readonly ChangeState[]): 'pending' | 'applied' | 'discarded' | 'stale' {
  if (states.includes('pending')) return 'pending'
  if (states.includes('accepted')) return 'applied'
  return states.includes('rejected') ? 'discarded' : 'stale'
}

/**
 * A file's change states, in order: as kept, or - a proposal from before they were kept - each as the
 * proposal's status says. Main applies by these and the card shows them, so the two never disagree.
 */
export function fileStates(
  status: 'pending' | 'applied' | 'discarded' | 'stale',
  file: { before: string | null; after: string; states?: readonly ChangeState[] },
): ChangeState[] {
  const n = changesOf(file.before, file.after).length
  if (file.states !== undefined && file.states.length === n) return [...file.states]
  const all: ChangeState =
    status === 'pending' ? 'pending' : status === 'applied' ? 'accepted' : status === 'discarded' ? 'rejected' : 'stale'
  return Array.from({ length: n }, () => all)
}

/** `line` added at the end of `text`, on a line of its own, in the text's own line ends (a note from Windows keeps \r\n). */
export function appendLine(text: string, line: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  return `${text}${text === '' || text.endsWith('\n') ? '' : eol}${line}${eol}`
}
