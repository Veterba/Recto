import { useEffect, useState } from 'react'
import type { Proposal } from '@shared/ai-access'
import type { CanvasDoc } from '@shared/canvas'
import type { CanvasOp } from '@shared/canvas-ops'
import { IPC, IPC_EVENT } from '@shared/ipc'
import { api } from '../../../app/api'
import { Icon } from '../../../ui/Icon'

/**
 * An AI's suggested changes to the open canvas, shown in place before any is
 * written: new cards and notes as translucent ghosts, new arrows dashed,
 * groups as dashed frames, moves as an outline where the node would go. Each
 * has ✓ and ✕; the bar at the top takes or leaves them all. Nothing is in
 * the file until it is accepted (CanvasView applies it, as an edit you can
 * undo).
 */

type Rect = { x: number; y: number; width: number; height: number }

/** Edits of one proposal to accept: these indexes, or `null` for every pending one. */
export type GhostAccept = { proposal: Proposal; indexes: number[] | null }

/** The canvas's pending proposals, kept current. */
export function useCanvasProposals(path: string): Proposal[] {
  const [list, setList] = useState<Proposal[]>([])
  useEffect(() => {
    const load = (): void =>
      void api.invoke(IPC.aiProposals).then((all) => setList(all.filter((p) => p.status === 'pending' && p.canvas?.path === path)))
    load()
    return api.on(IPC_EVENT.aiProposalsChanged, load)
  }, [path])
  return list
}

/** Where the line from `r`'s centre toward (tx, ty) leaves `r`: so a ghost arrow starts at a card's edge, not across its text. */
function edgePoint(r: Rect, tx: number, ty: number): [number, number] {
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return [cx, cy]
  const t = Math.min(Math.abs(r.width / 2 / (dx || Infinity)), Math.abs(r.height / 2 / (dy || Infinity)))
  return [cx + dx * Math.min(1, t), cy + dy * Math.min(1, t)]
}

const CLIENTS: Readonly<Record<string, string>> = { 'claude-code': 'Claude Code', codex: 'Codex', 'claude-desktop': 'Claude Desktop', cursor: 'Cursor' }
const who = (client: string): string => CLIENTS[client] ?? (client.startsWith('quick-ask') || client.startsWith('recto') ? 'Recto' : client)

function Chips({ onAccept, onReject }: { onAccept: () => void; onReject: () => void }): React.ReactElement {
  return (
    <span className="canvas-ghost__chips">
      <button className="canvas-ghost__chip is-yes" aria-label="Accept" title="Accept" onClick={onAccept}>
        <Icon name="check" size={13} />
      </button>
      <button className="canvas-ghost__chip" aria-label="Reject" title="Reject" onClick={onReject}>
        <Icon name="x" size={13} />
      </button>
    </span>
  )
}

