import { newCanvasId, patchNode, type CanvasDoc, type CanvasEdge, type CanvasNode } from '@shared/canvas'
import { fileKind } from '@shared/file-kind'
import { childrenOf } from './canvas-flow'
import type { CanvasChange } from './canvas-change'

/**
 * What can be done to a selection on a canvas, each as a change (made again
 * to the file as it is on disk when it is written).
 */

/** What the clipboard carries: the nodes, and the edges between them. */
export type CanvasClip = { recto: 'canvas'; nodes: CanvasNode[]; edges: CanvasEdge[] }

export function copyOf(doc: CanvasDoc, ids: ReadonlySet<string>): CanvasClip | null {
  // A group copied brings what is in it.
  const picked = new Set(ids)
  for (const n of doc.nodes) if (picked.has(n.id) && n.type === 'group') for (const c of childrenOf(doc, n)) picked.add(c.id)
  const nodes = doc.nodes.filter((n) => picked.has(n.id))
  if (nodes.length === 0) return null
  const edges = doc.edges.filter((e) => picked.has(e.fromNode) && picked.has(e.toNode))
  return { recto: 'canvas', nodes, edges }
}

export const isClip = (value: unknown): value is CanvasClip =>
  typeof value === 'object' && value !== null && (value as CanvasClip).recto === 'canvas' && Array.isArray((value as CanvasClip).nodes)

/**
 * A copy put down: new ids, its edges joined up to them, moved so its top-left
 * is at `at` (or a step down and right from where it was). Returns the change
 * and the new nodes' ids, to select them.
 */
export function pasteOf(clip: CanvasClip, at?: { x: number; y: number }): { change: CanvasChange; ids: () => string[] } {
  const made: string[] = []
  const change: CanvasChange = (doc) => {
    made.length = 0
    const left = Math.min(...clip.nodes.map((n) => n.x))
    const top = Math.min(...clip.nodes.map((n) => n.y))
    const dx = at === undefined ? 40 : at.x - left
    const dy = at === undefined ? 40 : at.y - top
    let next: CanvasDoc = doc
    const ids = new Map<string, string>()
    const nodes: CanvasNode[] = []
    for (const n of clip.nodes) {
      const id = newCanvasId({ ...next, nodes: [...next.nodes, ...nodes] })
      ids.set(n.id, id)
      made.push(id)
      nodes.push(patchNode({ ...n, id }, { x: n.x + dx, y: n.y + dy }))
    }
    next = { ...next, nodes: [...next.nodes, ...nodes] }
    const edges: CanvasEdge[] = []
    for (const e of clip.edges) {
      const id = newCanvasId({ ...next, edges: [...next.edges, ...edges] })
      edges.push({ ...e, id, fromNode: ids.get(e.fromNode)!, toNode: ids.get(e.toNode)! })
    }
    return { ...next, edges: [...next.edges, ...edges] }
  }
  return { change, ids: () => [...made] }
}

/** To the top of the pile (the end of the file's list) or the bottom, keeping their order among themselves. */
export const reorder =
  (ids: ReadonlySet<string>, to: 'front' | 'back'): CanvasChange =>
  (doc) => {
    const moving = doc.nodes.filter((n) => ids.has(n.id))
    const rest = doc.nodes.filter((n) => !ids.has(n.id))
    return { ...doc, nodes: to === 'front' ? [...rest, ...moving] : [...moving, ...rest] }
  }

export type Align = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

/** Lined up on the selection's own edge or centre. */
export const align =
  (ids: ReadonlySet<string>, how: Align): CanvasChange =>
  (doc) => {
    const picked = doc.nodes.filter((n) => ids.has(n.id))
    if (picked.length < 2) return doc
    const minX = Math.min(...picked.map((n) => n.x))
    const maxX = Math.max(...picked.map((n) => n.x + n.width))
    const minY = Math.min(...picked.map((n) => n.y))
    const maxY = Math.max(...picked.map((n) => n.y + n.height))
    const place = (n: CanvasNode): Partial<CanvasNode> => {
      switch (how) {
        case 'left':
          return { x: minX }
        case 'right':
          return { x: maxX - n.width }
        case 'center':
          return { x: (minX + maxX) / 2 - n.width / 2 }
        case 'top':
          return { y: minY }
        case 'bottom':
          return { y: maxY - n.height }
        case 'middle':
          return { y: (minY + maxY) / 2 - n.height / 2 }
      }
    }
    return { ...doc, nodes: doc.nodes.map((n) => (ids.has(n.id) ? patchNode(n, place(n)) : n)) }
  }

