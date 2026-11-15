import type { FileChange, Proposal } from '@shared/ai-access'
import { parseCanvas, serializeCanvas } from '@shared/canvas'
import { acceptOps, type CanvasOp } from '@shared/canvas-ops'
import { isKanban } from '@shared/kanban'
import { changedLines, diffLines } from '@shared/line-diff'
import { applyChanges, changesOf, fileStates, type ChangeState } from '@shared/text-changes'

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
/** `target`: the note or canvas to open from the title ('' when there is none to open); `name`: what the title calls it. */
export function headingOf(p: Proposal): { verb: string; icon: string; target: string; name: string } {
  if (p.canvas !== undefined) return { verb: 'Canvas', icon: 'shapes', target: p.canvas.path, name: titleOf(p.canvas.path) }
  if (p.file !== undefined) {
    const op = p.file
    // The note where it is now: at its new place once moved, nowhere to open once archived.
    const moved = p.status === 'applied' && op.undone !== true
    const target = moved ? (op.to ?? '') : op.from
    return {
      verb: op.kind === 'rename' ? 'Rename' : op.kind === 'move' ? 'Move' : 'Archive',
      icon: op.kind === 'delete' ? 'archive' : op.kind === 'move' ? 'folder' : 'pencil',
      target,
      name: titleOf(op.from),
    }
  }
  const kind = KINDS[p.tool]
  // A new card is about its board, the last file it writes; anything else about its first.
  const target = p.tool === 'propose_task' ? (p.files.at(-1)?.path ?? '') : (p.files[0]?.path ?? '')
  return { verb: kind?.verb ?? p.summary, icon: kind?.icon ?? 'sparkles', target, name: target === '' ? '' : titleOf(target) }
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
  if (p.file !== undefined) return [fileItem(p)]
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

const folderName = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : 'the top of the vault')

/** A rename, move or archive as one line: "“Basil” → “Basil (Genovese)”", "“Basil”: Garden → Kitchen", "“Basil” → the archive". */
function fileItem(p: Proposal): ChangeItem {
  const op = p.file!
  const state: ChangeState =
    p.status === 'pending' ? 'pending' : p.status === 'applied' ? 'accepted' : p.status === 'discarded' ? 'rejected' : 'stale'
  const name = `“${titleOf(op.from)}”`
  const label =
    op.to === null
      ? `${name} → the archive, where it can be restored`
      : op.kind === 'rename'
        ? `${name} → “${titleOf(op.to)}”`
        : `${name}: ${folderName(op.from)} → ${folderName(op.to)}`
  return { index: 0, state, label, icon: op.kind === 'delete' ? 'archive' : op.kind === 'move' ? 'folder' : 'pencil', rows: [] }
}

/**
 * A suggestion in one line, for a chat, where a whole card under every answer takes too much room: what a
 * rename, move or archive does; how many cards, arrows, groups and moves on a canvas; a new card's name;
 * a note's changes and how many lines they add and remove.
 */
export function briefOf(p: Proposal): string {
  if (p.file !== undefined) return fileItem(p).label!
  if (p.canvas !== undefined) {
    const count = (kind: string, one: string): string[] => {
      const n = p.canvas!.ops.filter((o) => o.op === kind).length
      return n === 0 ? [] : [plural(n, one)]
    }
    return [...count('add-node', 'card'), ...count('add-edge', 'arrow'), ...count('add-group', 'group'), ...count('move', 'move')].join(
      ', ',
    )
  }
  if (p.tool === 'propose_task') {
    const card = p.files.find((f) => f.before === null && !isKanban(f.after))
    if (card !== undefined) return `New card “${titleOf(card.path)}”`
  }
  if (p.files.length === 0) return p.summary
  const f = p.files[0]!
  if (f.before === null) return `${plural(f.after.split('\n').filter((l) => l.trim() !== '').length, 'line')}`
  // Lines with something on them: an empty line added or removed is not what anyone would count.
  const lines = diffLines(f.before.split('\n'), f.after.split('\n')).filter((l) => l.text.trim() !== '')
  const added = lines.filter((l) => l.kind === 'added').length
  const removed = lines.filter((l) => l.kind === 'removed').length
  const n = changesOf(f.before, f.after).length
  return [
    plural(n, 'change'),
    [added > 0 ? `${plural(added, 'line')} added` : '', removed > 0 ? `${plural(removed, 'line')} removed` : '']
      .filter((x) => x !== '')
      .join(', '),
  ]
    .filter((x) => x !== '')
    .join(' · ')
}

/** Once nothing waits: what became of it, in a few words. */
export function outcomeOf(
  items: readonly ChangeItem[],
  on: 'note' | 'canvas' = 'note',
  /** A rename, move or archive taken back since. */
  undone = false,
): { text: string; tone: 'applied' | 'partial' | 'rejected' | 'stale' } | null {
  if (items.some((i) => i.state === 'pending')) return null
  if (undone) return { text: 'Undone', tone: 'rejected' }
  const accepted = items.filter((i) => i.state === 'accepted').length
  const stale = items.filter((i) => i.state === 'stale').length
  if (accepted === items.length) return { text: items.length === 1 ? 'Applied' : `Applied all ${items.length}`, tone: 'applied' }
  if (accepted > 0) return { text: `Partly applied: ${accepted} of ${items.length}`, tone: 'partial' }
  if (stale > 0 && stale === items.length)
    return { text: `Out of date: the ${on} changed there since, so nothing was written`, tone: 'stale' }
  return { text: 'Rejected', tone: 'rejected' }
}

