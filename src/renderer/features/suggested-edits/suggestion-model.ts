import type { FileChange, Proposal } from '@shared/ai-access'
import type { CanvasOp } from '@shared/canvas-ops'
import { diffLines } from '@shared/line-diff'
import { changesOf, fileStates, type ChangeState } from '@shared/text-changes'

/**
 * What a suggestion card shows, worked out apart from how it is drawn: its
 * title, its changes - each with its lines or its words and its state - and,
 * once settled, what became of it.
 */

export type DiffRow = { kind: 'same' | 'added' | 'removed' | 'fold'; text: string }

/** One thing to accept or reject: a change to a note, a whole file of several, or an edit to a canvas. */
export type ChangeItem = {
  /** Its index for Apply and Discard (a change, or a canvas edit); null for a file of a proposal that goes whole. */
  index: number | null
  state: ChangeState
  /** A canvas edit in words: "New card “Compost”". */
  label?: string
  icon?: string
  /** A file it belongs to, when the proposal has several. */
  file?: string
  rows: DiffRow[]
}

export const titleOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.(md|canvas)$/i, '')

/** What kind of change, by the tool that made it: the card's title is "<verb> <note>". */
const KINDS: Readonly<Record<string, { verb: string; icon: string }>> = {
  propose_append: { verb: 'Add to', icon: 'pen-line' },
  propose_edit: { verb: 'Edit', icon: 'pen-line' },
  propose_new_note: { verb: 'New note', icon: 'file-plus' },
  propose_link: { verb: 'Link in', icon: 'link' },
  make_link: { verb: 'Link in', icon: 'link' },
  propose_task: { verb: 'New card on', icon: 'square-kanban' },
  propose_task_update: { verb: 'Change card on', icon: 'square-kanban' },
}

/** The card's title: what it does, and to which note or canvas. */
export function headingOf(p: Proposal): { verb: string; icon: string; target: string } {
  if (p.canvas !== undefined) return { verb: 'Canvas', icon: 'shapes', target: p.canvas.path }
  const kind = KINDS[p.tool]
  // A new card is about its board, the last file it writes; anything else about its first.
  const target = p.tool === 'propose_task' ? (p.files.at(-1)?.path ?? '') : (p.files[0]?.path ?? '')
  return { verb: kind?.verb ?? p.summary, icon: kind?.icon ?? 'sparkles', target }
}

/** The lines of a change, with one unchanged line above and below to place it. */
function changeRows(f: FileChange, at: number, removed: readonly string[], added: readonly string[]): DiffRow[] {
  const before = f.before === null ? [] : f.before.split('\n')
  const above = before[at - 1]
  const below = before[at + removed.length]
  return [
    ...(above === undefined || above.trim() === '' ? [] : [{ kind: 'same' as const, text: above }]),
    ...removed.map((text) => ({ kind: 'removed' as const, text })),
    ...added.map((text) => ({ kind: 'added' as const, text })),
    ...(below === undefined || below.trim() === '' ? [] : [{ kind: 'same' as const, text: below }]),
  ]
}

/** A whole file's diff, changed lines with two around them; longer unchanged runs fold into one line. */
export function fileRows(f: FileChange): DiffRow[] {
  const lines = diffLines(f.before === null ? [] : f.before.split('\n'), f.after.split('\n'))
  const near = new Set<number>()
  lines.forEach((l, i) => {
    if (l.kind !== 'same') for (let k = i - 2; k <= i + 2; k++) near.add(k)
  })
  const rows: DiffRow[] = []
  let folded = 0
  const fold = (): void => {
    if (folded > 0) rows.push({ kind: 'fold', text: folded === 1 ? '1 line unchanged' : `${folded} lines unchanged` })
    folded = 0
  }
  lines.forEach((l, i) => {
    if (!near.has(i)) return void folded++
    fold()
    rows.push({ kind: l.kind, text: l.text })
  })
  fold()
  return rows
}

