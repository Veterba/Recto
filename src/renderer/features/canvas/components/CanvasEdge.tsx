import { memo, useState } from 'react'
import { useCanvasActions } from '../canvas-actions'
import { Icon } from '../../../ui/Icon'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useInternalNode, useReactFlow, useStore, type EdgeProps } from '@xyflow/react'
import { edgeEnds, styleOf, type CanvasEdge } from '@shared/canvas'
import type { FlowEdge } from '../canvas-flow'
import {
  anchorAt,
  anchorsOf,
  arrowShape,
  bendOf,
  bendTowards,
  CENTRE,
  isPinned,
  pointIn,
  type End,
  type Point,
  type Rect,
} from '../arrow-geometry'
import { colorOf } from './CanvasNodes'

/**
 * An edge as JSON Canvas has it: an arrow at either end or both (the spec's
 * defaults: none at the start, one at the end), a colour and a label in the
 * middle. One Obsidian made runs as a curve between two sides; one made in
 * Recto is pinned inside its nodes and drawn the tldraw way (arrow-geometry.ts).
 *
 * Selected, it shows three handles: its two ends, dragged onto another node
 * (pinned where they are dropped, or at the centre near the middle) or into
 * the open, and its middle, dragged sideways to bend it.
 */

/** An edge's line as the style bar set it: dashes (Advanced Canvas's `path`) and width (Recto's). */
const DASHES: Readonly<Record<string, string>> = { 'long-dashed': '10 6', 'short-dashed': '5 4', dotted: '1.5 4' }
const WIDTHS: Readonly<Record<string, number>> = { thin: 1, thick: 3 }
function lineOf(edge: CanvasEdge): React.CSSProperties {
  const style = styleOf(edge)
  const dash = style['path'] === undefined ? undefined : DASHES[style['path']]
  const width = style['width'] === undefined ? undefined : WIDTHS[style['width']]
  return {
    ...(dash === undefined ? {} : { strokeDasharray: dash, strokeLinecap: 'round' as const }),
    ...(width === undefined ? {} : { strokeWidth: width }),
  }
}

type Drag = { handle: 'from' | 'to' | 'bend'; at: Point; hit: { id: string; rect: Rect } | null }

/** How near the straight line, on screen, the middle snaps straight again. */
const STRAIGHT_PX = 8

/** Where a node is drawn now (mid-drag too), and whether it is an arrow's free end. */
function useRect(id: string): { rect: Rect; point: boolean } | null {
  const node = useInternalNode(id)
  if (node === undefined) return null
  const p = node.internals.positionAbsolute
  const rect = { x: p.x, y: p.y, width: node.measured.width ?? node.width ?? 0, height: node.measured.height ?? node.height ?? 0 }
  return { rect, point: node.type === 'point' }
}

