import path from 'node:path'
import { childrenOf, parseCanvas, serializeCanvas, type CanvasDoc, type CanvasEdge, type CanvasNode, type CanvasSide } from '../../shared/canvas'
import {
  boundsOf,
  columns,
  GAP,
  groupFrame,
  mindMap,
  overlaps,
  packRows,
  placeAround,
  placeNear,
  type Point,
  type Rect,
  type Size,
} from '../../shared/canvas-layout'
import { acceptOps, applyOp, type CanvasOp, type GhostNode } from '../../shared/canvas-ops'
import { fileKind } from '../../shared/file-kind'
import { CANVAS_FOLDER } from '../../shared/recto-paths'
import { canvasSvg, type NodeLabel } from '../../shared/canvas-picture'
import type { ResultBlock } from '../../shared/vault-tools'
import * as vaultFs from '../vault-fs'
import { ToolError, titleOf, type Scope } from './scope'
import { proposal } from './proposals'
import type { Draft } from './write'

/**
 * The canvas tools: read a canvas, and propose changes to it - new cards,
 * notes, files and links, arrows, groups, moves, or a whole new canvas. The
 * model says what goes together; Recto works out where (canvas-layout.ts),
 * never over what is there. Changes to a canvas are edits, each accepted or
 * rejected where it was suggested, seen in its Preview (canvas-ops.ts). A node is named
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

/** How much of a text card canvas_read gives. */
const CARD_CHARS = 2000

/** What a node is, for the model - a note AI may not see is only a place. */
function described(scope: Scope, doc: CanvasDoc, n: CanvasNode, ids: Map<string, string>): Record<string, unknown> {
  // Where it is and how big: what a layout is made of - with the picture, the AI sees what it would tidy.
  const base = { id: ids.get(n.id), type: n.type, x: Math.round(n.x), y: Math.round(n.y), width: Math.round(n.width), height: Math.round(n.height) }
  if (n.type === 'text') {
    const text = n.text ?? ''
    // A long card is cut, and says so: a cut card read as the whole of it misleads.
    return text.length <= CARD_CHARS ? { ...base, text } : { ...base, text: `${text.slice(0, CARD_CHARS)}…`, cut: true, length: text.length }
  }
  if (n.type === 'file' && typeof n.file === 'string')
    return scope.fileHidden(n.file) ? { ...base, file: '(a file AI may not see)' } : { ...base, file: n.file, ...(n.file.endsWith('.md') ? { note: titleOf(n.file) } : {}) }
  if (n.type === 'link') return { ...base, url: n.url }
  if (n.type === 'group') return { ...base, label: n.label ?? '', holds: childrenOf(doc, n).map((c) => ids.get(c.id)) }
  return base
}

export function canvasList(scope: Scope): ResultBlock[] {
  return [data({ canvases: canvasesOf(scope).map((p) => ({ path: p, name: path.posix.basename(p, '.canvas') })) })]
}

