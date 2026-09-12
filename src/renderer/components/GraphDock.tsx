import { useCallback } from 'react'
import { formatChord } from '../core/hotkeys'
import { Icon } from './Icon'

/**
 * The graph, docked to the right of whichever workspace you are in.
 *
 * It is a sibling of the workspace area, not a pane inside it, so opening it
 * cannot reshape your splits or steal a tab. Closing it returns the space
 * exactly as it was. "Open as tab" hands the same view to the normal workspace
 * when you want it full size.
 */

export const DOCK_MIN = 240
export const DOCK_MAX = 720

type Props = {
  width: number
  onResize: (width: number) => void
  onClose: () => void
  onOpenFull: () => void
  children?: React.ReactNode
}

export function GraphDock({ width, onResize, onClose, onOpenFull, children }: Props): React.ReactElement {
  const startDrag = useCallback(
    (ev: React.PointerEvent) => {
      ev.preventDefault()
      const startX = ev.clientX
      const startWidth = width

      const onMove = (move: PointerEvent): void => {
        // Dragging left widens: the handle is on the dock's left edge.
        onResize(Math.min(DOCK_MAX, Math.max(DOCK_MIN, startWidth - (move.clientX - startX))))
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
    <aside className="dock" style={{ width }} aria-label="Graph">
      <div
        className="dock__resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize graph"
        onPointerDown={startDrag}
      />
      <header className="dock__head">
        <h2 className="dock__title">Graph</h2>
        <div className="dock__actions">
          <button className="icon-btn" onClick={onOpenFull} title="Open as tab">
            <Icon name="maximize" size={14} />
          </button>
          <button className="icon-btn" onClick={onClose} title={`Close graph (${formatChord('Mod+G')})`}>
            <Icon name="panel-right-close" size={15} />
          </button>
        </div>
      </header>
      <div className="dock__body">{children}</div>
    </aside>
  )
}
