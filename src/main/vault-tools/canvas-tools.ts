import path from 'node:path'
import { childrenOf, parseCanvas, serializeCanvas, type CanvasDoc, type CanvasNode } from '../../shared/canvas'
import { groupFrame, overlaps, packRows, placeAround, placeNear, type Rect, type Size } from '../../shared/canvas-layout'
import { acceptOps, type CanvasOp, type GhostNode } from '../../shared/canvas-ops'
import { fileKind } from '../../shared/file-kind'
import { CANVAS_FOLDER } from '../../shared/recto-paths'
import type { ResultBlock } from '../../shared/vault-tools'
import * as vaultFs from '../vault-fs'
import { ToolError, titleOf, type Scope } from './scope'
import type { Draft } from './write'

/**
 * The canvas tools: read a canvas, and propose changes to it - new cards,
 * notes, files and links, arrows, groups, moves, or a whole new canvas. The
 * model says what goes together; Recto works out where (canvas-layout.ts),
 * never over what is there. Changes to a canvas are edits shown on it as
 * ghosts, each accepted or rejected there (canvas-ops.ts). A node is named
 * by a short id - n1, n2… in the file's order - or its own id.
 */

type Args = Record<string, unknown>

const data = (value: unknown): ResultBlock => ({ kind: 'data', data: value })
const MAX_NEW = 24

const isCanvas = (p: string): boolean => p.toLowerCase().endsWith('.canvas')

/** The canvases the AI may see. */
const canvasesOf = (scope: Scope): string[] => vaultFs.vaultFiles().filter((p) => isCanvas(p) && !scope.fileHidden(p))

/** A canvas given by path or name: its path and what is in it. */
async function canvasOf(scope: Scope, target: unknown): Promise<{ path: string; text: string; doc: CanvasDoc }> {
  const name = String(target ?? '').trim()
  const p = scope.needFile(isCanvas(name) ? name : `${name}.canvas`)
  if (!isCanvas(p)) throw new ToolError(`“${name}” is not a canvas.`)
  const read = await vaultFs.readFile(p)
  if (!read.ok) throw new ToolError(`“${name}” could not be read.`)
  try {
    return { path: p, text: read.content, doc: parseCanvas(read.content) }
  } catch {
    throw new ToolError(`“${name}” is not a canvas Recto can read.`)
  }
}

/** n1, n2… for each node, in the file's order; and back. */
const shortIds = (doc: CanvasDoc): Map<string, string> => new Map(doc.nodes.map((n, i) => [n.id, `n${i + 1}`]))
function nodeNamed(doc: CanvasDoc, id: unknown): CanvasNode {
  const s = String(id ?? '').trim()
  const m = /^n(\d+)$/.exec(s)
  const found = m !== null ? doc.nodes[Number(m[1]) - 1] : doc.nodes.find((n) => n.id === s)
  if (found === undefined) throw new ToolError(`No node “${s}” on this canvas. Read it again (canvas_read) for its nodes' ids.`)
  return found
}

/** What a node is, for the model - a note AI may not see is only a place. */
function described(scope: Scope, doc: CanvasDoc, n: CanvasNode, ids: Map<string, string>): Record<string, unknown> {
  const base = { id: ids.get(n.id), type: n.type }
  if (n.type === 'text') return { ...base, text: (n.text ?? '').slice(0, 400) }
  if (n.type === 'file' && typeof n.file === 'string')
    return scope.fileHidden(n.file) ? { ...base, file: '(a file AI may not see)' } : { ...base, file: n.file, ...(n.file.endsWith('.md') ? { note: titleOf(n.file) } : {}) }
  if (n.type === 'link') return { ...base, url: n.url }
  if (n.type === 'group') return { ...base, label: n.label ?? '', holds: childrenOf(doc, n).map((c) => ids.get(c.id)) }
  return base
}

export function canvasList(scope: Scope): ResultBlock[] {
  return [data({ canvases: canvasesOf(scope).map((p) => ({ path: p, name: path.posix.basename(p, '.canvas') })) })]
}

export async function canvasRead(scope: Scope, a: Args): Promise<ResultBlock[]> {
  const { path: p, doc } = await canvasOf(scope, a['canvas'])
  const ids = shortIds(doc)
  return [
    data({
      path: p,
      nodes: doc.nodes.map((n) => described(scope, doc, n, ids)),
      edges: doc.edges.map((e) => ({ from: ids.get(e.fromNode), to: ids.get(e.toNode), ...(typeof e.label === 'string' ? { label: e.label } : {}) })),
    }),
  ]
}

/** How big a new node is: a card by its text, a note or a picture as Recto puts them on a canvas. */
function sizeOf(n: { text?: string; file?: string; url?: string }): Size {
  if (n.file !== undefined) {
    const kind = fileKind(n.file)
    return kind === 'note' ? { width: 400, height: 300 } : kind === 'image' ? { width: 400, height: 300 } : kind === 'pdf' ? { width: 400, height: 520 } : { width: 320, height: 120 }
  }
  if (n.url !== undefined) return { width: 400, height: 220 }
  const lines = (n.text ?? '').split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 32)), 0)
  return { width: 260, height: Math.min(600, 40 + lines * 24) }
}

