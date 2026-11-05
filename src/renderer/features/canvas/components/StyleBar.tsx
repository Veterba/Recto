import { useEffect, useRef, useState } from 'react'
import { edgeEnds, isPresetColor, type CanvasDoc, type CanvasEdge, type CanvasNode } from '@shared/canvas'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { bendOf, isPointNode } from '../arrow-geometry'
import { setBend } from '../canvas-arrows'
import type { CanvasChange } from '../canvas-change'
import { recolor } from '../canvas-edit'
import { SWATCHES } from '../canvas-menus'
import { common, EDGE_OPTIONS, LABEL_OPTIONS, NODE_OPTIONS, restyle, setHead, type Option, type StyleKey } from '../canvas-style'
import { shapeOf } from '../shapes'

/**
 * The style bar: over whatever is selected, as in Heptabase or Freeform - the
 * sides of the window are the sidebar's and the AI panel's. It shows what the
 * selection can change: colour for anything; fill, border, text size and
 * alignment for text and shapes; line, width and arrowheads for arrows.
 */

type Props = {
  doc: CanvasDoc
  selected: ReadonlySet<string>
  /** The canvas's pan and zoom: [x, y, zoom]. */
  transform: readonly [number, number, number]
  run: (change: CanvasChange) => void
}

/** How far above the selection the bar floats, on screen. */
const GAP = 12
const BAR_HEIGHT = 40
/** The room a choice's row needs above the bar to open upward. */
const POP_ROOM = 56