/** Spaced evenly between the first and the last, across or down. */
export const distribute =
  (ids: ReadonlySet<string>, axis: 'x' | 'y'): CanvasChange =>
  (doc) => {
    const picked = doc.nodes.filter((n) => ids.has(n.id))
    if (picked.length < 3) return doc
    const size = (n: CanvasNode): number => (axis === 'x' ? n.width : n.height)
    const pos = (n: CanvasNode): number => (axis === 'x' ? n.x : n.y)
    const sorted = [...picked].sort((a, b) => pos(a) - pos(b))
    const start = pos(sorted[0]!)
    const end = pos(sorted.at(-1)!) + size(sorted.at(-1)!)
    const gap = (end - start - sorted.reduce((sum, n) => sum + size(n), 0)) / (sorted.length - 1)
    const at = new Map<string, number>()
    let cursor = start
    for (const n of sorted) {
      at.set(n.id, cursor)
      cursor += size(n) + gap
    }
    return { ...doc, nodes: doc.nodes.map((n) => (at.has(n.id) ? patchNode(n, { [axis]: at.get(n.id)! }) : n)) }
  }

/** A preset ("1"–"6"), a hex colour, or none. */
export const recolor =
  (ids: ReadonlySet<string>, color: string | null): CanvasChange =>
  (doc) => ({
    ...doc,
    nodes: doc.nodes.map((n) => (ids.has(n.id) ? patchNode(n, { color: color ?? undefined }) : n)),
    edges: doc.edges.map((e) => (ids.has(e.id) ? (color === null ? withoutKey(e, 'color') : { ...e, color }) : e)),
  })

const withoutKey = <T extends object>(item: T, key: string): T => {
  const next = { ...item } as Record<string, unknown>
  delete next[key]
  return next as T
}

/** How far a new group's frame stands out from what it holds; room above for its label. */
const PAD = 30

/** A group drawn round the selection, under it. Returns its id via `made`. */
export function groupOf(ids: ReadonlySet<string>, label: string): { change: CanvasChange; made: () => string } {
  let id = ''
  const change: CanvasChange = (doc) => {
    const picked = doc.nodes.filter((n) => ids.has(n.id))
    if (picked.length === 0) return doc
    id = newCanvasId(doc)
    const x = Math.min(...picked.map((n) => n.x)) - PAD
    const y = Math.min(...picked.map((n) => n.y)) - PAD
    const group: CanvasNode = {
      id,
      type: 'group',
      x,
      y,
      width: Math.max(...picked.map((n) => n.x + n.width)) + PAD - x,
      height: Math.max(...picked.map((n) => n.y + n.height)) + PAD - y,
      label,
    }
    return { ...doc, nodes: [group, ...doc.nodes] }
  }
  return { change, made: () => id }
}

/** The nodes in a frame, put into the selection when the frame is (for zoom to selection, copy). */
export function withChildren(doc: CanvasDoc, ids: ReadonlySet<string>): Set<string> {
  const out = new Set(ids)
  for (const n of doc.nodes) if (ids.has(n.id) && n.type === 'group') for (const c of childrenOf(doc, n)) out.add(c.id)
  return out
}

/** Text a node shows, for search: its text, its note's or file's name, its link, its label. */
export function searchText(node: CanvasNode): string {
  return [node.text, node.file?.replace(/\.md$/i, ''), node.url, node.label].filter((v): v is string => typeof v === 'string').join('\n')
}

/** The size a file is given when it is put on a canvas: a note to read, an image to see, anything else as a card. */
export function fileNodeSize(file: string): { width: number; height: number } {
  const kind = fileKind(file)
  if (kind === 'note') return { width: 400, height: 400 }
  if (kind === 'image') return { width: 400, height: 300 }
  if (kind === 'pdf') return { width: 400, height: 520 }
  if (kind === 'code') return { width: 420, height: 320 }
  return { width: 320, height: 120 }
}
