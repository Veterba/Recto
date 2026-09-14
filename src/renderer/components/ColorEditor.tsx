import { useCallback, useRef, useState } from 'react'
import {
  colorAt,
  MAX_STOPS,
  nextStop,
  padPosition,
  SIDEBAR_PAD,
  tintCss,
  type PadRange,
} from '../core/sidebar-theme'
import { Icon } from './Icon'
import { StrengthSlider } from './StrengthSlider'
import { Tip } from './Tip'

/**
 * The Arc-style colour editor: a dotted pad wearing the colours, one handle per
 * colour, presets under it, and at the bottom a strength slider and - where the
 * surface can take texture - a grain dial.
 *
 * Shared by everything in the app that is coloured this way, so the sidebar and
 * the graph feel like one tool rather than two that look alike.
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
export function GrainDial({ grain, onChange }: { grain: number; onChange: (grain: number) => void }): React.ReactElement {
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

export type ColorPreset = { id: string; label: string; colors: string[] }

export type ColorValue = { colors: string[]; strength: number; grain?: number }

const PAGE = 6

type Props = {
  value: ColorValue
  onChange: (patch: Partial<ColorValue>) => void
  presets: readonly ColorPreset[]
  /** Controls laid over the top of the pad - modes, targets. */
  top?: React.ReactNode
  strengthLabel: string
  /** Shown only when the value has a grain; dots, for one, cannot take texture. */
  grainHint?: string
  emptyHint?: string
  range?: PadRange
  /** A short tag over each handle - which colour is which, when order means something. */
  handleLabel?: ((index: number, count: number) => string | null) | undefined
  /** Shown between the pad and the swatches. */
  between?: React.ReactNode | undefined
}

export function ColorEditor({
  value,
  onChange,
  presets,
  top,
  strengthLabel,
  grainHint,
  emptyHint = 'Click anywhere to pick a colour',
  range = SIDEBAR_PAD,
  handleLabel,
  between,
}: Props): React.ReactElement {
  const pad = useRef<HTMLDivElement | null>(null)
  const [page, setPage] = useState(0)
  /** Which colour the pad is moving. */
  const [selected, setSelected] = useState(0)

  // Read through a ref inside drag handlers, which outlive the render they
  // were created in - a stale value there would write back an old palette.
  const valueRef = useRef(value)
  valueRef.current = value

  /** Move one colour to wherever the pointer is on the pad. */
  const moveTo = useCallback(
    (index: number, event: PointerEvent | React.PointerEvent) => {
      const element = pad.current
      if (element === null) return
      const box = element.getBoundingClientRect()
      const colors = [...valueRef.current.colors]
      if (index >= colors.length) return
      colors[index] = colorAt((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height, range)
      onChange({ colors })
    },
    [onChange, range],
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

  const pages = Math.ceil(presets.length / PAGE)
  const swatches = presets.slice(page * PAGE, page * PAGE + PAGE)
  const active = Math.min(selected, Math.max(0, value.colors.length - 1))
  // Never fully transparent, or turning strength down leaves you steering a
  // colour you cannot see.
  const preview = tintCss({ colors: value.colors, strength: Math.max(value.strength, 35) })

  return (
    <div className="arcpick__editor">
      <div
        className="arcpick__pad"
        ref={pad}
        style={{ backgroundImage: value.colors.length === 0 ? undefined : preview }}
        // Pressing empty pad moves the selected colour there, the way Arc does:
        // you point at the colour you want rather than dragging to it.
        onPointerDown={(event) => {
          if (value.colors.length === 0) {
            const box = event.currentTarget.getBoundingClientRect()
            onChange({ colors: [colorAt((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height, range)] })
            setSelected(0)
            return
          }
          drag(active, event)
        }}
      >
        {top !== undefined && (
          <div className="arcpick__modes" onPointerDown={(e) => e.stopPropagation()}>
            {top}
          </div>
        )}

        {value.colors.length === 0 && <p className="arcpick__hint">{emptyHint}</p>}

        {value.colors.map((color, index) => {
          const spot = padPosition(color, range)
          const tag = handleLabel?.(index, value.colors.length) ?? null
          return (
            <button
              key={index}
              className={`arcpick__handle${index === active ? ' is-active' : ''}`}
              style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, background: color }}
              aria-label={tag === null ? `Colour ${index + 1}` : `${tag} colour`}
              onPointerDown={(event) => drag(index, event)}
            >
              {tag !== null && (
                <span
                  className={`arcpick__tag${spot.y < 0.2 ? ' is-below' : ''}${spot.x < 0.12 ? ' is-left' : spot.x > 0.88 ? ' is-right' : ''}`}
                >
                  {tag}
                </span>
              )}
            </button>
          )
        })}

        <div className="arcpick__stepper" onPointerDown={(e) => e.stopPropagation()}>
          <Tip label="Remove a colour">
            <button
              aria-label="Remove a colour"
              disabled={value.colors.length === 0}
              onClick={() => {
                onChange({ colors: value.colors.filter((_, i) => i !== active) })
                setSelected(Math.max(0, active - 1))
              }}
            >
              <Icon name="minus" size={17} />
            </button>
          </Tip>
          <Tip label="Add a colour">
            <button
              aria-label="Add a colour"
              disabled={value.colors.length >= MAX_STOPS}
              onClick={() => {
                onChange({ colors: [...value.colors, nextStop(value.colors, range)] })
                setSelected(value.colors.length)
              }}
            >
              <Icon name="plus" size={17} />
            </button>
          </Tip>
        </div>
      </div>

      {between}

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
                className={`arcpick__swatch${preset.colors.join() === value.colors.join() ? ' is-active' : ''}${
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
                  onChange({ colors: [...preset.colors] })
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
        <StrengthSlider value={value.strength} label={strengthLabel} onChange={(strength) => onChange({ strength })} />
        {value.grain !== undefined && (
          <Tip label="Grain" hint={grainHint}>
            <GrainDial grain={value.grain} onChange={(grain) => onChange({ grain })} />
          </Tip>
        )}
      </div>
    </div>
  )
}
