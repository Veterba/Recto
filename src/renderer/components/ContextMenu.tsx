import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

/**
 * A right-click menu.
 *
 * Rendered in a portal at the document root rather than inside the row that
 * opened it, for one unavoidable reason: the file tree is a virtualised,
 * `overflow: auto` container, so a menu nested inside a row gets clipped by the
 * scroller the moment it is taller than the remaining space.
 *
 * Positioning is measured, not guessed - the menu is placed, then nudged back
 * on screen if it would hang off an edge. A menu you opened at the bottom of
 * the sidebar is otherwise half off the window.
 */

export type MenuItem =
  | { kind: 'separator' }
  | { kind: 'heading'; label: string }
  | {
      kind: 'item'
      label: string
      icon?: string
      /** Shown right-aligned, for discoverability. Not wired up here. */
      shortcut?: string
      danger?: boolean
      disabled?: boolean
      run: () => void
    }

export type MenuPosition = { x: number; y: number }

type Props = {
  items: readonly MenuItem[]
  at: MenuPosition
  onClose: () => void
}

/** Keeps the menu inside the window without it appearing to jump. */
const MARGIN = 8

export function ContextMenu({ items, at, onClose }: Props): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<MenuPosition>(at)

  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const rect = element.getBoundingClientRect()
    const x = Math.min(at.x, window.innerWidth - rect.width - MARGIN)
    // Flip above the cursor rather than merely clamping: a menu that overlaps
    // the point you clicked swallows the next click.
    const y = at.y + rect.height > window.innerHeight - MARGIN ? at.y - rect.height : at.y
    setPosition({ x: Math.max(MARGIN, x), y: Math.max(MARGIN, y) })
  }, [at, items])

  useEffect(() => {
    const close = (): void => onClose()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    // `capture` so the menu closes before whatever was clicked reacts to it.
    window.addEventListener('mousedown', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div
      className="menu"
      ref={ref}
      role="menu"
      style={{ left: position.x, top: position.y }}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.kind === 'separator') return <hr className="menu__sep" key={`sep-${index}`} />
        if (item.kind === 'heading') {
          return (
            <p className="menu__heading" key={`head-${index}`}>
              {item.label}
            </p>
          )
        }
        return (
          <button
            className={`menu__item${item.danger === true ? ' is-danger' : ''}`}
            key={item.label}
            role="menuitem"
            disabled={item.disabled === true}
            onClick={() => {
              onClose()
              item.run()
            }}
          >
            <span className="menu__icon">{item.icon !== undefined && <Icon name={item.icon} size={14} />}</span>
            <span className="menu__label">{item.label}</span>
            {item.shortcut !== undefined && <span className="menu__shortcut">{item.shortcut}</span>}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}

/**
 * Menu state for one component.
 *
 * Bundled as a hook because every caller needs the same three things: where the
 * menu is, what it is about, and a handler to put on the element.
 */
export function useContextMenu<T>(): {
  menu: { at: MenuPosition; subject: T } | null
  open: (event: React.MouseEvent, subject: T) => void
  close: () => void
} {
  const [menu, setMenu] = useState<{ at: MenuPosition; subject: T } | null>(null)

  return {
    menu,
    open: (event, subject) => {
      event.preventDefault()
      event.stopPropagation()
      setMenu({ at: { x: event.clientX, y: event.clientY }, subject })
    },
    close: () => setMenu(null),
  }
}
