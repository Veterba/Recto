import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GhostLayer, useCanvasProposals, type GhostAccept } from './GhostLayer'
import { acceptOps, rejectOps } from '@shared/canvas-ops'
import type { Proposal } from '@shared/ai-access'
import { DrawingEditor } from './DrawingEditor'
import { setCanvasSelection } from '../../../app/canvas-selection'
import {
  applyEdgeChanges,
  applyNodeChanges,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  useKeyPress,
  useReactFlow,
  useStore,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import { newCanvasId, patchEdge, patchNode, serializeCanvas, type CanvasDoc, type CanvasNode } from '@shared/canvas'
import { groupFrame, placeNear } from '@shared/canvas-layout'
import { insertItem, parseKanban } from '@shared/kanban'
import { askQuickly } from '../../../app/quick-ask-request'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'
import { vaultFileUrl } from '../../../app/vault-url'
import { NavArrows } from '../../../app/components/NavArrows'
import { ContextMenu, type MenuItem } from '../../../ui/ContextMenu'
import { childrenOf, toFlowEdges, toFlowNodes, type FlowEdge, type FlowNode } from '../canvas-flow'
import { CanvasActionsContext, type CanvasActions } from '../canvas-actions'
import { copyOf, groupOf, isClip, pasteOf, withChildren } from '../canvas-edit'
import { snapToOthers, type Guide } from '../canvas-guides'
import { connect, dropLoosePoints, nodeAt, rectOf, setBend, setEnd } from '../canvas-arrows'
import { anchorAt, CENTRE, type Point } from '../arrow-geometry'
import type { EndTarget } from '../canvas-arrows'
import { edgeMenu, nodeMenu, paneMenu, type CanvasAsk, type MenuCommands } from '../canvas-menus'
import type { CanvasChange } from '../canvas-change'
import { useCanvas } from '../use-canvas'
import { useCollapsed, useRawBoards } from '../canvas-state'
import { fileNodeSize } from '../canvas-edit'
import { fileKind } from '@shared/file-kind'
import { TREE_DRAG } from '../../file-tree'
import { writeNoteBody } from '../note-body'
import { EDGE_TYPES } from './CanvasEdge'
import { NODE_TYPES } from './CanvasNodes'
import { CanvasSearch } from './CanvasSearch'
import { MakeNoteBar } from './MakeNoteBar'
import { CanvasToolbar, TOOL_KEYS, type PickItem, type Tool } from './CanvasToolbar'
import { StyleBar } from './StyleBar'
import { youTubeId } from '@shared/youtube'
import { CanvasCardPanel } from './CanvasCardPanel'
import { showPdf } from '../../pdf/PdfPanel'
import { cut, erase, HIGHLIGHT_OPACITY, strokePath, type Pt, type Stroke } from '../drawing'
import { pen, strokeStyle } from '../pen'
import { recognise, type InkShape } from '../ink-shapes'
import { drawingOf, saveDrawing, type Drawn } from '../drawing-store'
import type { Shape } from '../shapes'
import type { FileNode } from '@shared/vault'
import { CANVAS_FOLDER, noteFolderBeside } from '@shared/recto-paths'
import { noteEntries } from '../../file-tree'
import { boardOfCard, isBoardPath, useBoards } from '../../boards'
import { createBoard, createCardNote } from '../../boards/create-card'
import { openSuggestedEdits } from '../../suggested-edits'
import { noteIndexChanged, useNoteBus } from '../../../app/note-bus'

/**
 * One canvas in a tab: its nodes and edges on a plane you pan and zoom.
 *
 * What is drawn is made from the file on every change (canvas-flow.ts); a
 * drag or a resize moves what is drawn and is written when it ends, as one
 * change - and one step of undo.
 */

export type CanvasShell = {
  openFile: (path: string) => void
  /** Follow a link: its target, and the canvas or note it is in. */
  openLink: (target: string, source: string) => void
  /** The vault's folders, for where "Make it a note" puts a note (Recto's own left out). */
  folders: () => readonly string[]
  /** The vault's tree, for the toolbar's note picker. */
  roots: () => readonly FileNode[]
  /** A note opened in the pane beside this canvas's tab. */
  openBeside: (leafId: string, path: string) => void
}

/** The space left between nodes put down one under another. */
const GAP = 20
/** A new text node's size, and a new group's. */
const NEW_NODE = { width: 260, height: 120 }
const NEW_GROUP = { width: 480, height: 320 }
/** How near, in canvas units, the eraser must pass a stroke to take it away. */
const ERASER_REACH = 8
/** Draw and hold: how long the pen is kept still before the stroke snaps into a shape, and how far it may tremble meanwhile (screen pixels). */
const HOLD_MS = 500
const HOLD_SLOP = 3
/** How far from a double-clicked drawing a stroke still goes into it, in canvas units; further away it is a drawing of its own. */
const DRAW_REACH = 48
/** Plain text's first size: a line, growing as it is typed. */
const NEW_PLAIN = { width: 260, height: 44 }
/** A new shape's size: square, except the ones that are wide by nature. */
const shapeSize = (shape: Shape): { width: number; height: number } =>
  shape === 'pill' || shape === 'parallelogram' ? { width: 220, height: 100 } : { width: 160, height: 160 }
/** How close, on screen, an edge must come to another node's to snap to it. */
const SNAP_PX = 6

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.canvas$/i, '')
/** Whole numbers, as Obsidian writes them; nodes snap to each other, not to a grid. */
const snapped = (v: number): number => Math.round(v)

type Menu = { at: { x: number; y: number }; items: MenuItem[] }

/** A link card's size, and a YouTube video's (16:9). */
const LINK_CARD = { width: 320, height: 200 }
const LINK_VIDEO = { width: 480, height: 270 }
/** One web address and nothing else. */
const isWebUrl = (text: string): boolean => /^https?:\/\/\S+$/i.test(text.trim())

/** How wide a picture or a video is put down, and how tall at most. */
const MEDIA_WIDTH = 400
const MEDIA_MAX_HEIGHT = 560

/**
 * A file's node size: a picture or a video in its own proportions (read from
 * the file, a second at most), anything else as fileNodeSize says.
 */
async function naturalSize(file: string): Promise<{ width: number; height: number }> {
  const kind = fileKind(file)
  const video = /\.(mp4|mov|webm|m4v)$/i.test(file)
  if (kind !== 'image' && !video) return fileNodeSize(file)
  const read = new Promise<{ w: number; h: number } | null>((resolve) => {
    if (video) {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.onloadedmetadata = () => resolve({ w: v.videoWidth, h: v.videoHeight })
      v.onerror = () => resolve(null)
      v.src = vaultFileUrl(file)
    } else {
      const img = new Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => resolve(null)
      img.src = vaultFileUrl(file)
    }
  })
  const late = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1000))
  const found = await Promise.race([read, late])
  if (found === null || found.w === 0 || found.h === 0) return fileNodeSize(file)
  const height = Math.round((MEDIA_WIDTH * found.h) / found.w)
  return height <= MEDIA_MAX_HEIGHT
    ? { width: MEDIA_WIDTH, height }
    : { width: Math.round((MEDIA_MAX_HEIGHT * found.w) / found.h), height: MEDIA_MAX_HEIGHT }
}

export function CanvasView({ path, leafId, shell }: { path: string; leafId: string; shell: CanvasShell }): React.ReactElement {
  return (
    <ReactFlowProvider>
      <CanvasBoard path={path} leafId={leafId} shell={shell} />
    </ReactFlowProvider>
  )
}

