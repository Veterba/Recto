import type { CanvasDoc, CanvasEdge } from '@shared/canvas'
import { edgeEnds, patchEdge } from '@shared/canvas'
import type { MenuItem } from '../../ui/ContextMenu'
import { align, distribute, recolor, reorder, type Align } from './canvas-edit'
import type { CanvasChange } from './canvas-change'

/**
 * The right-click menus on a canvas: on nodes (one or a selection), on an
 * edge, on a group, and on empty space. Each item is a change or a command
 * the view runs; nothing here touches the file itself.
 */

export const SWATCHES = [
  { value: null, css: 'transparent', name: 'No colour' },
  { value: '1', css: 'var(--canvas-1)', name: 'Red' },
  { value: '2', css: 'var(--canvas-2)', name: 'Orange' },
  { value: '3', css: 'var(--canvas-3)', name: 'Yellow' },
  { value: '4', css: 'var(--canvas-4)', name: 'Green' },
  { value: '5', css: 'var(--canvas-5)', name: 'Cyan' },
  { value: '6', css: 'var(--canvas-6)', name: 'Purple' },
]

export type MenuCommands = {
  edit: (change: CanvasChange) => void
  copy: () => void
  paste: (at?: { x: number; y: number }) => void
  duplicate: () => void
  remove: () => void
  group: () => void
  zoomToSelection: () => void
  zoomToFit: () => void
  startEditing: (id: string) => void
  startEdgeLabel: (id: string) => void
  newText: (at: { x: number; y: number }) => void
  newGroup: (at: { x: number; y: number }) => void
  openFile: (path: string) => void
  /** "Make it a note" on a text node. */
  makeNote?: (id: string) => void
  toggleFold?: (id: string) => void
  /** The folded groups and notes. */
  folded?: ReadonlySet<string>
  /** "Make it a link" on an edge between two notes. */
  makeLink?: (id: string) => void
  /** An AI command on what is selected: asked through Quick ask, its changes shown as ghosts. */
  ask?: (command: CanvasAsk) => void
  /** A group made a board, its cards and notes as the board's cards. */
  toBoard?: (groupId: string) => void
  /** A board laid out as a canvas: its lanes as groups. */
  boardToCanvas?: (path: string) => void
  /** Whether a file is a board. */
  isBoard?: (path: string) => boolean
}

export type CanvasAsk = 'group' | 'brainstorm' | 'map' | 'moodboard'

const ALIGN: [Align, string, string][] = [
  ['left', 'Align left', 'text-align-start'],
  ['center', 'Align centres', 'text-align-center'],
  ['right', 'Align right', 'text-align-end'],
  ['top', 'Align tops', 'between-horizontal-start'],
  ['middle', 'Align middles', 'between-horizontal-end'],
  ['bottom', 'Align bottoms', 'between-vertical-end'],
]

export function nodeMenu(doc: CanvasDoc, ids: ReadonlySet<string>, run: MenuCommands): MenuItem[] {
  const picked = doc.nodes.filter((n) => ids.has(n.id))
  const one = picked.length === 1 ? picked[0]! : null
  const current = one?.color ?? null
  const items: MenuItem[] = []
  if (one?.type === 'text') items.push({ kind: 'item', label: 'Edit text', icon: 'pencil', run: () => run.startEditing(one.id) })
  if (one?.type === 'group') items.push({ kind: 'item', label: 'Rename group', icon: 'pencil', run: () => run.startEditing(one.id) })
  if (one?.type === 'file' && typeof one.file === 'string')
    items.push({ kind: 'item', label: 'Open', icon: 'external-link', run: () => run.openFile(one.file!) })
  if (one?.type === 'text' && run.makeNote !== undefined)
    items.push({ kind: 'item', label: 'Make it a note', icon: 'file-plus', run: () => run.makeNote!(one.id) })
  const foldable =
    one !== null &&
    (one.type === 'group' || (one.type === 'file' && typeof one.file === 'string' && one.file.toLowerCase().endsWith('.md')))
  if (foldable && run.toggleFold !== undefined) {
    const shut = run.folded?.has(one.id) === true
    items.push({
      kind: 'item',
      label: shut ? 'Unfold' : one.type === 'group' ? 'Fold the group' : 'Fold to its name',
      icon: shut ? 'chevrons-up-down' : 'chevrons-down-up',
      run: () => run.toggleFold!(one.id),
    })
  }
  // AI on the canvas: what it suggests comes back as ghosts to accept or reject.
  const ai: MenuItem[] = []
  if (run.ask !== undefined) {
    const ask = run.ask
    const content = picked.filter((n) => n.type !== 'group')
    const isNote = one?.type === 'file' && typeof one.file === 'string' && one.file.toLowerCase().endsWith('.md')
    if (content.length > 1) ai.push({ kind: 'item', label: 'Group these', icon: 'sparkles', run: () => ask('group') })
    if (one !== null && one.type !== 'group') ai.push({ kind: 'item', label: 'Brainstorm around this', icon: 'sparkles', run: () => ask('brainstorm') })
    if (isNote) ai.push({ kind: 'item', label: 'Map this note', icon: 'sparkles', run: () => ask('map') })
    if (content.length > 1 && content.some((n) => n.type === 'file')) ai.push({ kind: 'item', label: 'Arrange as moodboard', icon: 'sparkles', run: () => ask('moodboard') })
  }
  if (one?.type === 'group' && run.toBoard !== undefined) ai.push({ kind: 'item', label: 'Turn into a board', icon: 'square-kanban', run: () => run.toBoard!(one.id) })
  if (one?.type === 'file' && typeof one.file === 'string' && run.isBoard?.(one.file) === true && run.boardToCanvas !== undefined)
    ai.push({ kind: 'item', label: 'Show board as canvas', icon: 'scan', run: () => run.boardToCanvas!(one.file!) })
  if (ai.length > 0) {
    if (items.length > 0) items.push({ kind: 'separator' })
    items.push(...ai)
  }
  if (items.length > 0) items.push({ kind: 'separator' })
  items.push({ kind: 'swatches', colors: SWATCHES, current, pick: (color) => run.edit(recolor(ids, color)) })
  items.push({ kind: 'separator' })
  items.push(
    { kind: 'item', label: 'Copy', icon: 'copy', shortcut: '⌘C', run: run.copy },
    { kind: 'item', label: 'Duplicate', icon: 'copy', shortcut: '⌘D', run: run.duplicate },
  )
  if (picked.length > 1) items.push({ kind: 'item', label: 'Group', icon: 'scan', shortcut: '⌘G', run: run.group })
  items.push(
    { kind: 'item', label: 'Bring to front', icon: 'arrow-up', run: () => run.edit(reorder(ids, 'front')) },
    { kind: 'item', label: 'Send to back', icon: 'arrow-down', run: () => run.edit(reorder(ids, 'back')) },
    { kind: 'item', label: 'Zoom to selection', icon: 'focus', run: run.zoomToSelection },
  )
  if (picked.length > 1) {
    items.push({ kind: 'separator' })
    for (const [how, label, icon] of ALIGN) items.push({ kind: 'item', label, icon, run: () => run.edit(align(ids, how)) })
    if (picked.length > 2)
      items.push(
        { kind: 'item', label: 'Distribute across', icon: 'columns-3', run: () => run.edit(distribute(ids, 'x')) },
        { kind: 'item', label: 'Distribute down', icon: 'rows-3', run: () => run.edit(distribute(ids, 'y')) },
      )
  }
  items.push({ kind: 'separator' })
  // A note node goes from the canvas; the note itself stays where it is.
  items.push({
    kind: 'item',
    label: one?.type === 'file' ? 'Remove from canvas' : 'Delete',
    icon: 'trash',
    danger: true,
    shortcut: '⌫',
    run: run.remove,
  })
  return items
}

