import { useCallback, useEffect, useRef } from 'react'
import { Icon } from './Icon'
import { Tip } from './Tip'

/**
 * A floating panel over the workspace: draggable by its header, resizable from
 * its corner, and maximisable.
 *
 * Absolutely positioned over the content area rather than docked beside it, so
 * it takes no layout space at all - it physically cannot reshape your splits or
 * push the editor around, which was the requirement.
 *
 * Geometry is clamped to the viewport on every move and on window resize: a
 * panel dragged off-screen, or left off-screen after the window shrinks, is
 * unreachable with no way back.
 */

export type WindowGeometry = {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

export const MIN_WIDTH = 280
export const MIN_HEIGHT = 220

/** Keep at least this much of the header on screen, so it stays grabbable. */
const KEEP_VISIBLE = 64

export function clampGeometry(geometry: WindowGeometry, bounds: { width: number; height: number }): WindowGeometry {
  const width = Math.max(MIN_WIDTH, Math.min(geometry.width, Math.max(MIN_WIDTH, bounds.width)))
  const height = Math.max(MIN_HEIGHT, Math.min(geometry.height, Math.max(MIN_HEIGHT, bounds.height)))
  return {
    ...geometry,
    width,
    height,
    x: Math.max(KEEP_VISIBLE - width, Math.min(geometry.x, bounds.width - KEEP_VISIBLE)),
    y: Math.max(0, Math.min(geometry.y, Math.max(0, bounds.height - 32))),
  }
}

type Props = {
  title: string
  geometry: WindowGeometry
  onChange: (next: WindowGeometry) => void
  onClose: () => void
  closeHint?: string
  children?: React.ReactNode
}

export function FloatingWindow({
  title,
  geometry,
  onChange,
  onClose,
  closeHint,
  children,
}: Props): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)

  /** The area the panel floats over; its offsetParent. */
  const bounds = useCallback((): { width: number; height: number } => {
    const parent = ref.current?.offsetParent as HTMLElement | null
    return { width: parent?.clientWidth ?? window.innerWidth, height: parent?.clientHeight ?? window.innerHeight }
  }, [])

  /**
   * The panel must be positioned against a real container, not the viewport.
   *
   * When it wasn't, a maximised panel covered the entire window - its header
   * landing on the macOS traffic lights, and its close button inside the
   * titlebar's drag region, where clicks never arrive. Silent, and only visible
   * in a screenshot; so it complains now instead.
   */
  useEffect(() => {
    const parent = ref.current?.offsetParent
    if (parent === null || parent === document.body) {
      console.error(
        '[FloatingWindow] no positioned ancestor: the panel will be placed against the viewport ' +
          'and can cover the titlebar, where a drag region swallows its clicks. Give its ' +
          'container `position: relative`.',
      )
    }
  }, [])

  // A panel left off-screen after the window shrinks would be unrecoverable.
  useEffect(() => {
    const onResize = (): void => {
      const clamped = clampGeometry(geometry, bounds())
      if (clamped.x !== geometry.x || clamped.y !== geometry.y || clamped.width !== geometry.width || clamped.height !== geometry.height) {
        onChange(clamped)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [geometry, onChange, bounds])

  const startDrag = useCallback(
    (ev: React.PointerEvent) => {
      if (geometry.maximized) return
      ev.preventDefault()
      const startX = ev.clientX
      const startY = ev.clientY
      const origin = { x: geometry.x, y: geometry.y }

      const onMove = (move: PointerEvent): void => {
        onChange(
          clampGeometry(
            { ...geometry, x: origin.x + move.clientX - startX, y: origin.y + move.clientY - startY },
            bounds(),
          ),
        )
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
    [geometry, onChange, bounds],
  )

  const startResize = useCallback(
    (ev: React.PointerEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      const startX = ev.clientX
      const startY = ev.clientY
      const origin = { width: geometry.width, height: geometry.height }

      const onMove = (move: PointerEvent): void => {
        onChange(
          clampGeometry(
            {
              ...geometry,
              maximized: false,
              width: origin.width + move.clientX - startX,
              height: origin.height + move.clientY - startY,
            },
            bounds(),
          ),
        )
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
    [geometry, onChange, bounds],
  )

  const style: React.CSSProperties = geometry.maximized
    ? { inset: 8 }
    : { left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height }

  return (
    <div
      ref={ref}
      className={`float${geometry.maximized ? ' is-maximized' : ''}`}
      style={style}
      role="dialog"
      aria-label={title}
    >
      <header className="float__head" onPointerDown={startDrag} onDoubleClick={() => onChange({ ...geometry, maximized: !geometry.maximized })}>
        <h2 className="float__title">{title}</h2>
        <div className="float__actions">
          <Tip label={geometry.maximized ? 'Restore' : 'Expand to full size'} hint="Or double-click the title">
            <button
              className="icon-btn"
              onClick={() => onChange({ ...geometry, maximized: !geometry.maximized })}
              aria-label={geometry.maximized ? 'Restore' : 'Expand to full size'}
            >
              <Icon name={geometry.maximized ? 'minimize' : 'maximize'} size={14} />
            </button>
          </Tip>
          <Tip label={closeHint ?? 'Close'}>
            <button className="icon-btn" onClick={onClose} aria-label={closeHint ?? 'Close'}>
              <Icon name="x" size={15} />
            </button>
          </Tip>
        </div>
      </header>

      <div className="float__body">{children}</div>

      {!geometry.maximized && (
        <div className="float__resize" onPointerDown={startResize} aria-hidden="true" />
      )}
    </div>
  )
}
