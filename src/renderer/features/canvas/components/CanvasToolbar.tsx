import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyFilter } from '../../../ui/fuzzy'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { figureOf, type Shape } from '../shapes'

/**
 * The bar at the bottom of a canvas: what a click on the plane does next, as
 * in Figma or tldraw. Select and Hand stay; a tool that puts something down
 * (an arrow, text, a shape, a frame) is used once, then it is Select again. Note and
 * Board ask which one; Media asks for files. The one shape is the square.
 */

export type Tool = 'select' | 'hand' | 'arrow' | 'draw' | 'eraser' | 'text' | 'card' | 'frame' | 'shape:rectangle'

/** Something the pickers list: a note (or card) or a board. */
export type PickItem = { path: string; name: string; folder: string }

/** The tools' keys, as in tldraw and Figma. */
export const TOOL_KEYS: Readonly<Record<string, Tool>> = {
  v: 'select',
  h: 'hand',
  a: 'arrow',
  p: 'draw',
  e: 'eraser',
  t: 'text',
  c: 'card',
  f: 'frame',
  r: 'shape:rectangle',
}

type Props = {
  tool: Tool
  setTool: (tool: Tool) => void
  notes: () => readonly PickItem[]
  boards: readonly PickItem[]
  /** A note, card or board picked, or a new note's name typed: put it on the canvas. */
  onPick: (path: string) => void
  onCreateNote: (name: string) => void
  onMedia: () => void
  /** The picker to open, from a key (N, B). */
  opening: 'note' | 'board' | null
  setOpening: (open: 'note' | 'board' | null) => void
}

/**
 * A shape's figure, small, for its button - drawn to lucide's measure, so it
 * sits with the other icons: a 24-unit box with the figure inside 2 units of
 * its edge, and their line (1.75 at 24).
 */
function ShapeIcon({ shape }: { shape: Shape }): React.ReactElement {
  const figure = figureOf(shape, 100, 100)
  return (
    <svg className="canvas-tools__shape" viewBox="-10 -10 120 120" width={17} height={17} aria-hidden="true">
      <path d={figure.outline} strokeWidth={8.75} />
      {figure.mark !== undefined && <path d={figure.mark} strokeWidth={8.75} />}
    </svg>
  )
}