/** What a node shows in the picture: as canvas_read lists it - a note AI may not see is an empty box. */
function pictured(scope: Scope, n: CanvasNode): NodeLabel {
  if (n.type === 'text') {
    const [first = '', ...rest] = (n.text ?? '').trim().split('\n')
    return { title: first.replace(/^#+\s*/, ''), lines: rest.filter((l) => l.trim() !== '') }
  }
  if (n.type === 'file' && typeof n.file === 'string')
    return scope.fileHidden(n.file) ? { title: '', lines: [], hidden: true } : { title: titleOf(n.file).replace(/\.[^.]+$/, ''), lines: [n.file.endsWith('.md') ? 'note' : fileKind(n.file)] }
  if (n.type === 'link') return { title: String(n.url ?? '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0] ?? '', lines: ['web link'] }
  return { title: '', lines: [] }
}

/**
 * The canvas as nodes and arrows - with their places and sizes - and as a picture of it (the model sees
 * overlaps and gaps a list hides; a model that cannot see pictures has the list). With `with_proposal`, as
 * it would be with that suggestion's waiting edits made, those drawn dashed green: the AI looks at what it
 * suggested before the person does.
 */
export async function canvasRead(scope: Scope, a: Args): Promise<ResultBlock[]> {
  const { path: p, doc: onDisk } = await canvasOf(scope, a['canvas'])
  let doc = onDisk
  let proposed = new Set<string>()
  if (typeof a['with_proposal'] === 'string') {
    const found = proposal(a['with_proposal'])
    if (found?.canvas === undefined || found.canvas.path !== p || found.status !== 'pending')
      throw new ToolError(`No waiting suggestion “${a['with_proposal']}” for this canvas. get_proposal says what became of it.`)
    const c = found.canvas
    const done = acceptOps(onDisk, c, c.states.flatMap((s, i) => (s === 'pending' ? [i] : [])))
    doc = done.doc
    proposed = new Set([...Object.values(done.refs), ...c.ops.flatMap((op, i) => (op.op === 'move' && done.states[i] === 'accepted' ? [op.id] : []))])
  }
  const ids = shortIds(doc)
  const nodes = doc.nodes.map((n) => described(scope, doc, n, ids))
  const cut = nodes.some((n) => n['cut'] === true)
  const picture = await pictureOf(scope, doc, ids, proposed)
  return [
    data({
      path: p,
      whole: !cut,
      ...(cut ? { note: `Text cards longer than ${CARD_CHARS} characters are cut here (cut: true, length: the whole card's).` } : {}),
      ...(proposed.size > 0 ? { proposed: [...proposed].map((id) => ids.get(id)).filter((id) => id !== undefined) } : {}),
      nodes,
      edges: doc.edges.map((e) => ({ from: ids.get(e.fromNode), to: ids.get(e.toNode), ...(typeof e.label === 'string' ? { label: e.label } : {}) })),
      picture:
        picture === null
          ? 'No picture this time: read the places and sizes above.'
          : 'A picture of the canvas goes with this answer: look at it before placing or moving anything. Keep cards in tidy rows and columns, with room between them, never overlapping.',
    }),
    ...(picture === null ? [] : [{ kind: 'image' as const, path: p, mime: 'image/png', data: picture }]),
  ]
}

/**
 * A canvas suggestion's answer: the canvas as it will be once accepted - each
 * new or moved node's place and size, what goes, and a picture with what it
 * suggested dashed green - so the AI sees what it suggested, and can take it
 * back (withdraw_proposal) and suggest better. Short ids are the canvas's
 * then. Nothing when the canvas cannot be read.
 */
export async function suggestionPicture(scope: Scope, id: string, file: { path: string; before: string | null; after: string }): Promise<ResultBlock[]> {
  let doc: CanvasDoc
  let before: CanvasDoc | null
  try {
    doc = parseCanvas(file.after)
    before = file.before === null ? null : parseCanvas(file.before)
  } catch {
    return []
  }
  const was = new Map((before?.nodes ?? []).map((n) => [n.id, n]))
  const changed = doc.nodes.filter((n) => {
    const old = was.get(n.id)
    return old === undefined || old.x !== n.x || old.y !== n.y || old.width !== n.width || old.height !== n.height
  })
  const ids = shortIds(doc)
  const kept = new Set(doc.nodes.map((n) => n.id))
  const beforeIds = before === null ? new Map<string, string>() : shortIds(before)
  const picture = await pictureOf(scope, doc, ids, new Set(changed.map((n) => n.id)))
  return [
    data({
      as_it_will_be: {
        note: `The canvas once suggestion ${id} is accepted; node ids here are its ids then.`,
        new_or_moved: changed.map((n) => ({ id: ids.get(n.id), new: !was.has(n.id), x: Math.round(n.x), y: Math.round(n.y), width: Math.round(n.width), height: Math.round(n.height) })),
        ...(before === null ? {} : { removed: before.nodes.filter((n) => !kept.has(n.id)).map((n) => beforeIds.get(n.id)) }),
        edges: doc.edges.length,
      },
      picture:
        picture === null
          ? 'No picture this time: check the places and sizes above.'
          : 'A picture of the canvas as it will be goes with this answer, what you suggested dashed green. Look at it.',
      check: `If it is cramped, overlapping or tangled, take it back (withdraw_proposal, id ${id}) and suggest better - canvas_propose_arrange puts a whole canvas in order.`,
    }),
    ...(picture === null ? [] : [{ kind: 'image' as const, path: file.path, mime: 'image/png', data: picture }]),
  ]
}

/** The canvas drawn (shared/canvas-picture.ts) and made a PNG in main; null when that cannot be done here. */
async function pictureOf(scope: Scope, doc: CanvasDoc, ids: Map<string, string>, proposed: ReadonlySet<string>): Promise<string | null> {
  try {
    const { svg, width, height } = canvasSvg(doc, ids, (n) => pictured(scope, n), proposed)
    const { svgToPng } = await import('../canvas-picture')
    const png = await svgToPng(svg, width, height)
    return png === null ? null : png.toString('base64')
  } catch {
    return null
  }
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
 * first - moves, in the same suggestion.
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

/**
 * What moves as one: a card on its own, or a frame with all it holds (frames
 * in it too) - so nothing is ever moved out of its frame, or a frame away
 * from what it holds. By the unit's own id: the card's, or the frame's.
 */
function unitsOf(doc: CanvasDoc): { unitOf: Map<string, string>; members: Map<string, CanvasNode[]> } {
  const unitOf = new Map<string, string>()
  const members = new Map<string, CanvasNode[]>()
  // Biggest frames first: a frame inside another is part of it.
  const frames = doc.nodes.filter((n) => n.type === 'group').sort((x, y) => y.width * y.height - x.width * x.height)
  for (const f of frames) {
    if (unitOf.has(f.id)) continue
    const held = [f, ...childrenOf(doc, f).filter((n) => !unitOf.has(n.id))]
    for (const n of held) unitOf.set(n.id, f.id)
    members.set(f.id, held)
  }
  for (const n of doc.nodes) {
    if (unitOf.has(n.id)) continue
    unitOf.set(n.id, n.id)
    members.set(n.id, [n])
  }
  return { unitOf, members }
}

/** A unit moved by (dx, dy): a move for it and for each thing it holds. */
const shifted = (held: readonly CanvasNode[], dx: number, dy: number): CanvasOp[] =>
  dx === 0 && dy === 0 ? [] : held.map((n) => ({ op: 'move', id: n.id, x: Math.round(n.x + dx), y: Math.round(n.y + dy) }))

/** The innermost frame a node sits in, if any. */
const frameOf = (doc: CanvasDoc, n: CanvasNode): CanvasNode | undefined =>
  doc.nodes
    .filter((g) => g.type === 'group' && g.id !== n.id && childrenOf(doc, g).some((m) => m.id === n.id))
    .sort((x, y) => x.width * x.height - y.width * y.height)[0]

/** Room inside a frame round what it holds; more at the top, under its label (as groupFrame leaves). */
const FRAME_PAD = 30

/**
 * Moves, each worked out on the canvas as the ones before it left it: a node
 * put beside another, clear of the rest - or into a frame, under what it
 * holds, the frame grown when it must. Beside a card in a frame is into that
 * frame. A frame moves with all it holds.
 */
export async function proposeCanvasLayout(scope: Scope, a: Args): Promise<Draft> {
  const c = await canvasOf(scope, a['canvas'])
  const moves = (a['moves'] as { node: string; near?: string; into?: string }[] | undefined) ?? []
  if (moves.length === 0) throw new ToolError('No moves given.')
  let doc = c.doc
  const ops: CanvasOp[] = []
  const apply = (made: CanvasOp[]): void => {
    for (const op of made) doc = applyOp(doc, op, {})?.doc ?? doc
    ops.push(...made)
  }
  for (const m of moves) {
    const node = nodeNamed(doc, m.node)
    const { members } = unitsOf(doc)
    // A frame takes what it holds along; a card in a frame moves on its own.
    const held = node.type === 'group' ? [node, ...childrenOf(doc, node)] : [node]
    const heldIds = new Set(held.map((n) => n.id))
    let frame: CanvasNode | undefined
    if (m.into !== undefined) {
      frame = nodeNamed(doc, m.into)
      if (frame.type !== 'group') throw new ToolError(`${m.into} is not a frame: give a group's id as into, or a card's as near.`)
    } else if (m.near !== undefined) {
      frame = frameOf(doc, nodeNamed(doc, m.near))
      if (frame !== undefined && heldIds.has(frame.id)) frame = undefined
    } else throw new ToolError(`Say where ${m.node} goes: near (a card) or into (a frame).`)
    if (heldIds.has(frame?.id ?? '')) throw new ToolError(`${m.node} cannot go into itself.`)

    if (frame !== undefined) {
      // Under what the frame holds now, at its left; the frame grown to take it.
      const inside = childrenOf(doc, frame).filter((n) => !heldIds.has(n.id))
      const x = frame.x + FRAME_PAD
      const y = inside.length === 0 ? frame.y + FRAME_PAD + 20 : Math.max(...inside.map((n) => n.y + n.height)) + GAP
      apply(shifted(held, x - node.x, y - node.y))
      const width = Math.max(frame.width, x + node.width + FRAME_PAD - frame.x)
      const height = Math.max(frame.height, y + node.height + FRAME_PAD - frame.y)
      if (width !== frame.width || height !== frame.height) apply([{ op: 'move', id: frame.id, x: frame.x, y: frame.y, width, height }])
      continue
    }
    // Beside the anchor, clear of every card and frame but what moves.
    const anchor = nodeNamed(doc, m.near)
    const taken: Rect[] = [...members].filter(([id]) => !heldIds.has(id)).map(([id]) => doc.nodes.find((n) => n.id === id)!)
    const r = placeNear(anchor, node, taken)
    apply(shifted(held, r.x - node.x, r.y - node.y))
  }
  if (ops.length === 0) throw new ToolError('Nothing would move: they are there already.')
  return canvasDraft(c.path, c.text, c.doc, ops, `${moves.length} move${moves.length === 1 ? '' : 's'} on ${titleOf(c.path).replace(/\.canvas$/, '')}`)
}

/**
 * A whole canvas put in order: a mind map from a root along its arrows, or
 * columns the model names - Recto works out every place, what is not in it
 * in rows below. A frame moves as one with all it holds: a card in a frame
 * is placed by placing its frame. Moves, and a frame for each labelled column.
 */
export async function proposeCanvasArrange(scope: Scope, a: Args): Promise<Draft> {
  const c = await canvasOf(scope, a['canvas'])
  const cols = (a['columns'] as { label?: string; nodes: string[] }[] | undefined) ?? []
  const rootName = a['root']
  if ((rootName === undefined) === (cols.length === 0)) throw new ToolError('Give either root (a mind map along the arrows) or columns, not both.')
  const { unitOf, members } = unitsOf(c.doc)
  const byId = new Map(c.doc.nodes.map((n) => [n.id, n]))
  const units = [...members.keys()]
  const byPlace = (x: string, y: string): number => byId.get(x)!.y - byId.get(y)!.y || byId.get(x)!.x - byId.get(y)!.x

  // Where each unit goes, relative to the block's corner; frames for labelled columns.
  const at = new Map<string, Point>()
  const frames: { label: string; members: string[] }[] = []
  /** A mind map's unit: the arrow into it, and the unit it hangs off. */
  const tree = new Map<string, { edge: CanvasEdge; parent: string }>()
  if (rootName !== undefined) {
    const root = unitOf.get(nodeNamed(c.doc, rootName).id)!
    const children = new Map<string, string[]>()
    const labelInto = new Map<string, number>()
    const seen = new Set([root])
    const queue = [root]
    // Along the arrows either way, nearest first - an arrow to a card in a frame leads to the frame; branches in the order they are now.
    for (let k = 0; k < queue.length; k++) {
      const id = queue[k]!
      const next = c.doc.edges
        .flatMap((e) => {
          const [f, t] = [unitOf.get(e.fromNode), unitOf.get(e.toNode)]
          return f === id && t !== undefined ? [[t, e] as const] : t === id && f !== undefined ? [[f, e] as const] : []
        })
        .filter(([o]) => !seen.has(o))
        .sort(([x], [y]) => byPlace(x, y))
      const kids: string[] = []
      for (const [o, edge] of next) {
        if (seen.has(o)) continue
        seen.add(o)
        kids.push(o)
        queue.push(o)
        tree.set(o, { edge, parent: id })
        if (typeof edge.label === 'string' && edge.label !== '') labelInto.set(o, edge.label.length * 7 + 16)
      }
      children.set(id, kids)
    }
    const sizes = new Map(units.map((u) => [u, { width: byId.get(u)!.width, height: byId.get(u)!.height }]))
    for (const [id, p] of mindMap(root, sizes, children, (id) => labelInto.get(id) ?? 0)) at.set(id, p)
  } else {
    const named = new Set<string>()
    const lists = cols.map((col) => {
      const ids = col.nodes.map((id) => unitOf.get(nodeNamed(c.doc, id).id)!).filter((u) => !named.has(u) && (named.add(u), true))
      return { label: col.label?.trim() ?? '', ids }
    })
    const placed = columns(lists.map((l) => ({ sizes: l.ids.map((u) => byId.get(u)!), framed: l.label !== '' })))
    lists.forEach((l, i) => {
      l.ids.forEach((u, k) => at.set(u, placed[i]![k]!))
      if (l.label !== '' && l.ids.length > 0) frames.push({ label: l.label, members: l.ids })
    })
  }

  const rectOf = (id: string, dx: number, dy: number): Rect => ({ x: at.get(id)!.x + dx, y: at.get(id)!.y + dy, width: byId.get(id)!.width, height: byId.get(id)!.height })

  // What was left out, in rows under the rest.
  const rest = units.filter((u) => !at.has(u)).sort(byPlace)
  const arranged = boundsOf([...at.keys()].map((id) => rectOf(id, 0, 0)))!
  packRows(
    rest.map((u) => byId.get(u)!),
    [],
    { x: arranged.x, y: arranged.y + arranged.height + GAP * 2 },
  ).forEach((r, i) => at.set(rest[i]!, r))

  // Everything moves, so the block goes where the canvas was: a mind map with its root where it was.
  const before = boundsOf(units.map((u) => byId.get(u)!))!
  const block = boundsOf([...at.keys()].map((id) => rectOf(id, 0, 0)))!
  const root = rootName === undefined ? null : byId.get(unitOf.get(nodeNamed(c.doc, rootName).id)!)!
  const dx = root === null ? before.x - block.x : root.x
  const dy = root === null ? before.y - block.y : root.y

  const ops: CanvasOp[] = []
  for (const [u, p] of at) {
    const n = byId.get(u)!
    const moved = shifted(members.get(u)!, Math.round(p.x + dx) - n.x, Math.round(p.y + dy) - n.y)
    // A mind map's arrow between two cards, from the parent's side to the card's facing one: so it passes no card.
    const into = tree.get(u)
    const plain = into !== undefined && into.edge.fromNode !== into.edge.toNode && [into.edge.fromNode, into.edge.toNode].every((id) => unitOf.get(id) === id && byId.get(id)!.type !== 'group')
    if (!plain) {
      ops.push(...moved)
      continue
    }
    const out: CanvasSide = p.x > at.get(into.parent)!.x ? 'right' : 'left'
    const back: CanvasSide = out === 'right' ? 'left' : 'right'
    const forward = into.edge.fromNode === into.parent
    const x = Math.round(p.x + dx)
    const y = Math.round(p.y + dy)
    ops.push({ op: 'move', id: u, x, y, sides: [{ edge: into.edge.id, from: forward ? out : back, to: forward ? back : out }] })
  }
  frames.forEach((f, k) => {
    const frame = groupFrame(f.members.map((id) => rectOf(id, dx, dy)))!
    ops.push({ op: 'add-group', ref: `group${k + 1}`, label: f.label, members: f.members, ...frame })
  })
  if (ops.length === 0) throw new ToolError('The canvas is already arranged so.')
  return canvasDraft(c.path, c.text, c.doc, ops, `${at.size} arranged on ${titleOf(c.path).replace(/\.canvas$/, '')}`)
}

/** The arrow between two nodes, either way round: the first, as canvas_read lists them. */
function edgeBetween(doc: CanvasDoc, from: unknown, to: unknown): CanvasEdge {
  const a = nodeNamed(doc, from).id
  const b = nodeNamed(doc, to).id
  const edge = doc.edges.find((e) => e.fromNode === a && e.toNode === b) ?? doc.edges.find((e) => e.fromNode === b && e.toNode === a)
  if (edge === undefined) throw new ToolError(`No arrow between ${String(from)} and ${String(to)}. canvas_read lists the arrows.`)
  return edge
}

/** Cards, frames and arrows taken off a canvas - a note's card only: the note stays. A card goes with its arrows; a frame without what it holds. */
export async function proposeCanvasRemove(scope: Scope, a: Args): Promise<Draft> {
  const c = await canvasOf(scope, a['canvas'])
  const ops: CanvasOp[] = []
  const gone = new Set<string>()
  for (const id of (a['nodes'] as string[] | undefined) ?? []) {
    const n = nodeNamed(c.doc, id)
    if (n.type === 'file' && typeof n.file === 'string' && scope.fileHidden(n.file)) throw new ToolError(`${String(id)} is a file AI may not see: it stays.`)
    if (gone.has(n.id)) continue
    gone.add(n.id)
    ops.push({ op: 'remove-node', id: n.id })
  }
  for (const e of (a['edges'] as { from: string; to: string }[] | undefined) ?? []) {
    const edge = edgeBetween(c.doc, e.from, e.to)
    // Its card already going takes it.
    if (gone.has(edge.id) || gone.has(edge.fromNode) || gone.has(edge.toNode)) continue
    gone.add(edge.id)
    ops.push({ op: 'remove-edge', id: edge.id, from: edge.fromNode, to: edge.toNode })
  }
  if (ops.length === 0) throw new ToolError('Nothing to remove: give nodes or edges.')
  return canvasDraft(c.path, c.text, c.doc, ops, `${ops.length} removed from ${titleOf(c.path).replace(/\.canvas$/, '')}`)
}

/** A new canvas in Recto/Canvas with these nodes, arrows and groups - a new file, proposed whole. */
export async function proposeCanvasNew(scope: Scope, a: Args): Promise<Draft> {
  const name = String(a['name'] ?? '').trim().replace(/\.canvas$/i, '')
  if (name === '' || /[\\/:]/.test(name)) throw new ToolError('A canvas needs a name without \\ / or :.')
  const p = `${CANVAS_FOLDER}/${name}.canvas`
  // Recto/Canvas excluded from AI: no new canvas there - and, checked first, nothing said about the ones it holds.
  if (scope.fileHidden(p)) throw new ToolError(`${CANVAS_FOLDER}/ is excluded from AI in Recto's settings, so a new canvas cannot be made there.`)
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