/** A canvas's edits as a draft: the edits, and the canvas with all of them for the list. */
function canvasDraft(p: string, text: string, doc: CanvasDoc, ops: CanvasOp[], summary: string): Draft {
  const all = acceptOps(doc, { path: p, ops, states: ops.map(() => 'pending'), refs: {} }, ops.map((_, i) => i))
  return { summary, files: [{ path: p, before: text, after: serializeCanvas(all.doc) }], formatted: [], canvas: { path: p, ops } }
}

type NewNode = { text?: string; note?: string; file?: string; url?: string; near?: string; color?: string }

/** New nodes for these specs, placed: near their anchor (round it, for several), else in free space. */
function placeNodes(scope: Scope, doc: CanvasDoc, specs: readonly NewNode[], refBase = 1): { nodes: GhostNode[]; ops: CanvasOp[] } {
  if (specs.length > MAX_NEW) throw new ToolError(`At most ${MAX_NEW} new nodes in one proposal.`)
  const taken: Rect[] = doc.nodes.filter((n) => n.type !== 'group')
  const made: GhostNode[] = []
  const byAnchor = new Map<string, number[]>()
  const loose: number[] = []
  specs.forEach((s, i) => {
    if (s.near === undefined || s.near === '') loose.push(i)
    else byAnchor.set(nodeNamed(doc, s.near).id, [...(byAnchor.get(nodeNamed(doc, s.near).id) ?? []), i])
  })
  const content = (s: NewNode): Pick<GhostNode, 'type' | 'text' | 'file' | 'url'> => {
    const given = [s.text, s.note, s.file, s.url].filter((v) => v !== undefined && v !== '').length
    if (given !== 1) throw new ToolError('Each new node is one of: text, note, file or url.')
    if (s.note !== undefined || s.file !== undefined) {
      const target = s.note !== undefined ? (s.note.endsWith('.md') ? s.note : `${s.note}.md`) : s.file!
      const found = scope.resolveFile(target)
      if (found === null) throw new ToolError(`No file “${s.note ?? s.file}” in this vault.`)
      return { type: 'file', file: found }
    }
    if (s.url !== undefined) return { type: 'link', url: s.url }
    return { type: 'text', text: s.text! }
  }
  const out: (GhostNode | undefined)[] = []
  for (const [anchorId, indexes] of byAnchor) {
    const anchor = doc.nodes.find((n) => n.id === anchorId)!
    const contents = indexes.map((i) => content(specs[i]!))
    const rects = placeAround(anchor, contents.map((c) => sizeOf(c)), [...taken, ...made])
    indexes.forEach((i, k) => {
      const g: GhostNode = { ref: `g${refBase + i}`, ...contents[k]!, ...rects[k]!, ...(specs[i]!.color === undefined ? {} : { color: specs[i]!.color }) }
      out[i] = g
      made.push(g)
    })
  }
  if (loose.length > 0) {
    const contents = loose.map((i) => content(specs[i]!))
    const rects = packRows(contents.map((c) => sizeOf(c)), [...taken, ...made])
    loose.forEach((i, k) => {
      const g: GhostNode = { ref: `g${refBase + i}`, ...contents[k]!, ...rects[k]!, ...(specs[i]!.color === undefined ? {} : { color: specs[i]!.color }) }
      out[i] = g
      made.push(g)
    })
  }
  const nodes = out as GhostNode[]
  return { nodes, ops: nodes.map((node) => ({ op: 'add-node', node })) }
}

/** An arrow's end: an existing node's id, or "new:N" - the Nth new node of this proposal. */
function endOf(doc: CanvasDoc, nodes: readonly GhostNode[], v: unknown): string {
  const s = String(v ?? '').trim()
  const m = /^new:(\d+)$/.exec(s)
  if (m !== null) {
    const g = nodes[Number(m[1]) - 1]
    if (g === undefined) throw new ToolError(`“${s}”: there are only ${nodes.length} new nodes.`)
    return g.ref
  }
  return nodeNamed(doc, s).id
}

const edgesOf = (doc: CanvasDoc, nodes: readonly GhostNode[], specs: unknown): CanvasOp[] =>
  (Array.isArray(specs) ? (specs as { from: unknown; to: unknown; label?: string }[]) : []).map((e) => ({
    op: 'add-edge',
    from: endOf(doc, nodes, e.from),
    to: endOf(doc, nodes, e.to),
    ...(typeof e.label === 'string' && e.label !== '' ? { label: e.label } : {}),
  }))

export async function proposeCanvasNodes(scope: Scope, a: Args): Promise<Draft> {
  const c = await canvasOf(scope, a['canvas'])
  const { nodes, ops } = placeNodes(scope, c.doc, (a['nodes'] as NewNode[] | undefined) ?? [])
  const edges = edgesOf(c.doc, nodes, a['edges'])
  if (ops.length + edges.length === 0) throw new ToolError('Nothing to add: give nodes, and arrows between them if any.')
  return canvasDraft(c.path, c.text, c.doc, [...ops, ...edges], `${ops.length} new on ${titleOf(c.path).replace(/\.canvas$/, '')}`)
}