function ToolButton({
  label,
  hint,
  active,
  onClick,
  children,
}: {
  label: string
  hint?: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.ReactElement {
  return (
    <Tip label={label} hint={hint} placement="top">
      <button className={`canvas-tools__tool${active === true ? ' is-active' : ''}`} aria-label={label} aria-pressed={active} onClick={onClick}>
        {children}
      </button>
    </Tip>
  )
}

const LIMIT = 50

/** Find a note or a board by name; for notes, "Create “…”" when none has it. */
function Picker({
  kind,
  items,
  onPick,
  onCreate,
  onClose,
}: {
  kind: 'note' | 'board'
  items: readonly PickItem[]
  onPick: (path: string) => void
  onCreate?: (name: string) => void
  onClose: () => void
}): React.ReactElement {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const typed = query.trim()
  const found = useMemo(
    () => (typed === '' ? items.slice(0, LIMIT) : fuzzyFilter(typed, items, (i) => i.name).map((m) => m.item).slice(0, LIMIT)),
    [items, typed],
  )
  const create = onCreate !== undefined && typed !== '' && !items.some((i) => i.name.toLowerCase() === typed.toLowerCase())
  const rows = (create ? 1 : 0) + found.length
  const choose = (index: number): void => {
    if (create && index === 0) onCreate(typed)
    else {
      const item = found[index - (create ? 1 : 0)]
      if (item !== undefined) onPick(item.path)
    }
  }
  return (
    <div className="canvas-tools__picker glass-surface" role="dialog" aria-label={kind === 'note' ? 'Add a note' : 'Add a board'}>
      <input
        className="canvas-bar__input"
        aria-label={kind === 'note' ? 'Find a note' : 'Find a board'}
        placeholder={kind === 'note' ? 'Find or make a note…' : 'Find a board…'}
        value={query}
        autoFocus
        onChange={(ev) => {
          setQuery(ev.target.value)
          setCursor(0)
        }}
        onKeyDown={(ev) => {
          ev.stopPropagation()
          if (ev.key === 'Escape') onClose()
          else if (ev.key === 'ArrowDown') setCursor((c) => Math.min(rows - 1, c + 1))
          else if (ev.key === 'ArrowUp') setCursor((c) => Math.max(0, c - 1))
          else if (ev.key === 'Enter') choose(cursor)
          else return
          ev.preventDefault()
        }}
      />
      <ul className="canvas-bar__list" role="listbox">
        {create && (
          <li>
            <button className={`canvas-bar__option${cursor === 0 ? ' is-cursor' : ''}`} onClick={() => choose(0)}>
              <Icon name="plus" size={14} />
              Create “{typed}”
            </button>
          </li>
        )}
        {found.map((item, i) => {
          const index = i + (create ? 1 : 0)
          return (
            <li key={item.path}>
              <button className={`canvas-bar__option${cursor === index ? ' is-cursor' : ''}`} onClick={() => choose(index)}>
                <Icon name={kind === 'note' ? 'file-text' : 'square-kanban'} size={14} />
                <span className="canvas-bar__folder-name">{item.name}</span>
                {item.folder !== '' && <span className="canvas-bar__hint">{item.folder}</span>}
              </button>
            </li>
          )
        })}
        {rows === 0 && <li className="canvas-bar__hint">{kind === 'note' ? 'No notes yet.' : 'No boards yet.'}</li>}
      </ul>
    </div>
  )
}

export function CanvasToolbar({ tool, setTool, notes, boards, onPick, onCreateNote, onMedia, opening, setOpening }: Props): React.ReactElement {
  const bar = useRef<HTMLDivElement | null>(null)
  const noteItems = useMemo(() => (opening === 'note' ? notes() : []), [opening, notes])

  // A click anywhere else shuts what is open.
  useEffect(() => {
    if (opening === null) return
    const shut = (ev: PointerEvent): void => {
      if (bar.current?.contains(ev.target as Node) === true) return
      setOpening(null)
    }
    window.addEventListener('pointerdown', shut, true)
    return () => window.removeEventListener('pointerdown', shut, true)
  }, [opening, setOpening])

  return (
    <div className="canvas-tools" ref={bar}>
      {opening !== null && (
        <Picker
          kind={opening}
          items={opening === 'note' ? noteItems : boards}
          onPick={(path) => {
            setOpening(null)
            onPick(path)
          }}
          {...(opening === 'note'
            ? {
                onCreate: (name: string) => {
                  setOpening(null)
                  onCreateNote(name)
                },
              }
            : {})}
          onClose={() => setOpening(null)}
        />
      )}
      <div className="canvas-tools__bar glass-surface" role="toolbar" aria-label="Canvas tools">
        <ToolButton label="Select" hint="V" active={tool === 'select'} onClick={() => setTool('select')}>
          <Icon name="mouse-pointer-2" size={17} />
        </ToolButton>
        <ToolButton label="Hand" hint="H, or hold Space" active={tool === 'hand'} onClick={() => setTool('hand')}>
          <Icon name="hand" size={17} />
        </ToolButton>
        <ToolButton label="Arrow" hint="A, drag from one thing to another" active={tool === 'arrow'} onClick={() => setTool('arrow')}>
          <Icon name="move-up-right" size={17} />
        </ToolButton>
        <span className="canvas-tools__gap" />
        <ToolButton label="Draw" hint="P - stays on until Esc; a drawing is an SVG you can draw on again" active={tool === 'draw'} onClick={() => setTool('draw')}>
          <Icon name="pen-line" size={17} />
        </ToolButton>
        <ToolButton label="Eraser" hint="E - takes away the strokes it touches" active={tool === 'eraser'} onClick={() => setTool('eraser')}>
          <Icon name="eraser" size={17} />
        </ToolButton>
        <span className="canvas-tools__gap" />
        <ToolButton label="Text" hint="T - words on the canvas, no card" active={tool === 'text'} onClick={() => setTool('text')}>
          <Icon name="type" size={17} />
        </ToolButton>
        <ToolButton label="Text card" hint="C, or double-click" active={tool === 'card'} onClick={() => setTool('card')}>
          <Icon name="sticky-note" size={17} />
        </ToolButton>
        <ToolButton label="Note" hint="N" active={opening === 'note'} onClick={() => setOpening(opening === 'note' ? null : 'note')}>
          <Icon name="file-text" size={17} />
        </ToolButton>
        <ToolButton label="Board" hint="B" active={opening === 'board'} onClick={() => setOpening(opening === 'board' ? null : 'board')}>
          <Icon name="square-kanban" size={17} />
        </ToolButton>
        <ToolButton label="Image, video or file" onClick={onMedia}>
          <Icon name="image" size={17} />
        </ToolButton>
        <span className="canvas-tools__gap" />
        <ToolButton label="Square" hint="R" active={tool === 'shape:rectangle'} onClick={() => setTool('shape:rectangle')}>
          <ShapeIcon shape="rectangle" />
        </ToolButton>
        <ToolButton label="Frame" hint="F" active={tool === 'frame'} onClick={() => setTool('frame')}>
          <Icon name="frame" size={17} />
        </ToolButton>
      </div>
    </div>
  )
}
