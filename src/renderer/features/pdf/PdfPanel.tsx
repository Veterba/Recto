import { useSyncExternalStore } from 'react'
import { IPC } from '@shared/ipc'
import { api } from '../../app/api'
import { Icon } from '../../ui/Icon'
import { PdfView } from './PdfView'

/**
 * The PDF panel: a PDF read and highlighted in a panel docked on the window's
 * right, as the AI panel is - full height, its own width (dragged by its left
 * edge, kept), closed with ✕. A canvas opens it with a double-click on a PDF;
 * whatever is in the middle stays where it was.
 */

let open: string | null = null
const listeners = new Set<() => void>()
const tell = (): void => {
  for (const l of listeners) l()
}
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Show a PDF in the panel (replacing the one shown), or null to close it. */
export function showPdf(path: string | null): void {
  if (open === path) return
  open = path
  tell()
}

/** The PDF the panel shows, if it is open. */
export const useShownPdf = (): string | null => useSyncExternalStore(subscribe, () => open)

const WIDTH_KEY = 'recto.pdf-panel-width'
const MIN_WIDTH = 360
const MAX_WIDTH = 1200
const DEFAULT_WIDTH = 560

/** The width last dragged to: a convenience of this Mac's, so the browser's storage, and fine to lose. */
function savedWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(n) && n >= MIN_WIDTH ? Math.min(MAX_WIDTH, n) : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

let width = savedWidth()
const widthListeners = new Set<() => void>()
const subscribeWidth = (l: () => void): (() => void) => {
  widthListeners.add(l)
  return () => widthListeners.delete(l)
}

export function PdfPanel({ path }: { path: string }): React.ReactElement {
  const shownWidth = useSyncExternalStore(subscribeWidth, () => width)

  /** Its left edge, dragged: wider to the left, at most half the window. */
  const startDrag = (ev: React.PointerEvent): void => {
    ev.preventDefault()
    const startX = ev.clientX
    const start = width
    const onMove = (move: PointerEvent): void => {
      const room = Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.6))
      width = Math.min(MAX_WIDTH, room, Math.max(MIN_WIDTH, start - (move.clientX - startX)))
      for (const l of widthListeners) l()
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('is-resizing')
      try {
        localStorage.setItem(WIDTH_KEY, String(width))
      } catch {
        // Not kept: next time it opens at its usual width.
      }
    }
    document.body.classList.add('is-resizing')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const name = path.slice(path.lastIndexOf('/') + 1)
  return (
    <aside className="pdf-panel" style={{ width: shownWidth }} aria-label={`PDF: ${name}`}>
      <div className="pdf-panel__resize" role="separator" aria-orientation="vertical" aria-label="Resize the PDF panel" onPointerDown={startDrag} />
      <header className="pdf-panel__head">
        <Icon name="file" size={14} />
        <span className="pdf-panel__name" title={path}>
          {name}
        </span>
        <button className="icon-btn" aria-label="Show in Finder" title="Show in Finder" onClick={() => void api.invoke(IPC.fsReveal, path)}>
          <Icon name="external-link" size={14} />
        </button>
        <button className="icon-btn" aria-label="Close the PDF" onClick={() => showPdf(null)}>
          <Icon name="x" size={15} />
        </button>
      </header>
      <PdfView key={path} path={path} mode="reader" />
    </aside>
  )
}