function CanvasBoard({ path, leafId, shell }: { path: string; leafId: string; shell: CanvasShell }): React.ReactElement {
  const canvas = useCanvas(path)
  const { doc, edit } = canvas
  const { collapsed, toggle: toggleFold } = useCollapsed(path)
  const { raw: rawBoards, toggle: toggleRaw } = useRawBoards(path)
  const flow = useReactFlow()
  const zoom = useStore((s) => s.transform[2])
  /** ⌘ held while dragging: no snapping. */
  const noSnap = useKeyPress('Meta')
  const transform = useStore((s) => s.transform)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  // Said to Quick ask, whose questions here go with what is selected (nodes only, not arrows).
  useEffect(() => setCanvasSelection(path, canvas.doc === null ? [] : [...selected].filter((id) => canvas.doc!.nodes.some((n) => n.id === id))), [path, selected, canvas.doc])
  useEffect(() => () => setCanvasSelection(path, []), [path])
  const [nodes, setNodes] = useState<FlowNode[]>([])
  const [edges, setEdges] = useState<FlowEdge[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [editingEdge, setEditingEdge] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [search, setSearch] = useState<{ query: string; index: number } | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  /** What a click on the plane does: select, pan, or put something down (once). */
  const [tool, setTool] = useState<Tool>('select')
  // Leaving Draw ends drawing on a double-clicked drawing: strokes after that are drawings of their own.
  useEffect(() => {
    if (tool !== 'draw') drawTarget.current = null
  }, [tool])
  const [picking, setPicking] = useState<'note' | 'board' | null>(null)
  /** An arrow being drawn with the Arrow tool, from where the drag began to the pointer, on the canvas. */
  const [drawing, setDrawing] = useState<{ from: Point; to: Point } | null>(null)
  /** A task opened from the canvas: its card on the right, as on its board. */
  const [card, setCard] = useState<string | null>(null)
  /** A file opened from the canvas: a task opens beside it as its card; anything else as it always does. */
  const open = useCallback(
    (file: string) => {
      if (boardOfCard(file) === null) return shell.openFile(file)
      setCard(file)
    },
    [shell],
  )
  const openLink = useCallback(
    (target: string, from?: string) =>
      void api.invoke(IPC.indexResolveLink, target, from ?? path).then((resolved) => {
        if (resolved !== null) open(resolved)
      }),
    [open, path],
  )
  /** The stroke being drawn with the Draw tool (canvas units), or the eraser's path, for the live preview. */
  const [ink, setInk] = useState<{ points: Pt[]; erasing: boolean; style: ReturnType<typeof strokeStyle>; shape?: InkShape } | null>(null)
  /** The drawing strokes go into while the Draw tool is on: the one double-clicked, or the one just started. */
  const drawTarget = useRef<string | null>(null)
  /** The drawing open in the stroke editor: its node, and its strokes in canvas units when it was opened. */
  const [editingDrawing, setEditingDrawing] = useState<{ id: string; strokes: Stroke[] } | null>(null)
  /** Nodes being dragged: the style bar steps out of the way. */
  const [moving, setMoving] = useState(false)
  const boards = useBoards()
  /** Edges between two notes where the first really links to the second (a [[link]] in it): marked on the canvas. */
  const [linked, setLinked] = useState<ReadonlySet<string>>(new Set())
  const { revision } = useNoteBus()
  const [said, setSaid] = useState<string | null>(null)
  /** The text node being made a note, while its name is asked. */
  const [making, setMaking] = useState<string | null>(null)
  // The vault's folders, read once each time the bar opens.
  const makeFolders = useMemo(() => (making === null ? [] : shell.folders()), [making, shell])
  const dragging = useRef(false)
  /** The canvas as it is now, for what reads it on demand without drawing every node again when it changes. */
  const docRef = useRef(doc)
  docRef.current = doc
  /** A group's nodes, caught when its drag starts, so they move with it. */
  const carried = useRef<Map<string, { x: number; y: number }>>(new Map())
  /** Text typed into the node being edited, written when editing ends. */
  const draft = useRef<{ id: string; text: string } | null>(null)
  /** How tall the node being typed in has grown, written with its text when the typing ends. */
  const grown = useRef<{ id: string; height: number } | null>(null)
  const fitted = useRef(false)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  /** This canvas's plane: its middle is where things go that have no point of their own. */
  const plane = useRef<HTMLDivElement | null>(null)
  /** The middle of what is on screen of this canvas - not of the window: panels may stand beside it. */
  const viewCentre = useCallback((): { x: number; y: number } => {
    const box = plane.current?.getBoundingClientRect()
    return box === undefined
      ? flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      : flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
  }, [flow])
  /** What nodes add to their own menu (a card's lanes), by node id. */
  const extraMenus = useRef<Map<string, MenuItem[]>>(new Map())

  // What is drawn follows the file - except mid-drag, when it follows the pointer.
  useEffect(() => {
    if (doc === null || dragging.current) return
    setNodes(toFlowNodes(doc, selected, collapsed))
    setEdges(toFlowEdges(doc, selected, collapsed))
  }, [doc, selected, collapsed])

  // Which edges between notes are links in the notes themselves, from the index.
  useEffect(() => {
    if (doc === null) return
    const fileOf = new Map(
      doc.nodes.filter((n) => n.type === 'file' && typeof n.file === 'string' && n.file.endsWith('.md')).map((n) => [n.id, n.file!]),
    )
    const pairs = doc.edges
      .filter((e) => fileOf.has(e.fromNode) && fileOf.has(e.toNode))
      .map((e) => ({ id: e.id, from: fileOf.get(e.fromNode)!, to: fileOf.get(e.toNode)! }))
    let live = true
    const timer = window.setTimeout(() => {
      const targets = [...new Set(pairs.map((p) => p.to))]
      void Promise.all(targets.map((t) => api.invoke(IPC.indexBacklinks, t).then((b) => [t, new Set(b.map((x) => x.path))] as const))).then(
        (found) => {
          if (!live) return
          const from = new Map(found)
          setLinked(new Set(pairs.filter((p) => from.get(p.to)?.has(p.from) === true).map((p) => p.id)))
        },
      )
    }, 300)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [doc, revision])

  // The whole canvas in view the first time it is shown.
  useEffect(() => {
    if (doc === null || fitted.current) return
    fitted.current = true
    requestAnimationFrame(() => void flow.fitView({ padding: 0.15, maxZoom: 1 }))
  }, [doc, flow])

  const run = useCallback((change: CanvasChange) => void edit(change), [edit])

  // An AI's suggested changes to this canvas, as ghosts until accepted.
  const proposals = useCanvasProposals(path)
  const acceptGhosts = useCallback(
    (accepted: readonly GhostAccept[]) => {
      const shown = docRef.current
      if (shown === null) return
      const plan = accepted.flatMap(({ proposal, indexes }) => {
        const c = proposal.canvas
        if (c === undefined) return []
        return [{ id: proposal.id, c, which: indexes ?? c.states.flatMap((s, i) => (s === 'pending' ? [i] : [])) }]
      })
      // Every proposal one after the other in ONE edit. An edit each, in the
      // same moment, built each from the same canvas: Accept all kept only the last.
      const acceptAll = (d: CanvasDoc): { doc: CanvasDoc; done: ReturnType<typeof acceptOps>[] } => {
        const done: ReturnType<typeof acceptOps>[] = []
        let doc = d
        for (const { c, which } of plan) {
          const one = acceptOps(doc, c, which)
          done.push(one)
          doc = one.doc
        }
        return { doc, done }
      }
      const result = acceptAll(shown)
      // Undone with ⌘Z like any other edit; applied to the canvas as it is when it is written.
      void edit((d) => (d === shown ? result.doc : acceptAll(d).doc))
      plan.forEach(({ id }, k) => void api.invoke(IPC.aiProposalCanvas, id, result.done[k]!.states, result.done[k]!.refs))
    },
    [edit],
  )
  const rejectGhosts = useCallback((p: Proposal, indexes: number[] | null) => {
    const c = p.canvas
    if (c === undefined) return
    const which = indexes ?? c.states.flatMap((s, i) => (s === 'pending' ? [i] : []))
    void api.invoke(IPC.aiProposalCanvas, p.id, rejectOps(c, which), c.refs)
  }, [])

  const stopEditing = useCallback(() => {
    const typed = draft.current
    const tall = grown.current
    draft.current = null
    grown.current = null
    setEditing(null)
    // A text card keeps the height it grew to - its text lives in it. A note or a board shown on the canvas
    // goes back to the size it had: it only grew to be edited.
    const grewCard = tall !== null && docRef.current?.nodes.find((n) => n.id === tall.id)?.type === 'text'
    if (tall !== null && !grewCard) {
      const was = docRef.current?.nodes.find((n) => n.id === tall.id)?.height
      if (was !== undefined) setNodes((prev) => prev.map((n) => (n.id === tall.id ? { ...n, height: was } : n)))
    }
    if (typed === null && !grewCard) return
    // The text and the height it grew to: one change, one step of undo.
    run((d) => ({
      ...d,
      nodes: d.nodes.map((n) => {
        let next = n
        if (grewCard && tall !== null && n.id === tall.id && tall.height > n.height) next = patchNode(next, { height: tall.height })
        if (typed === null || n.id !== typed.id) return next
        if (n.type === 'group') return n.label === typed.text ? next : patchNode(next, { label: typed.text === '' ? undefined : typed.text })
        return n.text === typed.text ? next : patchNode(next, { text: typed.text })
      }),
    }))
  }, [run])

  // Leaving with a card still being typed in - another tab, ⌘W, a note opened in this one - keeps the text:
  // it lived only in `draft` until Esc or a click, and went with the view.
  const stopOnLeave = useRef(stopEditing)
  stopOnLeave.current = stopEditing
  useEffect(() => () => stopOnLeave.current(), [])

  /** A new node at a point on the canvas, its corner on the grid; selected, and its text being typed. */
  const addNode = useCallback(
    (at: { x: number; y: number }, kind: 'text' | 'plain' | 'group' | Shape, link?: { from: string }): void => {
      let id = ''
      const size = kind === 'group' ? NEW_GROUP : kind === 'text' ? NEW_NODE : kind === 'plain' ? NEW_PLAIN : shapeSize(kind)
      void edit((d) => {
        id = id === '' ? newCanvasId(d) : id
        const node: CanvasNode =
          kind === 'group'
            ? {
                id,
                type: 'group',
                x: snapped(at.x - size.width / 2),
                y: snapped(at.y - size.height / 2),
                width: size.width,
                height: size.height,
                label: 'Group',
              }
            : {
                id,
                type: 'text',
                text: '',
                x: snapped(at.x - size.width / 2),
                y: snapped(at.y - size.height / 2),
                width: size.width,
                height: size.height,
                // Plain text: a text node with no card round it - no border, no fill - as Advanced Canvas keeps those.
                ...(kind === 'text' ? {} : kind === 'plain' ? { styleAttributes: { border: 'invisible', fill: 'none' } } : { styleAttributes: { shape: kind } }),
              }
        const withNode = kind === 'group' ? [node, ...d.nodes] : [...d.nodes, node]
        const next = { ...d, nodes: withNode }
        return link === undefined ? next : connect(next, { node: link.from, anchor: CENTRE }, { node: id, anchor: CENTRE }).doc
      })
      setSelected(new Set([id]))
      setEditing(id)
    },
    [edit],
  )

  const select = useCallback((ids: Iterable<string>) => setSelected(new Set(ids)), [])

  const copy = useCallback(() => {
    if (doc === null) return
    const clip = copyOf(doc, selected)
    if (clip !== null) void navigator.clipboard.writeText(JSON.stringify(clip))
  }, [doc, selected])

  /** A link card at a point: the page's preview is fetched by the node; a YouTube video gets a video's shape. */
  const addLink = useCallback(
    async (url: string, at: { x: number; y: number }) => {
      const size = youTubeId(url) !== null ? LINK_VIDEO : LINK_CARD
      let id = ''
      await edit((d) => {
        id = id === '' ? newCanvasId(d) : id
        return {
          ...d,
          nodes: [
            ...d.nodes,
            { id, type: 'link', url, x: snapped(at.x - size.width / 2), y: snapped(at.y - size.height / 2), width: size.width, height: size.height },
          ],
        }
      })
      select([id])
    },
    [edit, select],
  )

  /** Clipboard in: canvas nodes put down at the pointer (or a step off where they were); plain text as a new text node. */
  const paste = useCallback(
    async (at?: { x: number; y: number }) => {
      const text = await navigator.clipboard.readText().catch(() => '')
      if (text.trim() === '') return
      let clip: unknown = null
      try {
        clip = JSON.parse(text)
      } catch {
        clip = null
      }
      const where = at ?? (pointer.current === null ? undefined : flow.screenToFlowPosition(pointer.current))
      if (isClip(clip)) {
        const put = pasteOf(clip, where === undefined ? undefined : { x: snapped(where.x), y: snapped(where.y) })
        await edit(put.change)
        select(put.ids())
        return
      }
      const centre = where ?? viewCentre()
      // A web address on its own: a link card (a YouTube one a video preview), not text.
      if (isWebUrl(text)) return addLink(text.trim(), centre)
      let id = ''
      await edit((d) => {
        id = id === '' ? newCanvasId(d) : id
        return {
          ...d,
          nodes: [
            ...d.nodes,
            { id, type: 'text', text, x: snapped(centre.x), y: snapped(centre.y), width: NEW_NODE.width, height: NEW_NODE.height },
          ],
        }
      })
      select([id])
    },
    [edit, flow, select, addLink, viewCentre],
  )

  const duplicate = useCallback(() => {
    if (doc === null) return
    const clip = copyOf(doc, selected)
    if (clip === null) return
    const put = pasteOf(clip)
    void edit(put.change).then(() => select(put.ids()))
  }, [doc, selected, edit, select])

  /** Files put on the canvas from a point down and to the right, one under another: notes, images, anything. */
  const addFiles = useCallback(
    async (files: readonly string[], at: { x: number; y: number }) => {
      if (files.length === 0) return
      const ids: string[] = []
      const sizes = await Promise.all(files.map(naturalSize))
      await edit((d) => {
        let next = d
        let y = snapped(at.y)
        ids.length = 0
        for (const [i, file] of files.entries()) {
          const id = newCanvasId(next)
          ids.push(id)
          const size = sizes[i] ?? fileNodeSize(file)
          next = {
            ...next,
            nodes: [...next.nodes, { id, type: 'file', file, x: snapped(at.x), y, width: size.width, height: size.height }],
          }
          y += size.height + GAP
        }
        return next
      })
      select(ids)
    },
    [edit, select],
  )

  /** Files from Finder or the clipboard: copied into the attachments folder, then put on the canvas. */
  const importFiles = useCallback(
    async (files: readonly File[], at: { x: number; y: number }) => {
      const paths: string[] = []
      for (const file of files) {
        const name =
          file.name !== '' && file.name !== 'image.png'
            ? file.name
            : `pasted-${Date.now().toString(36)}.${file.type.split('/')[1] ?? 'png'}`
        const made = await api.invoke(IPC.fsImportData, name, new Uint8Array(await file.arrayBuffer()))
        if (made.ok) paths.push(made.path)
      }
      await addFiles(paths, at)
    },
    [addFiles],
  )


  /** The toolbar's note picker: notes and cards, not boards (they have their own) or Recto's own files. */
  const pickNotes = useCallback(
    (): PickItem[] =>
      noteEntries(shell.roots()).filter((n) => !isBoardPath(n.path) && (!n.path.startsWith('Recto/') || boardOfCard(n.path) !== null)),
    [shell],
  )
  const pickBoards = useMemo(
    () => boards.map((b) => ({ path: b.path, name: b.name, folder: b.path.slice(0, Math.max(0, b.path.lastIndexOf('/'))) })),
    [boards],
  )

  /**
   * A note named in the toolbar's "Create", put down in the middle of the view: made where notes from this
   * canvas go, even when another folder has a note of that name (as in Obsidian). One of that name already
   * in that folder is the one put down.
   */
  const createNote = useCallback(
    async (name: string) => {
      const folder = noteFolderBeside(path)
      const [existing] = await api.invoke(IPC.fsExisting, [`${folder === '' ? '' : `${folder}/`}${name}.md`])
      if (existing !== undefined) return void addFiles([existing], viewCentre())
      const made = await createCardNote(name, folder)
      if (made.ok) await addFiles([made.path], viewCentre())
      else setSaid(made.error)
    },
    [addFiles, viewCentre, path],
  )

  const addMedia = useCallback(async () => {
    const at = viewCentre()
    const picked = await api.invoke(IPC.fsImportFiles).catch((err: unknown) => ({ ok: false as const, error: String(err) }))
    if (picked.ok) await addFiles(picked.paths, at)
    else setSaid(picked.error)
  }, [addFiles, viewCentre])

  /** Where an arrow's end goes when let go at `p`: pinned to the node there, or free. */
  const endAt = useCallback(
    (p: Point, exclude: ReadonlySet<string> = new Set()): EndTarget => {
      const hit = doc === null ? null : nodeAt(doc, p, exclude)
      return hit === null ? { point: p } : { node: hit.id, anchor: anchorAt(rectOf(hit), p) }
    },
    [doc],
  )

  /** A drawing's strokes in canvas units: its file's, scaled to the node's size and moved to its place. */
  const strokesOn = (drawn: Drawn, n: CanvasNode): Stroke[] => {
    const sx = n.width / (drawn.width || 1)
    const sy = n.height / (drawn.height || 1)
    return drawn.strokes.map((s) => ({ ...s, points: s.points.map(([x, y, p]) => [n.x + x * sx, n.y + y * sy, p] as Pt) }))
  }

  /** The drawings on this canvas whose box, a little widened, meets a box. */
  const drawingsNear = useCallback(
    (box: { x: number; y: number; width: number; height: number }, reach: number): CanvasNode[] =>
      (docRef.current?.nodes ?? []).filter(
        (n) =>
          n.type === 'file' &&
          typeof n.file === 'string' &&
          n.file.toLowerCase().endsWith('.svg') &&
          n.x - reach < box.x + box.width &&
          n.x + n.width + reach > box.x &&
          n.y - reach < box.y + box.height &&
          n.y + n.height + reach > box.y,
      ),
    [],
  )

  /**
   * A stroke drawn: a drawing of its own - as in tldraw and Excalidraw, each
   * stroke is one - unless a drawing was double-clicked to draw on, and the
   * stroke is near it. Never into a drawing it merely happens to be drawn
   * over, however soon after the last stroke.
   */
  const keepStroke = useCallback(
    async (points: Pt[], shape?: InkShape) => {
      // As drawn, in the pen's kind, colour and size - never tidied behind the hand; a shape only when held into one.
      const stroke: Stroke = { points, ...strokeStyle(pen()), ...(shape === undefined ? {} : { shape }) }
      const xs = stroke.points.map((p) => p[0])
      const ys = stroke.points.map((p) => p[1])
      const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
      const nodes = docRef.current?.nodes ?? []
      const chosen = nodes.find((n) => n.id === drawTarget.current)
      const near =
        chosen !== undefined &&
        chosen.x - DRAW_REACH < box.x + box.width &&
        chosen.x + chosen.width + DRAW_REACH > box.x &&
        chosen.y - DRAW_REACH < box.y + box.height &&
        chosen.y + chosen.height + DRAW_REACH > box.y
      const target: CanvasNode | undefined = near ? chosen : undefined
      const drawn: Drawn | null = target?.file === undefined ? null : await drawingOf(target.file)
      if (target !== undefined && drawn !== null) {
        const id = target.id
        const saved = await saveDrawing(target.file!, [...strokesOn(drawn, target), stroke])
        if (!saved.ok) return setSaid(saved.error)
        run((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? patchNode(n, saved.box) : n)) }))
        return
      }
      // A new drawing: an SVG beside the canvas, in "<canvas> drawings".
      const folder = `${path.includes('/') ? `${path.slice(0, path.lastIndexOf('/'))}/` : ''}${nameOf(path)} drawings`
      const made = await api.invoke(IPC.fsCreate, folder, 'Drawing.svg', 'file', 'number')
      if (!made.ok) return setSaid(made.error)
      const saved = await saveDrawing(made.path, [stroke])
      if (!saved.ok) return setSaid(saved.error)
      let id = ''
      await edit((d) => {
        id = id === '' ? newCanvasId(d) : id
        const b = saved.box
        const node = { id, type: 'file', file: made.path, x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
        // A highlighter goes under what it marks: just below the first node it overlaps (groups are drawn
        // under everything anyway); a pen stroke on top.
        const under =
          stroke.kind === 'highlighter'
            ? d.nodes.findIndex((n) => n.type !== 'group' && n.x < b.x + b.width && n.x + n.width > b.x && n.y < b.y + b.height && n.y + n.height > b.y)
            : -1
        return { ...d, nodes: under === -1 ? [...d.nodes, node] : [...d.nodes.slice(0, under), node, ...d.nodes.slice(under)] }
      })
    },
    [edit, path, run],
  )

  /** The eraser let go: every stroke it passed over, gone from the drawings it passed over. */
  /** Double-click on a drawing: its strokes, in canvas units, into the stroke editor. */
  const openDrawingEditor = useCallback(async (id: string) => {
    const n = docRef.current?.nodes.find((x) => x.id === id)
    if (n?.file === undefined) return
    const drawn = await drawingOf(n.file)
    if (drawn === null) return
    setTool('select')
    // The strokes are what is selected now, in the editor - not the drawing as a node (its style bar would sit over the editor's).
    setSelected(new Set())
    setEditingDrawing({ id, strokes: strokesOn(drawn, n) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `strokesOn` reads only its arguments
  }, [])

  /** A change in the stroke editor: written to the drawing's SVG, the node fitted to it - or gone, with no strokes left. */
  const saveEditedDrawing = useCallback(
    async (strokes: Stroke[]) => {
      const id = editingDrawing?.id
      const n = docRef.current?.nodes.find((x) => x.id === id)
      if (id === undefined || n?.file === undefined) return
      if (strokes.length === 0) {
        run((d) => ({ ...d, nodes: d.nodes.filter((x) => x.id !== id), edges: d.edges.filter((e) => e.fromNode !== id && e.toNode !== id) }))
        return
      }
      const saved = await saveDrawing(n.file, strokes)
      if (!saved.ok) return setSaid(saved.error)
      run((d) => ({ ...d, nodes: d.nodes.map((x) => (x.id === id ? patchNode(x, saved.box) : x)) }))
    },
    [editingDrawing, run],
  )

  const keepErasing = useCallback(
    async (trail: Pt[]) => {
      const xs = trail.map((p) => p[0])
      const ys = trail.map((p) => p[1])
      const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
      // Its reach is on the screen, so it is the same size however far the canvas is zoomed.
      const reach = ERASER_REACH / zoom
      for (const n of drawingsNear(box, reach)) {
        const drawn = await drawingOf(n.file!)
        if (drawn === null) continue
        const before = strokesOn(drawn, n)
        // Cutting, it takes out only what it passed over; else every stroke it touched, whole.
        const after = pen().eraser === 'cut' ? cut(before, trail, reach) : erase(before, trail, reach)
        if (after.length === before.length && after.every((s, i) => s === before[i])) continue
        // Every stroke gone: the drawing goes from the canvas (its file stays, as a note's does).
        if (after.length === 0) {
          run((d) => ({ ...d, nodes: d.nodes.filter((x) => x.id !== n.id), edges: d.edges.filter((e) => e.fromNode !== n.id && e.toNode !== n.id) }))
          continue
        }
        const saved = await saveDrawing(n.file!, after)
        if (saved.ok) run((d) => ({ ...d, nodes: d.nodes.map((x) => (x.id === n.id ? patchNode(x, saved.box) : x)) }))
      }
    },
    [drawingsNear, run, zoom],
  )

  /** The Draw tool and the eraser: a press on the canvas, dragged, let go. */
  const drawInk = useCallback(
    (ev: React.PointerEvent) => {
      if (ev.button !== 0) return
      const target = ev.target as HTMLElement
      if (target.closest('.react-flow') === null || target.closest('.canvas-tools, .canvas-bar, .canvas-search, .canvas-style') !== null) return
      ev.preventDefault()
      ev.stopPropagation()
      const erasing = tool === 'eraser'
      const at = (e: PointerEvent | React.PointerEvent): Pt => {
        const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
        // A pen's pressure when there is one; a mouse or a trackpad draws at an even weight.
        return [p.x, p.y, e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5]
      }
      const points: Pt[] = [at(ev)]
      const style = strokeStyle(pen())
      setInk({ points, erasing, style })
      // Draw and hold: the pen kept still a moment at the end of a stroke snaps it into the shape it was drawn as.
      let snapped: { shape: InkShape; points: Pt[] } | null = null
      let held: ReturnType<typeof setTimeout> | undefined
      let still = { x: ev.clientX, y: ev.clientY }
      const hold = (): void => {
        clearTimeout(held)
        if (erasing) return
        held = setTimeout(() => {
          snapped = recognise(points)
          if (snapped !== null) setInk({ points: snapped.points, erasing, style: { ...style }, shape: snapped.shape })
        }, HOLD_MS)
      }
      hold()
      const move = (e: PointerEvent): void => {
        // A small tremble is still holding; a real move goes on drawing, and lets go of a snapped shape.
        if (Math.hypot(e.clientX - still.x, e.clientY - still.y) < HOLD_SLOP) return
        still = { x: e.clientX, y: e.clientY }
        snapped = null
        // Every point the system saw since the last event, not only the last: a fast stroke keeps its shape.
        for (const sample of e.getCoalescedEvents?.() ?? [e]) points.push(at(sample))
        setInk({ points: [...points], erasing, style })
        hold()
      }
      const up = (): void => {
        clearTimeout(held)
        window.removeEventListener('pointermove', move, true)
        window.removeEventListener('pointerup', up, true)
        window.removeEventListener('pointercancel', up, true)
        setInk(null)
        if (erasing) void keepErasing(points)
        else if (snapped !== null) void keepStroke(snapped.points, snapped.shape)
        else if (points.length > 1) void keepStroke(points)
      }
      window.addEventListener('pointermove', move, true)
      window.addEventListener('pointerup', up, true)
      // A pen lifted out of range, or the system taking the pointer: the stroke ends where it got to.
      window.addEventListener('pointercancel', up, true)
    },
    [tool, flow, keepStroke, keepErasing],
  )

  /** The Arrow tool: press on a node or in the open, drag, let go on another (or in the open). */
  const drawArrow = useCallback(
    (ev: React.PointerEvent) => {
      if (tool !== 'arrow' || ev.button !== 0) return
      const target = ev.target as HTMLElement
      if (target.closest('.react-flow') === null || target.closest('.canvas-tools, .canvas-bar, .canvas-search') !== null) return
      ev.preventDefault()
      ev.stopPropagation()
      const from = flow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
      setDrawing({ from, to: from })
      const move = (e: PointerEvent): void => setDrawing({ from, to: flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }) })
      const up = (e: PointerEvent): void => {
        window.removeEventListener('pointermove', move, true)
        window.removeEventListener('pointerup', up, true)
        setDrawing(null)
        setTool('select')
        const to = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
        // A click, not a drag: no arrow.
        if (Math.hypot(e.clientX - ev.clientX, e.clientY - ev.clientY) < 6) return
        const start = endAt(from)
        const end = endAt(to, 'node' in start ? new Set([start.node]) : new Set())
        let id = ''
        void edit((d) => {
          const made = connect(d, start, end)
          id = made.id
          return made.doc
        }).then(() => setSelected(new Set([id])))
      }
      window.addEventListener('pointermove', move, true)
      window.addEventListener('pointerup', up, true)
    },
    [tool, flow, endAt, edit],
  )

  const remove = useCallback(() => {
    if (selected.size === 0) return
    const ids = selected
    // A note node goes; the note itself never does. Edges to what goes, go with it.
    run((d) =>
      // An arrow's free end goes with its arrow.
      dropLoosePoints({
        ...d,
        nodes: d.nodes.filter((n) => !ids.has(n.id)),
        edges: d.edges.filter((e) => !ids.has(e.id) && !ids.has(e.fromNode) && !ids.has(e.toNode)),
      }),
    )
    setSelected(new Set())
  }, [selected, run])

  /** The nodes in view, a group with what is in it; never closer than a little past life size. */
  const zoomTo = useCallback(
    (ids: ReadonlySet<string>) => {
      if (doc === null || ids.size === 0) return
      const all = [...withChildren(doc, ids)].map((id) => ({ id }))
      void flow.fitView({ nodes: all, padding: 0.25, maxZoom: 1.2 })
    },
    [doc, flow],
  )

  const group = useCallback(() => {
    if (selected.size === 0) return
    const made = groupOf(selected, 'Group')
    void edit(made.change).then(() => {
      select([made.made()])
      setEditing(made.made())
    })
  }, [selected, edit, select])

  /** An AI command on what is selected: a question for Quick ask, naming the nodes as the canvas tools do. */
  const ask = useCallback(
    (command: CanvasAsk) => {
      if (doc === null) return
      const idOf = (id: string): string => `n${doc.nodes.findIndex((n) => n.id === id) + 1}`
      const picked = doc.nodes.filter((n) => selected.has(n.id) && n.type !== 'group').map((n) => n.id)
      const list = picked.map(idOf).join(', ')
      const first = picked[0] === undefined ? '' : idOf(picked[0])
      const questions: Record<CanvasAsk, string> = {
        group: `Group the selected nodes (${list}) by what they are about: propose labelled groups with canvas_propose_group, each selected node in one group.`,
        brainstorm: `Brainstorm around ${first}: propose 3 to 7 short new cards near it with canvas_propose_nodes, each with an arrow from ${first} to it.`,
        map: `Map the note ${first}: put the notes it links to and the notes that link to it on this canvas near it (canvas_propose_nodes, as notes, with arrows from ${first}); get_note_context finds them. Then group them by topic with canvas_propose_group.`,
        moodboard: `Arrange the selected files (${list}) as a moodboard: group them by theme with canvas_propose_group, going by their names, captions and what read_file says about them.`,
      }
      askQuickly(questions[command]!)
    },
    [doc, selected],
  )

  /** A group made a board: its cards and notes, top to bottom, as the first lane's cards; the board put beside the group. */
  const toBoard = useCallback(
    async (groupId: string) => {
      const g = doc?.nodes.find((n) => n.id === groupId)
      if (doc === null || g === undefined) return
      const made = await createBoard(typeof g.label === 'string' && g.label.trim() !== '' ? g.label.trim() : 'Board')
      if (!made.ok) return setSaid('exists' in made ? `There is a board of that name already: ${made.exists}.` : made.error)
      const read = await api.invoke(IPC.fsRead, made.path)
      if (!read.ok) return setSaid(read.error)
      let text = read.content
      const held = childrenOf(doc, g)
        .filter((n) => n.type !== 'group')
        .sort((a, b) => a.y - b.y || a.x - b.x)
      for (const [i, n] of held.entries()) {
        const card =
          n.type === 'file' && typeof n.file === 'string'
            ? await api.invoke(IPC.linksFormat, n.file, made.path, { markdown: false })
            : n.type === 'link'
              ? String(n.url ?? '')
              : (n.text ?? '').trim()
        if (card !== '') text = insertItem(text, 0, i, card)
      }
      await api.invoke(IPC.fsWrite, made.path, text)
      noteIndexChanged()
      const spot = placeNear(g, { width: 520, height: 420 }, doc.nodes.filter((n) => n.type !== 'group'))
      void edit((d) => ({ ...d, nodes: [...d.nodes, { id: newCanvasId(d), type: 'file', file: made.path, ...spot }] }))
    },
    [doc, edit],
  )

  /** A board laid out as a new canvas: a group per lane, its cards inside - notes as notes, the rest as cards. */
  const boardToCanvas = useCallback(
    async (boardPath: string) => {
      const read = await api.invoke(IPC.fsRead, boardPath)
      if (!read.ok) return setSaid(read.error)
      const lanes = parseKanban(read.content).lanes
      const links = lanes.flatMap((l) => l.items.flatMap((item) => (item.link === null ? [] : [item.link])))
      const found = links.length === 0 ? {} : await api.invoke(IPC.indexResolveLinks, links, boardPath)
      let next: CanvasDoc = { nodes: [], edges: [], rest: {}, order: ['nodes', 'edges'] }
      const W = 300
      lanes.forEach((lane, li) => {
        const x = li * (W + 80)
        let y = 0
        const cards: CanvasNode[] = []
        for (const item of lane.items) {
          const file = item.link === null ? null : (found[item.link] ?? null)
          const node: CanvasNode =
            file !== null
              ? { id: newCanvasId(next), type: 'file', file, x, y, width: W, height: 160 }
              : { id: newCanvasId(next), type: 'text', text: item.text, x, y, width: W, height: 90 }
          cards.push(node)
          next = { ...next, nodes: [...next.nodes, node] }
          y += node.height + 30
        }
        const frame = groupFrame(cards.length > 0 ? cards : [{ x, y: 0, width: W, height: 90 }])!
        next = { ...next, nodes: [{ id: newCanvasId(next), type: 'group', label: lane.title, ...frame }, ...next.nodes] }
      })
      const name = `${boardPath.slice(boardPath.lastIndexOf('/') + 1).replace(/\.md$/i, '')} board`
      const made = await api.invoke(IPC.fsCreate, CANVAS_FOLDER, `${name}.canvas`, 'file', 'number')
      if (!made.ok) return setSaid(made.error)
      await api.invoke(IPC.fsWrite, made.path, serializeCanvas(next))
      open(made.path)
    },
    [open],
  )

  const commands: MenuCommands = useMemo(
    () => ({
      ask,
      toBoard: (id) => void toBoard(id),
      boardToCanvas: (p) => void boardToCanvas(p),
      isBoard: isBoardPath,
      edit: run,
      copy,
      paste: (at) => void paste(at),
      duplicate,
      remove,
      group,
      zoomToSelection: () => zoomTo(selected),
      zoomToFit: () => void flow.fitView({ padding: 0.15 }),
      startEditing: (id) => setEditing(id),
      startEdgeLabel: (id) => setEditingEdge(id),
      newText: (at) => addNode(at, 'text'),
      newGroup: (at) => addNode(at, 'group'),
      openFile: open,
      makeNote: (id) => setMaking(id),
      toggleFold,
      folded: collapsed,
      makeLink: (id) => {
        const edge = doc?.edges.find((e) => e.id === id)
        const from = doc?.nodes.find((n) => n.id === edge?.fromNode)?.file
        const to = doc?.nodes.find((n) => n.id === edge?.toNode)?.file
        if (from === undefined || to === undefined) return
        void api.invoke(IPC.canvasProposeLink, from, to).then((made) => {
          if (!made.ok) setSaid(made.error)
          else if (made.proposal === null) setSaid('That note links there already.')
          else openSuggestedEdits()
        })
      },
    }),
    [run, copy, paste, duplicate, remove, group, zoomTo, selected, flow, addNode, shell, doc, toggleFold, collapsed, open, ask, toBoard, boardToCanvas],
  )

  const actions: CanvasActions = useMemo(
    () => ({
      editing,
      startEditing: (id) => {
        if (draft.current !== null && draft.current.id !== id) stopEditing()
        setEditing(id)
      },
      stopEditing,
      setText: (id, text) => {
        draft.current = { id, text }
      },
      setNoteBody: (note, body) => writeNoteBody(note, body),
      grow: (id, height) => {
        if ((grown.current?.height ?? 0) >= height && grown.current?.id === id) return
        grown.current = { id, height }
        setNodes((prev) => prev.map((n) => (n.id === id && (n.height ?? 0) < height ? { ...n, height } : n)))
      },
      resize: (id, box) => run((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? patchNode(n, box) : n)) })),
      editingEdge,
      setEdgeLabel: (id, label) => {
        setEditingEdge(null)
        run((d) => ({
          ...d,
          edges: d.edges.map((e) =>
            e.id !== id || (e.label ?? '') === label ? e : patchEdge(e, { label: label === '' ? undefined : label }),
          ),
        }))
      },
      startEdgeLabel: (id) => setEditingEdge(id),
      canvas: path,
      openLink,
      openFile: open,
      openBeside: (file) => shell.openBeside(leafId, file),
      openReader: (file) => showPdf(file),
      drawOn: (id) => {
        drawTarget.current = id
        setTool('draw')
      },
      editingDrawing: editingDrawing?.id ?? null,
      editDrawing: (id) => void openDrawingEditor(id),
      openUrl: (url) => void api.invoke(IPC.shellOpenExternal, url),
      play: (item) =>
        void api
          .invoke(IPC.playerOpen, item)
          .then((done) => {
            if (!done.ok) setSaid(done.error)
          })
          // Never a ▶ that silently does nothing.
          .catch((err: unknown) => setSaid(`The player could not open: ${err instanceof Error ? err.message : String(err)}`)),
      fitMedia: (id, width, height) => {
        const node = docRef.current?.nodes.find((n) => n.id === id)
        if (node === undefined || width === 0 || height === 0) return
        const fitted = Math.round((node.width * height) / width)
        // Off by more than a pixel or two: the box takes the picture's shape, its width kept.
        if (Math.abs(fitted - node.height) > 2) run((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? patchNode(n, { height: fitted }) : n)) }))
      },
      setCaption: (id, caption) =>
        run((d) => ({
          ...d,
          nodes: d.nodes.map((n) => (n.id === id && (n['caption'] ?? '') !== caption ? patchNode(n, { caption: caption === '' ? undefined : caption }) : n)),
        })),
      toggleFold,
      rawBoards,
      toggleRaw,
      registerMenu: (id, items) => {
        if (items === null) extraMenus.current.delete(id)
        else extraMenus.current.set(id, items)
      },
      linked,
      nodeAt: (p, exclude) => {
        const hit = docRef.current === null ? null : nodeAt(docRef.current, p, exclude)
        return hit === null ? null : { id: hit.id, rect: rectOf(hit) }
      },
      setEdgeEnd: (id, which, end) => run((d) => setEnd(d, id, which, end)),
      setEdgeBend: (id, bend) => run((d) => setBend(d, id, bend)),
    }),
    [editing, editingEdge, stopEditing, run, shell, path, editingDrawing, openDrawingEditor, linked, toggleFold, leafId, open, openLink, rawBoards, toggleRaw],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      // One node dragged on its own lines up with the others it comes near, unless ⌘ is held.
      const moving = changes.filter((c) => c.type === 'position' && c.dragging === true && c.position !== undefined)
      if (moving.length === 1 && doc !== null && carried.current.size === 0 && !noSnap) {
        const change = moving[0]!
        if (change.type === 'position' && change.position !== undefined) {
          const me = doc.nodes.find((n) => n.id === change.id)
          if (me !== undefined) {
            const others = doc.nodes.filter((n) => n.id !== me.id && n.type !== 'group')
            const snap = snapToOthers(
              { x: change.position.x, y: change.position.y, width: me.width, height: me.height },
              others,
              SNAP_PX / zoom,
            )
            change.position = { x: snap.x, y: snap.y }
            setGuides(snap.guides)
          }
        }
      }
      setNodes((prev) => {
        let next = applyNodeChanges(changes, prev)
        // A group being dragged carries the nodes inside it by the same amount.
        for (const change of changes) {
          if (change.type !== 'position' || change.position === undefined || carried.current.size === 0) continue
          const g = doc?.nodes.find((n) => n.id === change.id)
          if (g === undefined || g.type !== 'group') continue
          const dx = change.position.x - g.x
          const dy = change.position.y - g.y
          next = next.map((n) => {
            const start = carried.current.get(n.id)
            return start === undefined ? n : { ...n, position: { x: start.x + dx, y: start.y + dy } }
          })
        }
        return next
      })
      const picked = changes.filter((c) => c.type === 'select')
      if (picked.length > 0)
        setSelected((prev) => {
          const next = new Set(prev)
          for (const c of picked)
            if (c.type === 'select') {
              if (c.selected) next.add(c.id)
              else next.delete(c.id)
            }
          return next
        })
    },
    [doc, zoom, noSnap],
  )

  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    setEdges((prev) => applyEdgeChanges(changes, prev))
    const picked = changes.filter((c) => c.type === 'select')
    if (picked.length > 0)
      setSelected((prev) => {
        const next = new Set(prev)
        for (const c of picked)
          if (c.type === 'select') {
            if (c.selected) next.add(c.id)
            else next.delete(c.id)
          }
        return next
      })
  }, [])

  const onNodeDragStart = useCallback(
    (_: MouseEvent | React.MouseEvent | TouchEvent, _node: FlowNode, dragged: FlowNode[]) => {
      dragging.current = true
      setMoving(true)
      carried.current = new Map()
      if (doc === null) return
      const moving = new Set(dragged.map((n) => n.id))
      for (const n of dragged) {
        const g = doc.nodes.find((c) => c.id === n.id)
        if (g?.type !== 'group') continue
        for (const child of childrenOf(doc, g)) if (!moving.has(child.id)) carried.current.set(child.id, { x: child.x, y: child.y })
      }
    },
    [doc],
  )

  const onNodeDragStop = useCallback(
    (_: MouseEvent | React.MouseEvent | TouchEvent, __: FlowNode, dragged: FlowNode[]) => {
      dragging.current = false
      setMoving(false)
      setGuides([])
      const moved = new Map<string, { x: number; y: number }>(dragged.map((n) => [n.id, n.position]))
      for (const id of carried.current.keys()) {
        const shown = nodes.find((n) => n.id === id)
        if (shown !== undefined) moved.set(id, shown.position)
      }
      carried.current = new Map()
      run((d) => ({ ...d, nodes: d.nodes.map((n) => (moved.has(n.id) ? patchNode(n, moved.get(n.id)!) : n)) }))
    },
    [run, nodes],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source === c.target) return
      // Pinned at both centres, as an arrow drawn with the tool is.
      run((d) => connect(d, { node: c.source, anchor: CENTRE }, { node: c.target, anchor: CENTRE }).doc)
    },
    [run],
  )

  // Dragged from a side out into nothing: a new text node there, joined to where it came from.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid === true || state.fromNode === null) return
      const point =
        'clientX' in event
          ? { x: event.clientX, y: event.clientY }
          : { x: event.changedTouches[0]!.clientX, y: event.changedTouches[0]!.clientY }
      addNode(flow.screenToFlowPosition(point), 'text', { from: state.fromNode.id })
    },
    [flow, addNode],
  )

  const onKeyDown = useCallback(
    (ev: React.KeyboardEvent) => {
      const target = ev.target as HTMLElement
      // Typing in a node or a label: its own keys, except Escape, which ends the editing.
      if (target.closest('.cm-editor, input, textarea') !== null) {
        if (ev.key === 'Escape' && target.closest('.cm-editor') !== null) {
          ev.preventDefault()
          stopEditing()
        }
        return
      }
      const key = ev.key.toLowerCase()
      if (ev.metaKey && key === 'z') {
        ev.preventDefault()
        if (ev.shiftKey) canvas.redo()
        else canvas.undo()
      } else if (ev.metaKey && key === 'c') {
        ev.preventDefault()
        copy()
      } else if (ev.metaKey && key === 'x') {
        ev.preventDefault()
        copy()
        remove()
      } else if (ev.metaKey && key === 'd') {
        ev.preventDefault()
        duplicate()
      } else if (ev.metaKey && key === 'a') {
        ev.preventDefault()
        if (doc !== null) select(doc.nodes.map((n) => n.id))
      } else if (ev.metaKey && key === 'g') {
        ev.preventDefault()
        group()
      } else if (ev.metaKey && key === 'f') {
        ev.preventDefault()
        ev.stopPropagation()
        setSearch((s) => s ?? { query: '', index: 0 })
      } else if (ev.key === 'Enter' && selected.size === 1) {
        ev.preventDefault()
        setEditing([...selected][0]!)
      } else if (ev.key === 'Escape') {
        if (tool !== 'select') {
          setTool('select')
          drawTarget.current = null
        }
        else select([])
      } else if (!ev.metaKey && !ev.ctrlKey && !ev.altKey && TOOL_KEYS[key] !== undefined) {
        ev.preventDefault()
        setTool(TOOL_KEYS[key]!)
      } else if (!ev.metaKey && !ev.ctrlKey && !ev.altKey && (key === 'n' || key === 'b')) {
        ev.preventDefault()
        setPicking(key === 'n' ? 'note' : 'board')
      }
    },
    [canvas, stopEditing, copy, remove, paste, duplicate, doc, select, group, selected, tool],
  )

  const openMenu = useCallback((ev: React.MouseEvent | MouseEvent, items: MenuItem[]) => {
    ev.preventDefault()
    setMenu({ at: { x: ev.clientX, y: ev.clientY }, items })
  }, [])

  const showMatch = useCallback((id: string) => zoomTo(new Set([id])), [zoomTo])

  if (canvas.error !== null && doc === null)
    return (
      <div className="canvas-view">
        <div className="md__bar">
          <NavArrows leafId={leafId} />
        </div>
        <p className="canvas-view__error">This canvas could not be opened: {canvas.error}</p>
      </div>
    )

  return (
    <div
      className="canvas-view"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPaste={(ev) => {
        if ((ev.target as HTMLElement).closest('.cm-editor, input, textarea') !== null) return
        ev.preventDefault()
        const files = [...ev.clipboardData.files]
        const at =
          pointer.current === null
            ? viewCentre()
            : flow.screenToFlowPosition(pointer.current)
        if (files.length > 0) void importFiles(files, at)
        else void paste()
      }}
      onPointerMove={(ev) => {
        pointer.current = { x: ev.clientX, y: ev.clientY }
      }}
    >
      <div className="md__bar canvas-view__bar">
        <NavArrows leafId={leafId} />
        <span className="canvas-view__name">{nameOf(path)}</span>
        <span className="canvas-view__gap" />
        <button className="board__tool" onClick={() => void flow.fitView({ padding: 0.15 })}>
          Zoom to fit
        </button>
      </div>
      {said !== null && (
        <p className="canvas-view__notice" role="status">
          {said}
          <button className="composer__link" onClick={() => setSaid(null)}>
            OK
          </button>
        </p>
      )}
      {canvas.notice !== null && (
        <p className="canvas-view__notice" role="status">
          {canvas.notice}
          <button className="composer__link" onClick={canvas.clearNotice}>
            OK
          </button>
        </p>
      )}
      <div
        ref={plane}
        className={`canvas-view__plane is-${tool === 'select' || tool === 'hand' ? tool : 'placing'}`}
        onPointerDownCapture={(ev) => (tool === 'draw' || tool === 'eraser' ? drawInk(ev) : drawArrow(ev))}
        data-accepts-drop=""
        onDragOver={(ev) => {
          const types = ev.dataTransfer.types
          if (types.includes(TREE_DRAG) || types.includes('Files') || types.includes('text/uri-list')) {
            ev.preventDefault()
            ev.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={(ev) => {
          const at = flow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
          const fromTree = ev.dataTransfer.getData(TREE_DRAG)
          if (fromTree !== '') {
            ev.preventDefault()
            // A folder dropped is nothing to draw; a canvas on a canvas neither.
            if (fileKind(fromTree) !== 'canvas' && /\.[^/]+$/.test(fromTree)) void addFiles([fromTree], at)
            return
          }
          const files = [...ev.dataTransfer.files]
          if (files.length > 0) {
            ev.preventDefault()
            void importFiles(files, at)
            return
          }
          // A link dragged from the browser.
          const url = ev.dataTransfer.getData('text/uri-list').split('\n').find((l) => isWebUrl(l)) ?? ev.dataTransfer.getData('text/plain')
          if (isWebUrl(url)) {
            ev.preventDefault()
            void addLink(url.trim(), at)
          }
        }}
        onDoubleClick={(ev) => {
          if (!(ev.target as HTMLElement).classList.contains('react-flow__pane')) return
          addNode(flow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }), 'text')
        }}
      >
        {making !== null && doc !== null && (
          <MakeNoteBar
            text={doc.nodes.find((n) => n.id === making)?.text ?? ''}
            // Beside the canvas, to start with.
            folder={noteFolderBeside(path)}
            folders={makeFolders}
            sameNamed={(name) => noteEntries(shell.roots()).filter((n) => n.name.toLowerCase() === name.toLowerCase()).map((n) => n.path)}
            onCancel={() => setMaking(null)}
            onMade={(note) => {
              const id = making
              setMaking(null)
              // The node becomes the note in place: where it was, its size and colour kept.
              run((d) => ({
                ...d,
                nodes: d.nodes.map((n) => (n.id === id ? patchNode(n, { type: 'file', file: note, text: undefined }) : n)),
              }))
            }}
          />
        )}
        {search !== null && doc !== null && (
          <CanvasSearch
            doc={doc}
            query={search.query}
            setQuery={(query) => setSearch((s) => ({ index: s?.index ?? 0, query }))}
            index={search.index}
            setIndex={(index) => setSearch((s) => ({ query: s?.query ?? '', index }))}
            onShow={showMatch}
            onClose={() => setSearch(null)}
          />
        )}
        <CanvasActionsContext.Provider value={actions}>
          <ReactFlow<FlowNode, FlowEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onDelete={({ nodes: gone, edges: cut }) => {
              const ids = new Set([...gone.map((n) => n.id), ...cut.map((e) => e.id)])
              if (ids.size === 0) return
              run((d) =>
                dropLoosePoints({
                  ...d,
                  nodes: d.nodes.filter((n) => !ids.has(n.id)),
                  edges: d.edges.filter((e) => !ids.has(e.id) && !ids.has(e.fromNode) && !ids.has(e.toNode)),
                }),
              )
            }}
            // Picking something else ends the typing, as a click on the plane does.
            onNodeClick={(_, node) => editing !== null && editing !== node.id && stopEditing()}
            onEdgeClick={() => editing !== null && stopEditing()}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onPaneClick={(ev) => {
              if (editing !== null) stopEditing()
              if (tool === 'select' || tool === 'hand') return
              // A tool that puts something down does it once, then it is Select again.
              const at = flow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
              if (tool === 'draw' || tool === 'eraser' || tool === 'arrow') return
              addNode(at, tool === 'card' ? 'text' : tool === 'text' ? 'plain' : tool === 'frame' ? 'group' : (tool.slice(6) as Shape))
              setTool('select')
            }}
            onNodeContextMenu={(ev, node) => {
              if (doc === null) return
              const ids = selected.has(node.id) ? selected : new Set([node.id])
              if (!selected.has(node.id)) select([node.id])
              const extra = ids.size === 1 ? (extraMenus.current.get(node.id) ?? []) : []
              openMenu(ev, [...extra, ...nodeMenu(doc, ids, commands)])
            }}
            onSelectionContextMenu={(ev) => doc !== null && openMenu(ev, nodeMenu(doc, selected, commands))}
            onEdgeContextMenu={(ev, edge) => {
              if (doc === null || edge.data === undefined) return
              select([edge.id])
              openMenu(
                ev,
                edgeMenu(doc, edge.data.edge, {
                  ...commands,
                  remove: () => run((d) => dropLoosePoints({ ...d, edges: d.edges.filter((e) => e.id !== edge.id) })),
                }),
              )
            }}
            onEdgeDoubleClick={(_, edge) => setEditingEdge(edge.id)}
            onPaneContextMenu={(ev) => openMenu(ev, paneMenu(flow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }), commands))}
            connectionMode={ConnectionMode.Loose}
            onlyRenderVisibleElements
            // A trackpad scrolls the plane and pinches to zoom; ⌘-scroll zooms too; space or the middle button drags it.
            panOnScroll
            panOnScrollSpeed={1}
            zoomOnScroll={false}
            zoomOnPinch
            zoomActivationKeyCode="Meta"
            panOnDrag={tool === 'hand' ? true : [1]}
            panActivationKeyCode="Space"
            nodesDraggable={tool === 'select' || tool.startsWith('shape:') || tool === 'text' || tool === 'card' || tool === 'frame'}
            elementsSelectable={tool !== 'hand' && tool !== 'arrow' && tool !== 'draw' && tool !== 'eraser'}
            selectionOnDrag={tool === 'select'}
            multiSelectionKeyCode="Shift"
            zoomOnDoubleClick={false}
            deleteKeyCode={['Backspace', 'Delete']}
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          />
        </CanvasActionsContext.Provider>
        {doc !== null && !moving && drawing === null && editing === null && editingEdge === null && (
          <StyleBar doc={doc} selected={selected} transform={transform} run={run} />
        )}
        {card !== null && (
          <CanvasCardPanel path={card} onChoose={setCard} onOpenNote={shell.openFile} onClose={() => setCard(null)} />
        )}
        <CanvasToolbar
          tool={tool}
          setTool={setTool}
          notes={pickNotes}
          boards={pickBoards}
          onPick={(picked) => void addFiles([picked], viewCentre())}
          onCreateNote={(name) => void createNote(name)}
          onMedia={() => void addMedia()}
          opening={picking}
          setOpening={setPicking}
        />
        {doc !== null && <GhostLayer proposals={proposals} doc={doc} transform={transform} onAccept={acceptGhosts} onReject={rejectGhosts} />}
        {editingDrawing !== null && (
          <DrawingEditor
            key={editingDrawing.id}
            strokes={editingDrawing.strokes}
            transform={transform}
            toFlow={(x, y) => flow.screenToFlowPosition({ x, y })}
            onChange={(strokes) => void saveEditedDrawing(strokes)}
            onDrawHere={() => {
              const id = editingDrawing.id
              setEditingDrawing(null)
              drawTarget.current = id
              setTool('draw')
            }}
            onClose={() => setEditingDrawing(null)}
          />
        )}
        {ink !== null && (
          <svg className="canvas-ink" aria-hidden="true">
            <g transform={`translate(${transform[0]} ${transform[1]}) scale(${transform[2]})`}>
              {ink.erasing ? (
                <polyline className="canvas-ink__eraser" points={ink.points.map((p) => `${p[0]},${p[1]}`).join(' ')} strokeWidth={(ERASER_REACH * 2) / transform[2]} />
              ) : (
                <path
                  d={strokePath({ points: ink.points, ...ink.style, ...(ink.shape === undefined ? {} : { shape: ink.shape }) }, ink.shape !== undefined)}
                  fill={ink.style.color ?? 'currentColor'}
                  fillOpacity={ink.style.kind === 'highlighter' ? HIGHLIGHT_OPACITY : 1}
                />
              )}
            </g>
          </svg>
        )}
        {drawing !== null && (
          <svg className="canvas-guides canvas-drawing" aria-hidden="true">
            <line
              x1={drawing.from.x * transform[2] + transform[0]}
              y1={drawing.from.y * transform[2] + transform[1]}
              x2={drawing.to.x * transform[2] + transform[0]}
              y2={drawing.to.y * transform[2] + transform[1]}
            />
          </svg>
        )}
        {guides.length > 0 && (
          <svg className="canvas-guides" aria-hidden="true">
            {guides.map((g) =>
              g.axis === 'x' ? (
                <line key={`x${g.at}`} x1={g.at * transform[2] + transform[0]} x2={g.at * transform[2] + transform[0]} y1={0} y2="100%" />
              ) : (
                <line key={`y${g.at}`} y1={g.at * transform[2] + transform[1]} y2={g.at * transform[2] + transform[1]} x1={0} x2="100%" />
              ),
            )}
          </svg>
        )}
      </div>
      {menu !== null && <ContextMenu items={menu.items} at={menu.at} onClose={() => setMenu(null)} />}
    </div>
  )
}