export const CanvasEdgeView = memo(function CanvasEdgeView(props: EdgeProps<FlowEdge>): React.ReactElement {
  const actions = useCanvasActions()
  const edge = props.data!.edge
  const typing = actions.editingEdge === props.id
  const isLink = actions.linked.has(props.id)
  const flow = useReactFlow()
  const zoom = useStore((st) => st.transform[2])
  const fromNode = useRect(props.source)
  const toNode = useRect(props.target)
  const [drag, setDrag] = useState<Drag | null>(null)
  const pins = anchorsOf(edge)
  const pinned = isPinned(edge) || drag !== null

  /** An end as drawn: being dragged, at its pin, or (a free end) at its point. */
  const endOf = (which: 'from' | 'to'): End | null => {
    if (drag !== null && drag.handle === which)
      return drag.hit === null ? { at: drag.at, cut: null } : { at: pointIn(drag.hit.rect, anchorAt(drag.hit.rect, drag.at)), cut: drag.hit.rect }
    const node = which === 'from' ? fromNode : toNode
    if (node === null) return null
    if (node.point) return { at: pointIn(node.rect, CENTRE), cut: null }
    return { at: pointIn(node.rect, (which === 'from' ? pins.from : pins.to) ?? CENTRE), cut: node.rect }
  }
  const from = endOf('from')
  const to = endOf('to')
  const bend =
    drag?.handle === 'bend' && from !== null && to !== null ? bendTowards(from.at, to.at, drag.at, STRAIGHT_PX / zoom) : bendOf(edge)
  const shape = pinned && from !== null && to !== null ? arrowShape(from, to, bend) : null
  const [curve, curveX, curveY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })
  const path = shape?.d ?? curve
  const labelX = shape?.mid.x ?? curveX
  const labelY = shape?.mid.y ?? curveY
  const handles = {
    from: shape?.start ?? { x: props.sourceX, y: props.sourceY },
    bend: { x: labelX, y: labelY },
    to: shape?.end ?? { x: props.targetX, y: props.targetY },
  }

  const grab = (handle: Drag['handle']) => (ev: React.PointerEvent) => {
    ev.stopPropagation()
    ev.preventDefault()
    const el = ev.currentTarget as HTMLElement
    el.setPointerCapture(ev.pointerId)
    // The arrow's own other end is never what an end lands on.
    const exclude = new Set([handle === 'from' ? props.target : props.source])
    const place = (e: React.PointerEvent | PointerEvent): Drag => {
      const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      return { handle, at, hit: handle === 'bend' ? null : actions.nodeAt(at, exclude) }
    }
    setDrag(place(ev))
    const move = (e: PointerEvent): void => setDrag(place(e))
    const up = (e: PointerEvent): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      const done = place(e)
      setDrag(null)
      if (handle === 'bend') {
        if (from !== null && to !== null) actions.setEdgeBend(props.id, bendTowards(from.at, to.at, done.at, STRAIGHT_PX / zoom))
      } else
        actions.setEdgeEnd(
          props.id,
          handle,
          done.hit === null ? { point: done.at } : { node: done.hit.id, anchor: anchorAt(done.hit.rect, done.at) },
        )
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const ends = edgeEnds(edge)
  const color = colorOf(edge.color) ?? 'var(--canvas-edge)'
  const marker = `canvas-arrow-${props.id}`
  return (
    <>
      <defs>
        <marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={color} />
        </marker>
      </defs>
      <BaseEdge
        id={props.id}
        path={path}
        className={`canvas-edge${props.selected ? ' is-selected' : ''}`}
        style={{ stroke: color, ...lineOf(edge) }}
        {...(ends.to === 'arrow' ? { markerEnd: `url(#${marker})` } : {})}
        {...(ends.from === 'arrow' ? { markerStart: `url(#${marker})` } : {})}
      />
      {/* While its label is typed, the handles step out of the way: the middle one would sit on the text. */}
      {props.selected && !typing && (
        <EdgeLabelRenderer>
          {shape !== null && (
            // Over the nodes, as the handles are: from each pin to where the arrow leaves its node.
            <svg className="canvas-edge__pins" aria-hidden="true">
              {from?.cut != null && <path className="canvas-edge__pin" d={`M${from.at.x} ${from.at.y}L${shape.start.x} ${shape.start.y}`} />}
              {to?.cut != null && <path className="canvas-edge__pin" d={`M${to.at.x} ${to.at.y}L${shape.end.x} ${shape.end.y}`} />}
            </svg>
          )}
          {(['from', 'bend', 'to'] as const).map((h) => {
            // An end's handle sits on its pin, as tldraw's does; the middle's on the arrow.
            const at = h === 'bend' ? handles.bend : h === 'from' ? (from?.cut != null ? from.at : handles.from) : to?.cut != null ? to.at : handles.to
            const shown = drag?.handle === h ? (h === 'bend' ? handles.bend : drag.at) : at
            return (
              <div
                key={h}
                className={`canvas-edge__handle canvas-edge__handle--${h} nodrag nopan`}
                aria-label={h === 'bend' ? 'Bend the arrow' : h === 'from' ? 'Move the start' : 'Move the end'}
                style={{ transform: `translate(-50%, -50%) translate(${shown.x}px, ${shown.y}px)` }}
                onPointerDown={grab(h)}
                onDoubleClick={h === 'bend' ? () => actions.setEdgeBend(props.id, 0) : undefined}
              />
            )
          })}
        </EdgeLabelRenderer>
      )}
      {(typing || isLink || (edge.label !== undefined && edge.label !== '')) && (
        <EdgeLabelRenderer>
          <div
            className="canvas-edge__label nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onDoubleClick={() => actions.startEdgeLabel(props.id)}
          >
            {typing ? (
              <input
                className="canvas-edge__input"
                aria-label="Edge label"
                defaultValue={edge.label ?? ''}
                autoFocus
                onBlur={(ev) => actions.setEdgeLabel(props.id, ev.target.value.trim())}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') ev.currentTarget.blur()
                  if (ev.key === 'Escape') {
                    ev.currentTarget.value = edge.label ?? ''
                    ev.currentTarget.blur()
                  }
                }}
              />
            ) : (
              <>
                {isLink && <Icon name="link" size={11} className="canvas-edge__link" aria-label="A link in the note" />}
                {edge.label}
              </>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})

export const EDGE_TYPES = { canvas: CanvasEdgeView }