function Choice({
  label,
  icon,
  options,
  current,
  onPick,
  open,
  setOpen,
}: {
  label: string
  icon: string
  options: readonly Option[]
  current: string | undefined | null
  onPick: (value: string | undefined) => void
  open: boolean
  setOpen: (open: boolean) => void
}): React.ReactElement {
  return (
    <div className="canvas-style__group">
      <Tip label={label} placement="top">
        <button className={`canvas-style__button${open ? ' is-open' : ''}`} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={icon} size={15} />
        </button>
      </Tip>
      {open && (
        <div className="canvas-style__pop glass-surface" role="menu" aria-label={label}>
          {options.map((o) => (
            <button
              key={o.label}
              role="menuitemradio"
              aria-checked={o.value === current}
              className={`canvas-style__option${o.value === current ? ' is-current' : ''}`}
              onClick={() => {
                onPick(o.value)
                setOpen(false)
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function StyleBar({ doc, selected, transform, run }: Props): React.ReactElement | null {
  const [open, setOpen] = useState<string | null>(null)
  const bar = useRef<HTMLDivElement | null>(null)
  const nodes = doc.nodes.filter((n) => selected.has(n.id) && !isPointNode(n))
  const edges = doc.edges.filter((e) => selected.has(e.id))

  // A click elsewhere shuts an open choice.
  useEffect(() => {
    if (open === null) return
    const shut = (ev: PointerEvent): void => {
      if (bar.current?.contains(ev.target as Node) !== true) setOpen(null)
    }
    window.addEventListener('pointerdown', shut, true)
    return () => window.removeEventListener('pointerdown', shut, true)
  }, [open])
  // A new selection starts with nothing open.
  useEffect(() => setOpen(null), [selected])

  if (nodes.length === 0 && edges.length === 0) return null

  // Over the middle of what is selected: its nodes, or the nodes its arrows join.
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const boxes: CanvasNode[] = nodes.length > 0 ? nodes : edges.flatMap((e) => [byId.get(e.fromNode), byId.get(e.toNode)]).filter((n) => n !== undefined)
  if (boxes.length === 0) return null
  const [tx, ty, zoom] = transform
  const left = Math.min(...boxes.map((n) => n.x)) * zoom + tx
  const right = Math.max(...boxes.map((n) => n.x + n.width)) * zoom + tx
  const top = Math.min(...boxes.map((n) => n.y)) * zoom + ty
  const bottom = Math.max(...boxes.map((n) => n.y + n.height)) * zoom + ty
  // Below the selection when there is no room above it.
  const above = top - GAP - BAR_HEIGHT > 8
  const y = above ? top - GAP - BAR_HEIGHT : bottom + GAP
  // A choice opens away from the selection - up from a bar above it - but only where there is room for it.
  const opensUp = above && y > POP_ROOM

  const ids = new Set([...nodes.map((n) => n.id), ...edges.map((e) => e.id)])
  const items: (CanvasNode | CanvasEdge)[] = [...nodes, ...edges]
  const colors = new Set(items.map((i) => i.color ?? null))
  const color = colors.size === 1 ? [...colors][0]! : undefined
  const texts = nodes.filter((n) => n.type === 'text')
  // Shapes whose text is outside them: everything but the square.
  const labelled = nodes.filter((n) => {
    const shape = shapeOf(n)
    return shape !== null && shape !== 'rectangle'
  })
  const choice = (key: StyleKey, label: string, icon: string, options: readonly Option[], of: readonly (CanvasNode | CanvasEdge)[]): React.ReactElement => (
    <Choice
      key={key}
      label={label}
      icon={icon}
      options={options}
      current={common(of, key)}
      onPick={(value) => run(restyle(new Set(of.map((i) => i.id)), key, value))}
      open={open === key}
      setOpen={(o) => setOpen(o ? key : null)}
    />
  )
  const heads = edges.map(edgeEnds)
  const allHave = (end: 'from' | 'to'): boolean => heads.length > 0 && heads.every((h) => h[end] === 'arrow')
  const bent = edges.some((e) => bendOf(e) !== 0)

  return (
    <div
      ref={bar}
      // Its choices open away from the selection, never over it.
      className={`canvas-style glass-surface nodrag nopan${opensUp ? ' is-above' : ''}`}
      role="toolbar"
      aria-label="Style"
      style={{ left: (left + right) / 2, top: y }}
      onPointerDown={(ev) => ev.stopPropagation()}
    >
      <div className="canvas-style__group">
        <Tip label="Colour" placement="top">
          <button
            className={`canvas-style__button${open === 'color' ? ' is-open' : ''}`}
            aria-label="Colour"
            aria-expanded={open === 'color'}
            onClick={() => setOpen(open === 'color' ? null : 'color')}
          >
            <span
              className={`canvas-style__dot${color === null || color === undefined ? ' is-none' : ''}`}
              style={{ '--swatch': color == null ? 'transparent' : isPresetColor(color) ? `var(--canvas-${color})` : color } as React.CSSProperties}
            />
          </button>
        </Tip>
        {open === 'color' && (
          <div className="canvas-style__pop canvas-style__colors glass-surface" role="menu" aria-label="Colour">
            {SWATCHES.map((c) => (
              <button
                key={c.name}
                aria-label={c.name}
                className={`menu__swatch${c.value === color ? ' is-current' : ''}${c.value === null ? ' is-none' : ''}`}
                style={{ '--swatch': c.css } as React.CSSProperties}
                onClick={() => {
                  run(recolor(ids, c.value))
                  setOpen(null)
                }}
              />
            ))}
            <label className="canvas-style__custom" aria-label="Any colour">
              <Icon name="palette" size={14} />
              <input
                type="color"
                value={color != null && !isPresetColor(color) ? color : '#888888'}
                onChange={(ev) => run(recolor(ids, ev.target.value))}
              />
            </label>
          </div>
        )}
      </div>
      {nodes.length > 0 && (
        <>
          <span className="canvas-style__gap" />
          {choice('fill', 'Fill', 'paint-bucket', NODE_OPTIONS.fill, nodes)}
          {choice('border', 'Border', 'square-dashed', NODE_OPTIONS.border, nodes)}
        </>
      )}
      {texts.length > 0 && texts.length === nodes.length && (
        <>
          {choice('fontSize', 'Text size', 'type', NODE_OPTIONS.fontSize, texts)}
          {choice('textAlign', 'Align text', 'text-align-start', NODE_OPTIONS.textAlign, texts)}
        </>
      )}
      {labelled.length > 0 && labelled.length === nodes.length && choice('labelAt', 'Text position', 'arrow-down', LABEL_OPTIONS, labelled)}
      {edges.length > 0 && nodes.length === 0 && (
        <>
          <span className="canvas-style__gap" />
          {choice('path', 'Line', 'minus', EDGE_OPTIONS.path, edges)}
          {choice('width', 'Thickness', 'spline', EDGE_OPTIONS.width, edges)}
          <Tip label="Arrowhead at the start" placement="top">
            <button
              className={`canvas-style__button${allHave('from') ? ' is-on' : ''}`}
              aria-label="Arrowhead at the start"
              aria-pressed={allHave('from')}
              onClick={() => run(setHead(ids, 'from', !allHave('from')))}
            >
              <Icon name="arrow-left" size={15} />
            </button>
          </Tip>
          <Tip label="Arrowhead at the end" placement="top">
            <button
              className={`canvas-style__button${allHave('to') ? ' is-on' : ''}`}
              aria-label="Arrowhead at the end"
              aria-pressed={allHave('to')}
              onClick={() => run(setHead(ids, 'to', !allHave('to')))}
            >
              <Icon name="arrow-right" size={15} />
            </button>
          </Tip>
          {bent && (
            <Tip label="Straighten" placement="top">
              <button
                className="canvas-style__button"
                aria-label="Straighten"
                onClick={() => run((d) => edges.reduce((acc, e) => setBend(acc, e.id, 0), d))}
              >
                <Icon name="move-up-right" size={15} />
              </button>
            </Tip>
          )}
        </>
      )}
    </div>
  )
}
