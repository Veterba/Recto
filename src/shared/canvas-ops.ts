import { newCanvasId, patchNode, type CanvasDoc, type CanvasEdge, type CanvasNode } from './canvas'

/**
 * An AI's changes to a canvas, as small edits rather than a new file: so each
 * can be accepted or rejected on its own, on the canvas, and applied to the
 * canvas as it is when accepted - not as it was when proposed. A new node has
 * a `ref` (g1, g2…) that the proposal's other edits may name before it
 * exists; once accepted it has a real id (`refs`).
 */

export type GhostNode = {
  ref: string
  type: 'text' | 'file' | 'link'
  text?: string
  file?: string
  url?: string
  x: number
  y: number
  width: number
  height: number
  color?: string
}

export type CanvasOp =
  | { op: 'add-node'; node: GhostNode }
  /** Ends are existing node ids or new nodes' refs. */
  | { op: 'add-edge'; from: string; to: string; label?: string }
  /** A labelled frame round `members` (ids or refs): Recto worked out its box. */
  | { op: 'add-group'; ref: string; label: string; members: string[]; x: number; y: number; width: number; height: number }
  | { op: 'move'; id: string; x: number; y: number }

export type CanvasOpState = 'pending' | 'accepted' | 'rejected' | 'stale'

export type CanvasProposal = {
  path: string
  ops: CanvasOp[]
  states: CanvasOpState[]
  /** New nodes' refs, once accepted: their ids in the file. */
  refs: Record<string, string>
}

/** The node an id or a ref means now, or null. */
const idOf = (doc: CanvasDoc, refs: Readonly<Record<string, string>>, idOrRef: string): string | null => {
  const id = refs[idOrRef] ?? idOrRef
  return doc.nodes.some((n) => n.id === id) ? id : null
}

/** The edits an edit needs first: an arrow's or a group's new nodes, by their index. */
export function needs(ops: readonly CanvasOp[], index: number): number[] {
  const op = ops[index]!
  const refs = op.op === 'add-edge' ? [op.from, op.to] : op.op === 'add-group' ? op.members : []
  return refs.flatMap((r) => {
    const at = ops.findIndex((o) => (o.op === 'add-node' && o.node.ref === r) || (o.op === 'add-group' && o.ref === r))
    return at === -1 || at === index ? [] : [at]
  })
}

/**
 * One edit applied to the canvas as it is now: the new canvas, and the refs
 * it made real; null when it no longer fits (a node it names is gone).
 */
export function applyOp(
  doc: CanvasDoc,
  op: CanvasOp,
  refs: Readonly<Record<string, string>>,
): { doc: CanvasDoc; refs: Record<string, string> } | null {
  const round = Math.round
  switch (op.op) {
    case 'add-node': {
      const id = newCanvasId(doc)
      const { ref: _ref, ...rest } = op.node
      const node: CanvasNode = { ...rest, id, x: round(rest.x), y: round(rest.y), width: round(rest.width), height: round(rest.height) }
      return { doc: { ...doc, nodes: [...doc.nodes, node] }, refs: { ...refs, [op.node.ref]: id } }
    }
    case 'add-edge': {
      const from = idOf(doc, refs, op.from)
      const to = idOf(doc, refs, op.to)
      if (from === null || to === null) return null
      const edge: CanvasEdge = { id: newCanvasId(doc), fromNode: from, toNode: to, ...(op.label === undefined ? {} : { label: op.label }) }
      return { doc: { ...doc, edges: [...doc.edges, edge] }, refs: { ...refs } }
    }
    case 'add-group': {
      if (op.members.some((m) => idOf(doc, refs, m) === null)) return null
      const id = newCanvasId(doc)
      // A group goes first: drawn under what it holds, as Obsidian has it.
      const group: CanvasNode = { id, type: 'group', label: op.label, x: round(op.x), y: round(op.y), width: round(op.width), height: round(op.height) }
      return { doc: { ...doc, nodes: [group, ...doc.nodes] }, refs: { ...refs, [op.ref]: id } }
    }
    case 'move': {
      const id = idOf(doc, refs, op.id)
      if (id === null) return null
      return { doc: { ...doc, nodes: doc.nodes.map((n) => (n.id === id ? patchNode(n, { x: op.x, y: op.y }) : n)) }, refs: { ...refs } }
    }
  }
}

/**
 * The pending edits at `indexes` - and the new nodes they need - applied in
 * order. The states after: accepted, or stale when one no longer fits.
 */
export function acceptOps(
  doc: CanvasDoc,
  proposal: CanvasProposal,
  indexes: readonly number[],
): { doc: CanvasDoc; states: CanvasOpState[]; refs: Record<string, string> } {
  const want = new Set<number>()
  const add = (i: number): void => {
    if (want.has(i) || proposal.states[i] !== 'pending') return
    for (const n of needs(proposal.ops, i)) add(n)
    want.add(i)
  }
  for (const i of indexes) add(i)
  let now = doc
  let refs = { ...proposal.refs }
  const states = [...proposal.states]
  for (const i of [...want].sort((a, b) => a - b)) {
    const done = applyOp(now, proposal.ops[i]!, refs)
    if (done === null) states[i] = 'stale'
    else {
      now = done.doc
      refs = done.refs
      states[i] = 'accepted'
    }
  }
  return { doc: now, states, refs }
}

/** The edits at `indexes` rejected - and the arrows and groups that needed them, which cannot be made without them. */
export function rejectOps(proposal: CanvasProposal, indexes: readonly number[]): CanvasOpState[] {
  const states = [...proposal.states]
  const out = new Set(indexes.filter((i) => states[i] === 'pending'))
  let grew = true
  while (grew) {
    grew = false
    proposal.ops.forEach((_, i) => {
      if (states[i] === 'pending' && !out.has(i) && needs(proposal.ops, i).some((n) => out.has(n))) {
        out.add(i)
        grew = true
      }
    })
  }
  for (const i of out) states[i] = 'rejected'
  return states
}

/** What became of a proposal once no edit is pending: applied when any was accepted. */
export const settledAs = (states: readonly CanvasOpState[]): 'pending' | 'applied' | 'discarded' =>
  states.includes('pending') ? 'pending' : states.includes('accepted') ? 'applied' : 'discarded'
