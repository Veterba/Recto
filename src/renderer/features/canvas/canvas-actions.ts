import { createContext, useContext } from 'react'
import type { MenuItem } from '../../ui/ContextMenu'
import type { PlayerItem } from '@shared/ipc'
import type { Point, Rect } from './arrow-geometry'
import type { EndTarget } from './canvas-arrows'

/**
 * What a node can do to its canvas, handed down by the view: nodes are drawn
 * by the library, so this is how they reach the file without a prop chain.
 */
export type CanvasActions = {
  /** The canvas file: what links typed into its cards are written from. */
  canvas: string
  /** The node whose text is being edited, if any. */
  editing: string | null
  startEditing: (id: string) => void
  stopEditing: () => void
  setText: (id: string, text: string) => void
  /** A note node's body, typed into on the canvas: written to the note. */
  setNoteBody: (path: string, body: string) => void
  resize: (id: string, box: { x: number; y: number; width: number; height: number }) => void
  /** The node being typed in needs this height to show all of it: drawn so now, written when the typing ends. */
  grow: (id: string, height: number) => void
  /** The edge whose label is being typed, if any. */
  editingEdge: string | null
  startEdgeLabel: (id: string) => void
  setEdgeLabel: (id: string, label: string) => void
  /** Follow a link in a node: from the note it is in, or else from the canvas. */
  openLink: (target: string, from?: string) => void
  openFile: (path: string) => void
  /** Draw on a drawing again: the Draw tool, its strokes added to this one. */
  drawOn: (id: string) => void
  /** The drawing being edited stroke by stroke (DrawingEditor), if any: its node draws nothing meanwhile. */
  editingDrawing: string | null
  editDrawing: (id: string) => void
  /** A PDF read in the PDF panel, docked on the window's right as the AI panel is. */
  openReader: (path: string) => void
  /** A note opened in the pane beside the canvas, the canvas staying in view. */
  openBeside: (path: string) => void
  openUrl: (url: string) => void
  /** A video played in the mini-player window. */
  play: (item: PlayerItem) => void
  /** A picture or a video read at this size: its node made the same shape (once, if it is not). */
  fitMedia: (id: string, width: number, height: number) => void
  /** A picture's or a video's caption, under it ('' takes it away). */
  setCaption: (id: string, caption: string) => void
  /** Boards shown as their Markdown, and the switch between that and the board. */
  rawBoards: ReadonlySet<string>
  toggleRaw: (id: string) => void
  /** Fold a group to its label, or a note to its name; again to open it. */
  toggleFold: (id: string) => void
  /** Items a node adds to its right-click menu (a card's lanes and priority); null takes them away. */
  registerMenu: (id: string, items: MenuItem[] | null) => void
  /** Edges whose notes are linked in the notes themselves. */
  linked: ReadonlySet<string>
  /** The node under a point on the canvas, for an arrow's end; free ends and `exclude` are passed over. */
  nodeAt: (p: Point, exclude: ReadonlySet<string>) => { id: string; rect: Rect } | null
  /** An arrow's end dropped on a node or out in the open. */
  setEdgeEnd: (id: string, which: 'from' | 'to', end: EndTarget) => void
  setEdgeBend: (id: string, bend: number) => void
}

const noop = (): void => {}

export const CanvasActionsContext = createContext<CanvasActions>({
  canvas: '',
  editing: null,
  startEditing: noop,
  stopEditing: noop,
  setText: noop,
  setNoteBody: noop,
  resize: noop,
  grow: noop,
  editingEdge: null,
  startEdgeLabel: noop,
  setEdgeLabel: noop,
  openLink: noop,
  openFile: noop,
  openBeside: noop,
  openReader: noop,
  drawOn: noop,
  editingDrawing: null,
  editDrawing: noop,
  openUrl: noop,
  play: noop,
  setCaption: noop,
  fitMedia: noop,
  toggleFold: noop,
  rawBoards: new Set(),
  toggleRaw: noop,
  registerMenu: noop,
  linked: new Set(),
  nodeAt: () => null,
  setEdgeEnd: noop,
  setEdgeBend: noop,
})

export const useCanvasActions = (): CanvasActions => useContext(CanvasActionsContext)
