import { useEffect, useRef, useState } from 'react'
import { NoteReader } from '../../features/editor'
import { Icon } from '../../ui/Icon'
import { Tip } from '../../ui/Tip'
import { commands } from '../commands'
import { formatChord } from '../hotkeys'
import { beginPaneDrag } from '../pane-drag'
import {
  bringToFront,
  clampInside,
  closeNoteWindow,
  placeNoteWindow,
  resizeFrom,
  topmost,
  type Bounds,
  type Edges,
  type NoteWindowState,
} from '../note-windows'

/**
 * Pinned notes, floating over the workspace: read-only, several at once.
 *
 * Positioned inside the workspace area (`.shell__content`), which clips them
 * and is the bound they are kept inside. Clicking a window raises it; ⌘Esc
 * closes the one you are in, or the one on top. Dragged by the header they
 * move; with ⌥ held, the drag is a pane drag instead, and dropping on a pane
 * turns the window into a tab or a split there.
 */

/** How long a window takes to leave; it is removed once it has. */
const CLOSE_MS = 180
const CLOSE_HOTKEY = 'Mod+Escape'

const EDGES: readonly { name: string; edges: Edges }[] = [
  { name: 'n', edges: { top: true } },
  { name: 's', edges: { bottom: true } },
  { name: 'e', edges: { right: true } },
  { name: 'w', edges: { left: true } },
  { name: 'ne', edges: { top: true, right: true } },
  { name: 'nw', edges: { top: true, left: true } },
  { name: 'se', edges: { bottom: true, right: true } },
  { name: 'sw', edges: { bottom: true, left: true } },
]

const titleOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

type Props = {
  windows: readonly NoteWindowState[]
  setWindows: (update: (prev: NoteWindowState[]) => NoteWindowState[]) => void
  /** The workspace area the windows float in. */
  area: React.RefObject<HTMLElement | null>
  onOpenInEditor: (path: string) => void
  onOpenLink: (target: string, heading: string | null) => void
}

export function NoteWindows({ windows, setWindows, area, onOpenInEditor, onOpenLink }: Props): React.ReactElement {
  const [closing, setClosing] = useState<ReadonlySet<string>>(new Set())
  const bounds = (): Bounds => ({
    width: area.current?.clientWidth ?? window.innerWidth,
    height: area.current?.clientHeight ?? window.innerHeight,
  })

  const close = (id: string): void => {
    setClosing((prev) => new Set(prev).add(id))
    window.setTimeout(() => {
      setWindows((prev) => closeNoteWindow(prev, id))
      setClosing((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, CLOSE_MS)
  }

  // ⌘Esc: the window you are in, or the one on top.
  const current = useRef({ windows, close })
  current.current = { windows, close }
  useEffect(
    () =>
      commands.register({
        id: 'window:close-note-window',
        name: 'Close note window',
        section: 'Workspace',
        hotkey: CLOSE_HOTKEY,
        isAvailable: () => current.current.windows.length > 0,
        run: () => {
          const { windows: open, close: shut } = current.current
          const inside = document.activeElement?.closest<HTMLElement>('[data-note-window]')?.dataset['noteWindow']
          const target = open.find((w) => w.id === inside) ?? topmost(open)
          if (target !== null) shut(target.id)
        },
      }),
    [],
  )

  // The workspace shrinking must not strand a window outside it.
  useEffect(() => {
    const element = area.current
    if (element === null) return
    const observer = new ResizeObserver(() => {
      const b = bounds()
      setWindows((prev) => {
        const next = prev.map((w) => clampInside(w, b))
        return next.some((w, i) => w !== prev[i] && JSON.stringify(w) !== JSON.stringify(prev[i])) ? next : prev
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
    // Bounds are read when the observer fires, not captured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, setWindows])

  /** Follow the pointer from a press, with `apply` given how far it has come. */
  const track = (event: React.PointerEvent, apply: (dx: number, dy: number) => void): void => {
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const onMove = (move: PointerEvent): void => apply(move.clientX - startX, move.clientY - startY)
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('is-resizing')
    }
    document.body.classList.add('is-resizing')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <>
      {windows.map((w, index) => (
        <section
          key={w.id}
          className={`note-window glass-surface${closing.has(w.id) ? ' is-closing' : ''}`}
          data-note-window={w.id}
          role="dialog"
          aria-label={titleOf(w.path)}
          style={{ left: w.x, top: w.y, width: w.width, height: w.height, zIndex: 30 + index }}
          onPointerDownCapture={() => {
            if (topmost(windows)?.id !== w.id) setWindows((prev) => bringToFront(prev, w.id))
          }}
        >
          <header
            className="note-window__head"
            title="Drag to move · hold ⌥ to drop it into a pane"
            onPointerDown={(event) => {
              if (event.button !== 0 || (event.target as HTMLElement).closest('button') !== null) return
              if (event.altKey) {
                event.preventDefault()
                beginPaneDrag({ kind: 'window', windowId: w.id, path: w.path }, titleOf(w.path), event.clientX, event.clientY)
                return
              }
              const start = { ...w }
              track(event, (dx, dy) =>
                setWindows((prev) => placeNoteWindow(prev, w.id, { ...start, x: start.x + dx, y: start.y + dy }, bounds())),
              )
            }}
          >
            <h2 className="note-window__title">{titleOf(w.path)}</h2>
            <button className="note-window__open" onClick={() => onOpenInEditor(w.path)}>
              Open in editor
            </button>
            <Tip label="Close" hint={formatChord(commands.bindingFor('window:close-note-window') ?? CLOSE_HOTKEY)}>
              <button className="icon-btn note-window__close" aria-label="Close" onClick={() => close(w.id)}>
                <Icon name="x" size={15} />
              </button>
            </Tip>
          </header>
          <div className="note-window__body">
            <NoteReader path={w.path} onOpenLink={onOpenLink} />
          </div>
          {EDGES.map(({ name, edges }) => (
            <div
              key={name}
              className={`note-window__edge note-window__edge--${name}`}
              aria-hidden="true"
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                const start = { ...w }
                track(event, (dx, dy) =>
                  setWindows((prev) => prev.map((item) => (item.id === w.id ? resizeFrom(start, edges, dx, dy, bounds()) : item))),
                )
              }}
            />
          ))}
        </section>
      ))}
    </>
  )
}
