import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Appearance, Theme } from '../core/appearance'
import {
  colorAt,
  MAX_STOPS,
  nextStop,
  padPosition,
  PRESETS,
  tintCss,
  type SidebarTheme,
} from '../core/sidebar-theme'
import { Icon } from './Icon'
import { StrengthSlider } from './StrengthSlider'
import { Tip } from './Tip'

/**
 * The sidebar's colour, as a popover on the sidebar itself.
 *
 * It lives here rather than in Settings on purpose: you are colouring a
 * surface, so the control belongs ON the surface where you can see what you are
 * doing. A slider in a modal that covers the thing it changes is a control you
 * operate by memory.
 *
 * Shape borrowed from Arc. The top is a dotted pad wearing the current tint,
 * with one handle per colour: drag a handle and its colour follows - across is
 * hue, down is lightness. Under it, presets. At the bottom, how much colour on
 * a slider and how much grain on a dial.
 */

const GRAIN_DOTS = 28
const DIAL = 76
const RING = DIAL / 2 - 6
/** The dial is a volume knob, not a compass: it sweeps 300°, with a gap at the bottom. */
const SWEEP = 300
const START = -SWEEP / 2

/** The grain the app actually draws, reused as the knob's own texture. */
const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='80' height='80' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")"

/**
 * Grain, as a knob.
 *
 * A knob rather than a second slider because it is a second KIND of thing -
 * texture, not colour - and two identical sliders side by side get confused for
 * each other. The dots light up along the sweep up to the current amount, so
 * the value reads at a glance without a number.
 */
function GrainDial({ grain, onChange }: { grain: number; onChange: (grain: number) => void }): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)

  const fromPointer = useCallback(
    (event: PointerEvent | React.PointerEvent) => {
      const element = ref.current
      if (element === null) return
      const box = element.getBoundingClientRect()
      const dx = event.clientX - (box.left + box.width / 2)
      const dy = event.clientY - (box.top + box.height / 2)
      // Clockwise from straight up, in -180..180.
      const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI
      // Past either end of the sweep - the dead zone at the bottom - snaps to
      // the nearer end, so a drag that overshoots does not flip to the other.
      const clamped = Math.min(SWEEP / 2, Math.max(-SWEEP / 2, degrees))
      onChange(Math.round(((clamped - START) / SWEEP) * 20) * 5)
    },
    [onChange],
  )

  const start = (event: React.PointerEvent): void => {
    event.preventDefault()
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
    fromPointer(event)
    const move = (moved: PointerEvent): void => fromPointer(moved)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const angle = START + (grain / 100) * SWEEP

  return (
    <div
      className="arcpick__dial"
      ref={ref}
      role="slider"
      aria-label="Grain"
      aria-valuenow={grain}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') onChange(Math.max(0, grain - 5))
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') onChange(Math.min(100, grain + 5))
      }}
    >
      <svg width={DIAL} height={DIAL} aria-hidden="true">
        {Array.from({ length: GRAIN_DOTS + 1 }, (_, i) => {
          const a = ((START + (i / GRAIN_DOTS) * SWEEP) * Math.PI) / 180
          return (
            <circle
              key={i}
              cx={DIAL / 2 + RING * Math.sin(a)}
              cy={DIAL / 2 - RING * Math.cos(a)}
              r={1.6}
              className={i / GRAIN_DOTS <= grain / 100 ? 'is-lit' : ''}
            />
          )
        })}
      </svg>
      <div className="arcpick__knob" style={{ backgroundImage: NOISE }}>
        <span
          className="arcpick__tick"
          style={{ transform: `rotate(${angle}deg)` }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}

const PAGE = 6

type Props = {
  at: { x: number; y: number }
  appearance: Appearance
  update: (patch: Partial<Appearance>) => void
  onClose: () => void
}