export async function proposeCanvasEdges(scope: Scope, a: Args): Promise<Draft> {
  const c = await canvasOf(scope, a['canvas'])
  const edges = edgesOf(c.doc, [], a['edges'])
  if (edges.length === 0) throw new ToolError('No arrows given.')
  return canvasDraft(c.path, c.text, c.doc, edges, `${edges.length} arrow${edges.length === 1 ? '' : 's'} on ${titleOf(c.path).replace(/\.canvas$/, '')}`)
}

/**
 * Groups: a labelled frame round each group's nodes. When the frame round them
 * where they are would take in other nodes, they are gathered in free space
 * first - moves, shown as ghosts too.
 */
export async function proposeCanvasGroup(scope: Scope, a: Args): Promise<Draft> {
  const c = await canvasOf(scope, a['canvas'])
  const specs = (a['groups'] as { label: string; nodes: string[] }[] | undefined) ?? []
  if (specs.length === 0) throw new ToolError('No groups given.')
  const ops: CanvasOp[] = []
  // Where each node is after this proposal's moves, for the next group's room.
  const at = new Map<string, Rect>(c.doc.nodes.filter((n) => n.type !== 'group').map((n) => [n.id, n]))
  specs.forEach((g, k) => {
    const members = [...new Set(g.nodes.map((id) => nodeNamed(c.doc, id)))].filter((n) => n.type !== 'group')
    if (members.length === 0) throw new ToolError(`Group “${g.label}” has no nodes.`)
    let rects = members.map((m) => at.get(m.id)!)
    let frame = groupFrame(rects)!
    const others = [...at].filter(([id]) => !members.some((m) => m.id === id)).map(([, r]) => r)
    if (others.some((o) => overlaps(o, frame))) {
      rects = packRows(rects, [...at.values()])
      members.forEach((m, i) => {
        ops.push({ op: 'move', id: m.id, x: rects[i]!.x, y: rects[i]!.y })
        at.set(m.id, rects[i]!)
      })
      frame = groupFrame(rects)!
    }
    ops.push({ op: 'add-group', ref: `group${k + 1}`, label: g.label, members: members.map((m) => m.id), ...frame })
  })
  return canvasDraft(c.path, c.text, c.doc, ops, `${specs.length} group${specs.length === 1 ? '' : 's'} on ${titleOf(c.path).replace(/\.canvas$/, '')}`)
}

/** Moves: each node put beside another, clear of the rest. */
export async function proposeCanvasLayout(scope: Scope, a: Args): Promise<Draft> {
  const c = await canvasOf(scope, a['canvas'])
  const moves = (a['moves'] as { node: string; near: string }[] | undefined) ?? []
  if (moves.length === 0) throw new ToolError('No moves given.')
  const at = new Map<string, Rect>(c.doc.nodes.filter((n) => n.type !== 'group').map((n) => [n.id, n]))
  const ops: CanvasOp[] = moves.map((m) => {
    const node = nodeNamed(c.doc, m.node)
    const anchor = nodeNamed(c.doc, m.near)
    at.delete(node.id)
    const r = placeNear(at.get(anchor.id) ?? anchor, node, [...at.values()])
    at.set(node.id, r)
    return { op: 'move', id: node.id, x: r.x, y: r.y }
  })
  return canvasDraft(c.path, c.text, c.doc, ops, `${ops.length} move${ops.length === 1 ? '' : 's'} on ${titleOf(c.path).replace(/\.canvas$/, '')}`)
}

/** A new canvas in Recto/Canvas with these nodes, arrows and groups - a new file, proposed whole. */
export async function proposeCanvasNew(scope: Scope, a: Args): Promise<Draft> {
  const name = String(a['name'] ?? '').trim().replace(/\.canvas$/i, '')
  if (name === '' || /[\\/:]/.test(name)) throw new ToolError('A canvas needs a name without \\ / or :.')
  const p = `${CANVAS_FOLDER}/${name}.canvas`
  if (vaultFs.vaultFiles().some((f) => f.toLowerCase() === p.toLowerCase())) throw new ToolError(`A canvas “${name}” is already in ${CANVAS_FOLDER}/. Choose another name.`)
  const empty: CanvasDoc = { nodes: [], edges: [], rest: {}, order: ['nodes', 'edges'] }
  const specs = ((a['nodes'] as NewNode[] | undefined) ?? []).map(({ near: _near, ...rest }) => rest)
  const { nodes, ops } = placeNodes(scope, empty, specs)
  if (nodes.length === 0) throw new ToolError('A new canvas needs nodes.')
  // A new file has nothing to review edit by edit: every edit, applied.
  const all = [...ops, ...edgesOf(empty, nodes, a['edges'])]
  const doc = acceptOps(empty, { path: p, ops: all, states: all.map(() => 'pending'), refs: {} }, all.map((_, i) => i)).doc
  return { summary: `New canvas ${name}`, files: [{ path: p, before: null, after: serializeCanvas(doc) }], formatted: [] }
}

