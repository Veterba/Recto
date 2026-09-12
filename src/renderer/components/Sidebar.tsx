import { useCallback, useRef } from 'react'
import type { Section } from '../core/sections'

/**
 * The contextual panel next to the rail. Its width is dragged, clamped, and
 * persisted by the shell - this component only renders.
 */
type Props = {
  section: Section
  width: number
  onResize: (width: number) => void
  /** Buttons in the panel header, e.g. "new note". */
  actions?: React.ReactNode
  children?: React.ReactNode
}

export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 520

export function Sidebar({ section, width, onResize, actions, children }: Props): React.ReactElement {
  const ref = useRef<HTMLElement | null>(null)

  const startDrag = useCallback(
    (ev: React.PointerEvent) => {
      ev.preventDefault()
      const startX = ev.clientX
      const startWidth = width

      const onMove = (move: PointerEvent): void => {
        const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + move.clientX - startX))
        onResize(next)
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.classList.remove('is-resizing')
      }
      document.body.classList.add('is-resizing')
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [width, onResize],
  )

  return (
    <aside ref={ref} className="sidebar" style={{ width }} aria-label={`${section.label} panel`}>
      <header className="sidebar__head">
        <h2 className="sidebar__title">{section.label}</h2>
        {actions}
      </header>
      <div className="sidebar__body">{children ?? <SidebarPlaceholder section={section} />}</div>
      <div
        className="sidebar__resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={startDrag}
      />
    </aside>
  )
}

const PLACEHOLDER: Record<string, string> = {
  chat: 'Conversation list. Each one is a markdown file in the vault.',
  board: 'Your boards. Each card is a real note.',
}

function SidebarPlaceholder({ section }: { section: Section }): React.ReactElement {
  return <p className="sidebar__empty">{PLACEHOLDER[section.id] ?? 'Nothing here yet.'}</p>
}