/** What a preview shows, and in which view: the canvas, the board, or the note, as it is drawn in Recto. */
export type PreviewTarget = { path: string; view: 'note' | 'canvas' | 'board'; file: FileChange | null }

/**
 * What a suggestion's preview shows: its canvas; of a card and its board, the board - the screen the
 * person would look at; otherwise its note. A rename, move or archive has none: its one line says it all.
 */
export function previewTarget(p: Proposal): PreviewTarget | null {
  if (p.file !== undefined) return null
  if (p.canvas !== undefined) return { path: p.canvas.path, view: 'canvas', file: null }
  if (p.files.length === 0) return null
  const f = p.files.find((g) => isKanban(g.after)) ?? p.files.find((g) => g.before === null) ?? p.files[0]!
  return { path: f.path, view: /\.canvas$/i.test(f.path) ? 'canvas' : isKanban(f.after) ? 'board' : 'note', file: f }
}

/**
 * `marked`: a note's lines (0-based) added or changed; `markedNodes`: what is new or moved on a canvas (node
 * ids) or a board (its new cards' titles: their notes are not there yet) - drawn outlined in the preview.
 */
export type Preview = { target: PreviewTarget; text: string; marked: number[]; markedNodes: string[]; notes: string[] }

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/**
 * The file as it would be once the suggestion's waiting changes are accepted - worked out as Accept will
 * do it, from the file as it is now (`current`, null when it is not there): its text; for a note, the
 * lines added or changed (0-based, to mark); and a few words on what changes.
 */
export function previewOf(p: Proposal, current: string | null): Preview | null {
  const target = previewTarget(p)
  if (target === null) return null
  if (target.file === null) {
    // A canvas's edits, made onto the canvas as it is now.
    const c = p.canvas!
    const pending = c.states.flatMap((s, i) => (s === 'pending' ? [i] : []))
    let doc
    try {
      doc = parseCanvas(current ?? '{}')
    } catch {
      return null
    }
    const done = acceptOps(doc, c, pending)
    const count = (kind: string): number => pending.filter((i) => c.ops[i]!.op === kind).length
    const stale = pending.filter((i) => done.states[i] === 'stale').length
    const notes = [
      ...(count('add-node') > 0 ? [`${plural(count('add-node'), 'card')} added`] : []),
      ...(count('add-edge') > 0 ? [`${plural(count('add-edge'), 'arrow')} added`] : []),
      ...(count('add-group') > 0 ? [`${plural(count('add-group'), 'group')} added`] : []),
      ...(count('move') > 0 ? [`${plural(count('move'), 'card')} moved`] : []),
      ...(stale > 0
        ? [`${plural(stale, 'edit')} no longer ${stale === 1 ? 'fits' : 'fit'} and ${stale === 1 ? 'is' : 'are'} left out`]
        : []),
    ]
    const moved = pending.flatMap((i) => {
      const op = c.ops[i]!
      return op.op === 'move' && done.states[i] === 'accepted' ? [op.id] : []
    })
    const added = pending.flatMap((i) => {
      const op = c.ops[i]!
      return op.op === 'add-node' && done.states[i] === 'accepted' ? [done.refs[op.node.ref] ?? ''] : []
    })
    return { target, text: serializeCanvas(done.doc), marked: [], markedNodes: [...added, ...moved].filter((id) => id !== ''), notes }
  }
  const f = target.file
  const states = fileStates(p.status, f)
  const pending = states.flatMap((s, i) => (s === 'pending' ? [i] : []))
  const done = applyChanges(current, changesOf(f.before, f.after), pending)
  const text = done.text ?? current ?? ''
  const before = (current ?? '').split('\n')
  const after = text.split('\n')
  // An empty line added marks nothing anyone would read.
  const marked = (current === null ? after.map((_, i) => i) : [...changedLines(before, after)]).filter((n) => after[n]!.trim() !== '')
  const removed = current === null ? 0 : diffLines(before, after).filter((l) => l.kind === 'removed').length
  const stale = [...done.states.values()].filter((s) => s === 'stale').length
  const notes =
    target.view === 'note'
      ? [`${plural(marked.length, 'line')} added or changed, marked`, ...(removed > 0 ? [`${plural(removed, 'line')} removed`] : [])]
      : target.view === 'board'
        ? [current === null ? 'A new board' : 'The board as it will be']
        : [current === null ? 'A new canvas' : 'The canvas as it will be']
  if (stale > 0)
    notes.push(`${plural(stale, 'change')} no longer ${stale === 1 ? 'fits' : 'fit'} and ${stale === 1 ? 'is' : 'are'} left out`)
  // On a board: its new cards (a card as a note the suggestion makes), by title.
  const markedNodes = target.view === 'board' ? p.files.filter((g) => g.before === null && g !== f).map((g) => titleOf(g.path)) : []
  return { target, text, marked, markedNodes, notes }
}