const setEnds =
  (id: string, from: 'none' | 'arrow', to: 'none' | 'arrow'): CanvasChange =>
  (doc) => ({
    ...doc,
    edges: doc.edges.map((e) =>
      // The spec's defaults are left out of the file, the way Obsidian writes them.
      e.id === id ? patchEdge(e, { fromEnd: from === 'none' ? undefined : from, toEnd: to === 'arrow' ? undefined : to }) : e,
    ),
  })

export function edgeMenu(doc: CanvasDoc, edge: CanvasEdge, run: MenuCommands): MenuItem[] {
  const ends = edgeEnds(edge)
  const between = doc.nodes.filter((n) => n.id === edge.fromNode || n.id === edge.toNode)
  const notes =
    between.length === 2 && between.every((n) => n.type === 'file' && typeof n.file === 'string' && n.file.toLowerCase().endsWith('.md'))
  const items: MenuItem[] = [
    {
      kind: 'item',
      label: edge.label === undefined || edge.label === '' ? 'Add a label' : 'Edit label',
      icon: 'type',
      run: () => run.startEdgeLabel(edge.id),
    },
    { kind: 'swatches', colors: SWATCHES, current: edge.color ?? null, pick: (color) => run.edit(recolor(new Set([edge.id]), color)) },
    { kind: 'separator' },
    { kind: 'heading', label: 'Arrows' },
    {
      kind: 'item',
      label: 'No arrow',
      icon: ends.from === 'none' && ends.to === 'none' ? 'check' : 'minus',
      run: () => run.edit(setEnds(edge.id, 'none', 'none')),
    },
    {
      kind: 'item',
      label: 'Arrow at the end',
      icon: ends.from === 'none' && ends.to === 'arrow' ? 'check' : 'arrow-right',
      run: () => run.edit(setEnds(edge.id, 'none', 'arrow')),
    },
    {
      kind: 'item',
      label: 'Arrows at both ends',
      icon: ends.from === 'arrow' && ends.to === 'arrow' ? 'check' : 'arrow-left-right',
      run: () => run.edit(setEnds(edge.id, 'arrow', 'arrow')),
    },
  ]
  if (notes && run.makeLink !== undefined)
    items.push({ kind: 'separator' }, { kind: 'item', label: 'Make it a link', icon: 'link', run: () => run.makeLink!(edge.id) })
  items.push({ kind: 'separator' }, { kind: 'item', label: 'Delete', icon: 'trash', danger: true, run: run.remove })
  return items
}

export function paneMenu(at: { x: number; y: number }, run: MenuCommands): MenuItem[] {
  return [
    { kind: 'item', label: 'New text', icon: 'type', run: () => run.newText(at) },
    { kind: 'item', label: 'New group', icon: 'scan', run: () => run.newGroup(at) },
    { kind: 'item', label: 'Paste', icon: 'clipboard-copy', shortcut: '⌘V', run: () => run.paste(at) },
    { kind: 'separator' },
    { kind: 'item', label: 'Zoom to fit', icon: 'maximize', run: run.zoomToFit },
  ]
}
