import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A tooltip that appears immediately.
 *
 * The browser's own `title` attribute waits roughly a second before showing
 * anything, cannot be styled, and on macOS renders in a system font that
 * belongs to no application. For a toolbar of unlabelled icons that delay is
 * the difference between a usable toolbar and a guessing game - which is
 * exactly the complaint this replaces.
 *
 * Portalled to the document body for the same reason as the context menu:
 * toolbars and sidebars are `overflow: hidden` scrollers, and a tooltip nested
 * inside one is clipped by it.
 */

const GAP = 6
const MARGIN = 6

export type TipPlacement = 'top' | 'bottom' | 'left' | 'right'

type Props = {
  /** The tooltip text. An empty string renders the child with no tooltip. */
  label: string
  /** Second line, smaller - for a shortcut or a one-line explanation. */
  hint?: string | undefined
  placement?: TipPlacement | undefined
  children: React.ReactElement
}

export function Tip({ label, hint, placement = 'bottom', children }: Props): React.ReactElement {
  const wrapper = useRef<HTMLSpanElement | null>(null)
  const bubble = useRef<HTMLDivElement | null>(null)
  const [shown, setShown] = useState(false)
  const [at, setAt] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!shown) return
    const anchor = wrapper.current?.firstElementChild ?? wrapper.current
    const element = bubble.current
    if (anchor === null || element === null) return

    const a = anchor.getBoundingClientRect()
    const b = element.getBoundingClientRect()

    let x = a.left + a.width / 2 - b.width / 2
    let y = placement === 'top' ? a.top - b.height - GAP : a.bottom + GAP

    if (placement === 'left' || placement === 'right') {
      x = placement === 'left' ? a.left - b.width - GAP : a.right + GAP
      y = a.top + a.height / 2 - b.height / 2
    }

    // Flip rather than clamp when it would leave the window: a tooltip pinned
    // to the edge covers the thing it is describing.
    if (y + b.height > window.innerHeight - MARGIN) y = a.top - b.height - GAP
    if (y < MARGIN) y = a.bottom + GAP

    setAt({
      x: Math.max(MARGIN, Math.min(x, window.innerWidth - b.width - MARGIN)),
      y: Math.max(MARGIN, y),
    })
  }, [shown, placement, label, hint])

  if (label === '') return children

  return (
    <>
      <span
        className="tip__anchor"
        ref={wrapper}
        onPointerEnter={() => setShown(true)}
        onPointerLeave={() => setShown(false)}
        // A tooltip that survives the click it describes is noise.
        onPointerDown={() => setShown(false)}
        onFocus={() => setShown(true)}
        onBlur={() => setShown(false)}
      >
        {children}
      </span>
      {shown &&
        createPortal(
          <div className="tip" ref={bubble} role="tooltip" style={{ left: at.x, top: at.y }}>
            <span className="tip__label">{label}</span>
            {hint !== undefined && hint !== '' && <span className="tip__hint">{hint}</span>}
          </div>,
          document.body,
        )}
    </>
  )
}
