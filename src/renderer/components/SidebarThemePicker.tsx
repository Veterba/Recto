import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Appearance, Theme } from '../core/appearance'
import { PRESETS, type SidebarTheme } from '../core/sidebar-theme'
import { ColorEditor } from './ColorEditor'
import { Icon } from './Icon'
import { Tip } from './Tip'

/**
 * The sidebar's colour, as a popover on the sidebar itself.
 *
 * It lives here rather than in Settings on purpose: you are colouring a
 * surface, so the control belongs ON the surface where you can see what you are
 * doing. A slider in a modal that covers the thing it changes is a control you
 * operate by memory.
 *
 * Shape borrowed from Arc; the editor itself is shared with the graph, see
 * `ColorEditor`. What is the sidebar's own here is the placement and the three
 * theme modes on top of the pad.
 */

type Props = {
  at: { x: number; y: number }
  appearance: Appearance
  update: (patch: Partial<Appearance>) => void
  onClose: () => void
}

export function SidebarThemePicker({ at, appearance, update, onClose }: Props): React.ReactElement {
  const theme = appearance.sidebarTheme
  const card = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState(at)

  const themeRef = useRef(theme)
  themeRef.current = theme
  const set = useCallback(
    (patch: Partial<SidebarTheme>) => update({ sidebarTheme: { ...themeRef.current, ...patch } }),
    [update],
  )

  useLayoutEffect(() => {
    const element = card.current
    if (element === null) return
    // `offset*`, not `getBoundingClientRect`: the popover arrives with a
    // scale-up animation, and a bounding rect measured on its first frame is
    // the SCALED size - small enough that the clamp let a picker opened near
    // the bottom of the sidebar run off the bottom of the window.
    setPosition({
      x: Math.max(8, Math.min(at.x, window.innerWidth - element.offsetWidth - 8)),
      y: Math.max(8, Math.min(at.y, window.innerHeight - element.offsetHeight - 8)),
    })
  }, [at])

  useEffect(() => {
    /**
     * A right-click outside dismisses too - unlike the context menu, which
     * ignores button 2. The menu has to, because a trackpad secondary tap emits
     * the pair twice; but this popover is opened BY a right-click, so ignoring
     * button 2 left it open behind a file row's own menu. A time guard instead:
     * within 300ms it is the opening gesture still arriving.
     */
    const openedAt = Date.now()
    const dismiss = (event: MouseEvent): void => {
      if (Date.now() - openedAt < 300) return
      if (card.current?.contains(event.target as Node) === true) return
      onClose()
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', dismiss)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', dismiss)
      window.removeEventListener('keydown', key)
    }
  }, [onClose, at])

  const MODES: readonly { id: Theme; icon: string; label: string }[] = [
    { id: 'system', icon: 'sparkles', label: 'Match the system' },
    { id: 'light', icon: 'sun', label: 'Light' },
    { id: 'dark', icon: 'moon', label: 'Dark' },
  ]

  return createPortal(
    <div
      className="arcpick"
      ref={card}
      style={{ left: position.x, top: position.y }}
      role="dialog"
      aria-label="Sidebar theme"
      onContextMenu={(event) => event.preventDefault()}
    >
      <ColorEditor
        value={theme}
        onChange={set}
        presets={PRESETS}
        strengthLabel="Colour strength"
        grainHint={grainHint(theme.grain, appearance.translucent)}
        top={
          <div role="group" aria-label="Theme" style={{ display: 'contents' }}>
            {MODES.map((mode) => (
              <Tip key={mode.id} label={mode.label}>
                <button
                  className={`arcpick__mode${appearance.theme === mode.id ? ' is-active' : ''}`}
                  aria-label={mode.label}
                  aria-pressed={appearance.theme === mode.id}
                  onClick={() => update({ theme: mode.id })}
                >
                  <Icon name={mode.icon} size={17} />
                </button>
              </Tip>
            ))}
          </div>
        }
      />
    </div>,
    document.body,
  )
}

function grainHint(grain: number, translucent: boolean): string {
  if (!translucent) return 'Only shows with translucency on'
  if (grain === 0) return 'None'
  if (grain === 50) return "The theme's own"
  return `${grain < 50 ? 'Less' : 'More'} than the theme's own`
}