/** A node a canvas edit names, in a few words: its text's first line, its note's name, its link's host. */
function nodeNames(p: Proposal): Map<string, string> {
  const names = new Map<string, string>()
  const short = (s: string): string => (s.length > 40 ? `${s.slice(0, 39)}…` : s)
  const name = (n: { text?: string; file?: string; url?: string; label?: string }): string =>
    short(
      n.label ??
        (n.text !== undefined
          ? (n.text.trim().split('\n')[0] ?? '')
          : n.file !== undefined
            ? titleOf(n.file)
            : n.url !== undefined
              ? n.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]!
              : 'a card'),
    )
  // The canvas with every edit made (`files`): the names of the nodes there now.
  try {
    const doc = JSON.parse(p.files[0]?.after ?? '{}') as {
      nodes?: { id: string; text?: string; file?: string; url?: string; label?: string }[]
    }
    for (const n of doc.nodes ?? []) names.set(n.id, name(n))
  } catch {
    // Not readable: the edits name their own nodes.
  }
  for (const op of p.canvas?.ops ?? []) {
    if (op.op === 'add-node') names.set(op.node.ref, name(op.node))
    if (op.op === 'add-group') names.set(op.ref, short(op.label))
  }
  return names
}

function canvasLabel(op: CanvasOp, names: ReadonlyMap<string, string>): { label: string; icon: string } {
  const named = (id: string): string => `“${names.get(id) ?? 'a card'}”`
  if (op.op === 'add-node') {
    const kind = op.node.type === 'file' ? 'Note' : op.node.type === 'link' ? 'Link' : 'Card'
    return {
      label: `${kind} ${named(op.node.ref)}`,
      icon: op.node.type === 'file' ? 'file-text' : op.node.type === 'link' ? 'link' : 'square',
    }
  }
  if (op.op === 'add-edge')
    return { label: `Arrow ${named(op.from)} → ${named(op.to)}${op.label === undefined ? '' : `, “${op.label}”`}`, icon: 'arrow-right' }
  if (op.op === 'add-group') return { label: `Group ${named(op.ref)}`, icon: 'frame' }
  return { label: `Move ${named(op.id)}`, icon: 'move' }
}

/**
 * The things to accept or reject: a canvas's edits; a note's separate changes; or, for a proposal that
 * writes several files at once (a card and its board), each file, taken or left together.
 */
export function itemsOf(p: Proposal): ChangeItem[] {
  if (p.canvas !== undefined) {
    const names = nodeNames(p)
    return p.canvas.ops.map((op, i) => ({ index: i, state: p.canvas!.states[i] ?? 'pending', ...canvasLabel(op, names), rows: [] }))
  }
  if (p.files.length > 1)
    return p.files.map((f) => {
      const states = fileStates(p.status, f)
      return { index: null, state: states[0] ?? 'pending', file: f.path, rows: fileRows(f) }
    })
  const f = p.files[0]
  if (f === undefined) return []
  const states = fileStates(p.status, f)
  return changesOf(f.before, f.after).map((c, i) => ({
    index: i,
    state: states[i] ?? 'pending',
    rows: changeRows(f, c.at, c.removed, c.added),
  }))
}

/** Once nothing waits: what became of it, in a few words. */
export function outcomeOf(
  items: readonly ChangeItem[],
  on: 'note' | 'canvas' = 'note',
): { text: string; tone: 'applied' | 'partial' | 'rejected' | 'stale' } | null {
  if (items.some((i) => i.state === 'pending')) return null
  const accepted = items.filter((i) => i.state === 'accepted').length
  const stale = items.filter((i) => i.state === 'stale').length
  if (accepted === items.length) return { text: items.length === 1 ? 'Applied' : `Applied all ${items.length}`, tone: 'applied' }
  if (accepted > 0) return { text: `Partly applied: ${accepted} of ${items.length}`, tone: 'partial' }
  if (stale > 0 && stale === items.length)
    return { text: `Out of date: the ${on} changed there since, so nothing was written`, tone: 'stale' }
  return { text: 'Rejected', tone: 'rejected' }
}
