import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { erase, HIGHLIGHT_OPACITY, strokePath, type Pt, type Stroke } from '../drawing'
import { PEN_COLORS } from '../pen'

/**
 * A drawing opened to edit its strokes (double-click it): click a stroke to
 * select it, drag round several; drag what is selected to move it, a corner
 * to resize it; recolour or delete it from the bar over it. ⌘Z and ⇧⌘Z go
 * back and forth within the edit, Esc - or a click outside - finishes. Each
 * change is written to the drawing's SVG when it is let go (`onChange`).
 * Strokes here are in canvas units.
 */

type Box = { x: number; y: number; width: number; height: number }
type Drag =
  | { kind: 'move'; from: Pt; before: Stroke[] }
  | { kind: 'resize'; corner: number; anchor: [number, number]; box: Box; before: Stroke[] }
  | { kind: 'marquee'; from: Pt; to: Pt }

/** How far from a stroke a click still picks it, and a handle's size, in screen pixels. */
const PICK_PX = 6
const HANDLE_PX = 9
/** Room round the drawing where a drag still selects, in screen pixels. */
const ROOM_PX = 160

const boxOf = (strokes: readonly Stroke[]): Box | null => {
  if (strokes.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of strokes)
    for (const [x, y] of s.points) {
      x0 = Math.min(x0, x - s.size / 2)
      y0 = Math.min(y0, y - s.size / 2)
      x1 = Math.max(x1, x + s.size / 2)
      y1 = Math.max(y1, y + s.size / 2)
    }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

const moved = (s: Stroke, dx: number, dy: number): Stroke => ({ ...s, points: s.points.map(([x, y, p]) => [x + dx, y + dy, p] as Pt) })
const scaled = (s: Stroke, ax: number, ay: number, sx: number, sy: number): Stroke => ({
  ...s,
  points: s.points.map(([x, y, p]) => [ax + (x - ax) * sx, ay + (y - ay) * sy, p] as Pt),
})

export function DrawingEditor({
  strokes: initial,
  transform,
  toFlow,
  onChange,
  onDrawHere,
  onClose,
}: {
  strokes: readonly Stroke[]
  /** The canvas's pan and zoom: [x, y, zoom]. */
  transform: readonly [number, number, number]
  toFlow: (clientX: number, clientY: number) => { x: number; y: number }
  onChange: (strokes: Stroke[]) => void
  onDrawHere: () => void
  onClose: () => void
}): React.ReactElement {
  const [strokes, setStrokes] = useState<Stroke[]>([...initial])
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [drag, setDrag] = useState<Drag | null>(null)
  const undos = useRef<Stroke[][]>([])
  const redos = useRef<Stroke[][]>([])
  const [tx, ty, zoom] = transform

  /** A change made: kept for ⌘Z, and written. */
  const commit = useCallback(
    (before: Stroke[], next: Stroke[]) => {
      undos.current.push(before)
      redos.current = []
      setStrokes(next)
      onChange(next)
    },
    [onChange],
  )

  const pick = (p: Pt): number | null => {
    for (let i = strokes.length - 1; i >= 0; i--) if (erase([strokes[i]!], [p], PICK_PX / zoom).length === 0) return i
    return null
  }
  const selection = strokes.filter((_, i) => selected.has(i))
  const box = boxOf(selection)
  const whole = boxOf(strokes)

  const corners = (b: Box): [number, number][] => [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x + b.width, b.y + b.height],
    [b.x, b.y + b.height],
  ]

  const down = (ev: React.PointerEvent): void => {
    if (ev.button !== 0) return
    ev.stopPropagation()
    const f = toFlow(ev.clientX, ev.clientY)
    const p: Pt = [f.x, f.y, 0.5]
    if (box !== null) {
      const handle = corners(box).findIndex(([cx, cy]) => Math.abs(cx - p[0]) <= HANDLE_PX / zoom && Math.abs(cy - p[1]) <= HANDLE_PX / zoom)
      if (handle !== -1) {
        const anchor = corners(box)[(handle + 2) % 4]!
        setDrag({ kind: 'resize', corner: handle, anchor, box, before: strokes })
        return
      }
    }
    const hit = pick(p)
    if (hit !== null) {
      const next = ev.shiftKey ? new Set(selected) : selected.has(hit) ? new Set(selected) : new Set<number>()
      if (ev.shiftKey && next.has(hit)) next.delete(hit)
      else next.add(hit)
      setSelected(next)
      if (next.has(hit)) setDrag({ kind: 'move', from: p, before: strokes })
      return
    }
    if (box !== null && p[0] >= box.x && p[0] <= box.x + box.width && p[1] >= box.y && p[1] <= box.y + box.height) {
      setDrag({ kind: 'move', from: p, before: strokes })
      return
    }
    setDrag({ kind: 'marquee', from: p, to: p })
  }

  useEffect(() => {
    if (drag === null) return
    const move = (ev: PointerEvent): void => {
      const f = toFlow(ev.clientX, ev.clientY)
      if (drag.kind === 'marquee') return setDrag({ ...drag, to: [f.x, f.y, 0.5] })
      if (drag.kind === 'move') {
        const dx = f.x - drag.from[0]
        const dy = f.y - drag.from[1]
        setStrokes(drag.before.map((s, i) => (selected.has(i) ? moved(s, dx, dy) : s)))
        return
      }
      const [ax, ay] = drag.anchor
      const [cx, cy] = corners(drag.box)[drag.corner]!
      const sx = Math.abs(cx - ax) < 1 ? 1 : (f.x - ax) / (cx - ax)
      const sy = Math.abs(cy - ay) < 1 ? 1 : (f.y - ay) / (cy - ay)
      // ⇧ keeps its proportions.
      const [ux, uy] = ev.shiftKey ? [Math.max(sx, sy), Math.max(sx, sy)] : [sx, sy]
      setStrokes(drag.before.map((s, i) => (selected.has(i) ? scaled(s, ax, ay, ux, uy) : s)))
    }
    const up = (): void => {
      if (drag.kind === 'marquee') {
        const [x0, x1] = [Math.min(drag.from[0], drag.to[0]), Math.max(drag.from[0], drag.to[0])]
        const [y0, y1] = [Math.min(drag.from[1], drag.to[1]), Math.max(drag.from[1], drag.to[1])]
        setSelected(new Set(strokes.flatMap((s, i) => (s.points.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1) ? [i] : []))))
      } else
        setStrokes((now) => {
          if (now !== drag.before) commit(drag.before, now)
          return now
        })
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  })

  const remove = (): void => {
    if (selected.size === 0) return
    commit(
      strokes,
      strokes.filter((_, i) => !selected.has(i)),
    )
    setSelected(new Set())
  }
  const recolor = (color: string | null): void => commit(strokes, strokes.map((s, i) => (selected.has(i) ? { ...s, color } : s)))
  const step = (from: React.RefObject<Stroke[][]>, to: React.RefObject<Stroke[][]>): void => {
    const back = from.current.pop()
    if (back === undefined) return
    to.current.push(strokes)
    setStrokes(back)
    setSelected(new Set())
    onChange(back)
  }

  useEffect(() => {
    const key = (ev: KeyboardEvent): void => {
      // Typed somewhere else - the chat, Quick ask, a rename - is not for the
      // drawing: ⌘A and Backspace in the chat box deleted every stroke.
      const target = ev.target as HTMLElement | null
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (ev.key === 'Escape') onClose()
      else if (ev.key === 'Backspace' || ev.key === 'Delete') remove()
      else if (ev.metaKey && ev.key.toLowerCase() === 'z') step(ev.shiftKey ? redos : undos, ev.shiftKey ? undos : redos)
      else if (ev.metaKey && ev.key.toLowerCase() === 'a') setSelected(new Set(strokes.map((_, i) => i)))
      else return
      ev.preventDefault()
      ev.stopPropagation()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  })

  const room = ROOM_PX / zoom
  const area = whole ?? { x: 0, y: 0, width: 0, height: 0 }
  const marquee = drag?.kind === 'marquee' ? drag : null
  // The bar over what is selected (or over the drawing), on the screen.
  const over = box ?? whole
  const bar = over === null ? null : { left: tx + (over.x + over.width / 2) * zoom, top: ty + over.y * zoom - 52 }
  const ordered = strokes.map((s, i) => ({ s, i })).sort((a, b) => Number(b.s.kind === 'highlighter') - Number(a.s.kind === 'highlighter'))

  return (
    <div className="drawing-editor" onPointerDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <svg className="drawing-editor__plane" aria-label="Drawing strokes">
        <g transform={`translate(${tx} ${ty}) scale(${zoom})`}>
          <rect
            className="drawing-editor__room"
            x={area.x - room}
            y={area.y - room}
            width={area.width + room * 2}
            height={area.height + room * 2}
            onPointerDown={down}
          />
          {ordered.map(({ s, i }) => (
            <path
              key={i}
              d={strokePath(s)}
              fill={s.color ?? 'currentColor'}
              fillOpacity={s.kind === 'highlighter' ? HIGHLIGHT_OPACITY : 1}
              className={`drawing-editor__stroke${selected.has(i) ? ' is-selected' : ''}`}
              onPointerDown={down}
            />
          ))}
          {box !== null && (
            <>
              <rect className="drawing-editor__box" x={box.x} y={box.y} width={box.width} height={box.height} strokeWidth={1 / zoom} onPointerDown={down} />
              {corners(box).map(([cx, cy], i) => (
                <rect
                  key={i}
                  className="drawing-editor__handle"
                  x={cx - HANDLE_PX / 2 / zoom}
                  y={cy - HANDLE_PX / 2 / zoom}
                  width={HANDLE_PX / zoom}
                  height={HANDLE_PX / zoom}
                  strokeWidth={1 / zoom}
                  onPointerDown={down}
                />
              ))}
            </>
          )}
          {marquee !== null && (
            <rect
              className="drawing-editor__marquee"
              x={Math.min(marquee.from[0], marquee.to[0])}
              y={Math.min(marquee.from[1], marquee.to[1])}
              width={Math.abs(marquee.to[0] - marquee.from[0])}
              height={Math.abs(marquee.to[1] - marquee.from[1])}
              strokeWidth={1 / zoom}
            />
          )}
        </g>
      </svg>
      {bar !== null && (
        <div className="canvas-pen drawing-editor__bar glass-surface" role="toolbar" aria-label="Drawing" style={{ left: bar.left, top: bar.top }}>
          {selected.size > 0 && (
            <>
              {PEN_COLORS.map((color) => (
                <button
                  key={color ?? 'ink'}
                  aria-label={color ?? 'Ink'}
                  className="menu__swatch"
                  style={{ '--swatch': color ?? 'var(--text-primary)' } as React.CSSProperties}
                  onClick={() => recolor(color)}
                />
              ))}
              <Tip label="Delete" hint="⌫" placement="top">
                <button className="canvas-style__button" aria-label="Delete strokes" onClick={remove}>
                  <Icon name="trash" size={15} />
                </button>
              </Tip>
              <span className="canvas-style__gap" />
            </>
          )}
          <Tip label="Draw here" hint="Strokes drawn now go into this drawing" placement="top">
            <button className="canvas-style__button" aria-label="Draw here" onClick={onDrawHere}>
              <Icon name="pen-line" size={15} />
            </button>
          </Tip>
          <Tip label="Done" hint="Esc" placement="top">
            <button className="canvas-style__button" aria-label="Done" onClick={onClose}>
              <Icon name="check" size={15} />
            </button>
          </Tip>
        </div>
      )}
    </div>
  )
}