export function SidebarThemePicker({ at, appearance, update, onClose }: Props): React.ReactElement {
  const theme = appearance.sidebarTheme
  const card = useRef<HTMLDivElement | null>(null)
  const pad = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState(at)
  const [page, setPage] = useState(0)
  /** Which colour the pad is moving. */
  const [selected, setSelected] = useState(0)

  // Read through a ref inside drag handlers, which outlive the render they
  // were created in - a stale `theme` there would write back an old palette.
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

  /** Move one colour to wherever the pointer is on the pad. */
  const moveTo = useCallback(
    (index: number, event: PointerEvent | React.PointerEvent) => {
      const element = pad.current
      if (element === null) return
      const box = element.getBoundingClientRect()
      const colors = [...themeRef.current.colors]
      if (index >= colors.length) return
      colors[index] = colorAt((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height)
      set({ colors })
    },
    [set],
  )

  const drag = (index: number, event: React.PointerEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    setSelected(index)
    moveTo(index, event)
    const move = (moved: PointerEvent): void => moveTo(index, moved)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const pages = Math.ceil(PRESETS.length / PAGE)
  const swatches = PRESETS.slice(page * PAGE, page * PAGE + PAGE)
  const active = Math.min(selected, Math.max(0, theme.colors.length - 1))
  // Never fully transparent, or turning strength down leaves you steering a
  // colour you cannot see.
  const preview = tintCss({ colors: theme.colors, strength: Math.max(theme.strength, 35) })

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
      <div
        className="arcpick__pad"
        ref={pad}
        style={{ backgroundImage: theme.colors.length === 0 ? undefined : preview }}
        // Pressing empty pad moves the selected colour there, the way Arc does:
        // you point at the colour you want rather than dragging to it.
        onPointerDown={(event) => {
          if (theme.colors.length === 0) {
            const box = event.currentTarget.getBoundingClientRect()
            set({ colors: [colorAt((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height)] })
            setSelected(0)
            return
          }
          drag(active, event)
        }}
      >
        <div className="arcpick__modes" role="group" aria-label="Theme" onPointerDown={(e) => e.stopPropagation()}>
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

        {theme.colors.length === 0 && <p className="arcpick__hint">Click anywhere to pick a colour</p>}

        {theme.colors.map((color, index) => {
          const spot = padPosition(color)
          return (
            <button
              key={index}
              className={`arcpick__handle${index === active ? ' is-active' : ''}`}
              style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, background: color }}
              aria-label={`Colour ${index + 1}`}
              onPointerDown={(event) => drag(index, event)}
            />
          )
        })}

        <div className="arcpick__stepper" onPointerDown={(e) => e.stopPropagation()}>
          <Tip label="Remove a colour">
            <button
              aria-label="Remove a colour"
              disabled={theme.colors.length === 0}
              onClick={() => {
                set({ colors: theme.colors.filter((_, i) => i !== active) })
                setSelected(Math.max(0, active - 1))
              }}
            >
              <Icon name="minus" size={17} />
            </button>
          </Tip>
          <Tip label="Add a colour">
            <button
              aria-label="Add a colour"
              disabled={theme.colors.length >= MAX_STOPS}
              onClick={() => {
                set({ colors: [...theme.colors, nextStop(theme.colors)] })
                setSelected(theme.colors.length)
              }}
            >
              <Icon name="plus" size={17} />
            </button>
          </Tip>
        </div>
      </div>

      <div className="arcpick__strip">
        <button
          className="arcpick__page"
          aria-label="Previous colours"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          <Icon name="chevron-left" size={16} />
        </button>
        <div className="arcpick__swatches">
          {swatches.map((preset) => (
            <Tip key={preset.id} label={preset.label}>
              <button
                className={`arcpick__swatch${preset.colors.join() === theme.colors.join() ? ' is-active' : ''}${
                  preset.colors.length === 0 ? ' arcpick__swatch--none' : ''
                }`}
                aria-label={preset.label}
                style={
                  preset.colors.length === 0
                    ? undefined
                    : {
                        backgroundImage:
                          preset.colors.length === 1
                            ? `linear-gradient(${preset.colors[0]}, ${preset.colors[0]})`
                            : `linear-gradient(135deg, ${preset.colors.join(', ')})`,
                      }
                }
                onClick={() => {
                  set({ colors: [...preset.colors] })
                  setSelected(0)
                }}
              />
            </Tip>
          ))}
        </div>
        <button
          className="arcpick__page"
          aria-label="More colours"
          disabled={page >= pages - 1}
          onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
        >
          <Icon name="chevron-right" size={16} />
        </button>
      </div>

      <div className="arcpick__knobs">
        <StrengthSlider
          value={theme.strength}
          label="Colour strength"
          onChange={(strength) => set({ strength })}
        />
        <Tip label="Grain" hint={grainHint(theme.grain, appearance.translucent)}>
          <GrainDial grain={theme.grain} onChange={(grain) => set({ grain })} />
        </Tip>
      </div>
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
