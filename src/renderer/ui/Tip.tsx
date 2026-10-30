import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { metaHeld, subscribeMeta, useMetaHeld } from './meta-key'

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

/** Where a tooltip of size `b` goes beside an anchor at `a`: flipped, not clamped, at a window edge. */
export function placeTip(a: DOMRect, b: DOMRect, placement: TipPlacement): { x: number; y: number } {
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
  if (placement === 'right' && x + b.width > window.innerWidth - MARGIN) x = a.left - b.width - GAP

  return {
    x: Math.max(MARGIN, Math.min(x, window.innerWidth - b.width - MARGIN)),
    y: Math.max(MARGIN, y),
  }
}

/**
 * The same tooltip for an element that is not React - a CodeMirror widget's
 * button. Shown on hover with ⌘ held and on keyboard focus, gone on press, in
 * the same layer.
 */
export function attachTip(anchor: HTMLElement, label: string, placement: TipPlacement = 'bottom'): void {
  let bubble: HTMLDivElement | null = null
  let watch = 0
  /** Stops following ⌘, once the pointer has left. */
  let off: (() => void) | null = null
  const hide = (): void => {
    bubble?.remove()
    bubble = null
    window.clearInterval(watch)
  }
  const show = (): void => {
    hide()
    bubble = document.createElement('div')
    bubble.className = 'tip'
    bubble.setAttribute('role', 'tooltip')
    const text = document.createElement('span')
    text.className = 'tip__label'
    text.textContent = label
    bubble.append(text)
    document.body.append(bubble)
    const at = placeTip(anchor.getBoundingClientRect(), bubble.getBoundingClientRect(), placement)
    bubble.style.left = `${at.x}px`
    bubble.style.top = `${at.y}px`
    // A button redrawn away under the pointer never sends pointerleave.
    watch = window.setInterval(() => {
      if (anchor.isConnected) return
      hide()
      off?.()
      off = null
    }, 250)
  }
  // Hovered, it shows while ⌘ is held (meta-key.ts) and goes when ⌘ is let go.
  const follow = (): void => (metaHeld() ? show() : hide())
  anchor.addEventListener('pointerenter', () => {
    off?.()
    off = subscribeMeta(follow)
    follow()
  })
  anchor.addEventListener('pointerleave', () => {
    off?.()
    off = null
    hide()
  })
  anchor.addEventListener('pointerdown', hide)
  anchor.addEventListener('focus', () => {
    if (anchor.matches(':focus-visible')) show()
  })
  anchor.addEventListener('blur', hide)
}

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
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const meta = useMetaHeld()
  // Under the pointer it waits for ⌘ (meta-key.ts); reached by keyboard it shows at once.
  const shown = (hovered && meta) || focused
  const [at, setAt] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!shown) return
    const anchor = wrapper.current?.firstElementChild ?? wrapper.current
    const element = bubble.current
    if (anchor === null || element === null) return

    setAt(placeTip(anchor.getBoundingClientRect(), element.getBoundingClientRect(), placement))
  }, [shown, placement, label, hint])

  if (label === '') return children

  return (
    <>
      <span
        className="tip__anchor"
        ref={wrapper}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        // A tooltip that survives the click it describes is noise.
        onPointerDown={() => {
          setHovered(false)
          setFocused(false)
        }}
        // Keyboard focus only: a click focuses a button too, and that is not asking.
        onFocus={(event) => setFocused((event.target as Element).matches(':focus-visible'))}
        onBlur={() => setFocused(false)}
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