export function GhostLayer({
  proposals,
  doc,
  transform,
  onAccept,
  onReject,
}: {
  proposals: readonly Proposal[]
  doc: CanvasDoc
  transform: readonly [number, number, number]
  /** Accept these edits of these proposals (`null`: every pending one), in one go. */
  onAccept: (accepted: readonly GhostAccept[]) => void
  onReject: (proposal: Proposal, indexes: number[] | null) => void
}): React.ReactElement | null {
  const [tx, ty, zoom] = transform
  if (proposals.length === 0) return null
  const screen = (r: Rect): React.CSSProperties => ({ left: tx + r.x * zoom, top: ty + r.y * zoom, width: r.width * zoom, height: r.height * zoom })
  const pendingCount = proposals.reduce((n, p) => n + (p.canvas?.states.filter((s) => s === 'pending').length ?? 0), 0)

  return (
    <div className="canvas-ghosts" aria-label="Suggested changes">
      <div className="canvas-ghosts__bar glass-surface" role="toolbar" aria-label="Suggested changes">
        <Icon name="sparkles" size={14} />
        <span>
          {who(proposals[0]!.client)} suggests {pendingCount} change{pendingCount === 1 ? '' : 's'}
        </span>
        <button className="btn btn--sm btn--primary" onClick={() => onAccept(proposals.map((proposal) => ({ proposal, indexes: null })))}>
          Accept all
        </button>
        <button className="btn btn--sm btn--ghost" onClick={() => proposals.forEach((p) => onReject(p, null))}>
          Reject all
        </button>
      </div>
      {proposals.map((p) => {
        const c = p.canvas!
        // Where each node is, or would be: existing ones by id, new ones (and groups) by their ref.
        const rects = new Map<string, Rect>(doc.nodes.map((n) => [n.id, n]))
        c.ops.forEach((op) => {
          if (op.op === 'add-node') rects.set(op.node.ref, op.node)
          if (op.op === 'add-group') rects.set(op.ref, op)
        })
        for (const [ref, id] of Object.entries(c.refs)) {
          const real = doc.nodes.find((n) => n.id === id)
          if (real !== undefined) rects.set(ref, real)
        }
        const centre = (r: Rect): [number, number] => [tx + (r.x + r.width / 2) * zoom, ty + (r.y + r.height / 2) * zoom]
        const pending = (op: CanvasOp, i: number): boolean => c.states[i] === 'pending' && op !== undefined
        return (
          <div key={p.id} className="canvas-ghosts__proposal">
            {/* Frames first, then arrows, then cards: what a group holds is drawn over it, as on the canvas. */}
            {c.ops.map((op, i) =>
              op.op === 'add-group' && pending(op, i) ? (
                <div key={i} className="canvas-ghost is-group" style={screen(op)}>
                  <span className="canvas-ghost__label">{op.label}</span>
                  <Chips onAccept={() => onAccept([{ proposal: p, indexes: [i] }])} onReject={() => onReject(p, [i])} />
                </div>
              ) : null,
            )}
            <svg className="canvas-ghosts__lines" aria-hidden="true">
              {c.ops.map((op, i) => {
                if (!pending(op, i)) return null
                if (op.op === 'add-edge') {
                  const a = rects.get(op.from)
                  const b = rects.get(op.to)
                  if (a === undefined || b === undefined) return null
                  const [ax, ay] = edgePoint(a, b.x + b.width / 2, b.y + b.height / 2)
                  const [bx, by] = edgePoint(b, a.x + a.width / 2, a.y + a.height / 2)
                  return <line key={i} className="canvas-ghost__line" x1={tx + ax * zoom} y1={ty + ay * zoom} x2={tx + bx * zoom} y2={ty + by * zoom} />
                }
                if (op.op === 'move') {
                  const from = rects.get(op.id)
                  if (from === undefined) return null
                  const [x1, y1] = centre(from)
                  const [x2, y2] = centre({ ...from, x: op.x, y: op.y })
                  return <line key={i} className="canvas-ghost__line is-move" x1={x1} y1={y1} x2={x2} y2={y2} />
                }
                return null
              })}
            </svg>
            {c.ops.map((op, i) => {
              if (!pending(op, i)) return null
              const accept = (): void => onAccept([{ proposal: p, indexes: [i] }])
              const reject = (): void => onReject(p, [i])
              if (op.op === 'add-group') return null
              if (op.op === 'add-node')
                return (
                  <div key={i} className="canvas-ghost" style={screen(op.node)}>
                    <span className="canvas-ghost__text">
                      {op.node.type === 'text' ? op.node.text : op.node.type === 'file' ? op.node.file?.split('/').pop()?.replace(/\.md$/i, '') : op.node.url}
                    </span>
                    <Chips onAccept={accept} onReject={reject} />
                  </div>
                )
              if (op.op === 'move') {
                const from = rects.get(op.id)
                if (from === undefined) return null
                return (
                  <div key={i} className="canvas-ghost is-move" style={screen({ ...from, x: op.x, y: op.y })}>
                    <Chips onAccept={accept} onReject={reject} />
                  </div>
                )
              }
              // An arrow: its chips halfway along it.
              const a = rects.get(op.from)
              const b = rects.get(op.to)
              if (a === undefined || b === undefined) return null
              const [x1, y1] = centre(a)
              const [x2, y2] = centre(b)
              return (
                <div key={i} className="canvas-ghost__edge" style={{ left: (x1 + x2) / 2, top: (y1 + y2) / 2 }}>
                  {op.label !== undefined && <span className="canvas-ghost__edge-label">{op.label}</span>}
                  <Chips onAccept={accept} onReject={reject} />
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
