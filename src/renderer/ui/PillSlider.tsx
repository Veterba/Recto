import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A slider with some weight to it: a dark pill fills up to a ringed knob, the
 * rest of the track carries tick marks, and a value bubble rises out of the
 * knob while it is held.
 *
 * Not `<input type="range">`, for the same reasons as the strength slider: a
 * native range cannot glide to a clicked point, cannot show that it is being
 * held, and cannot carry marks under it.
 *
 * - **Drag** follows the pointer exactly; lag under a finger reads as slowness.
 * - **Click** on the track glides there instead of jumping.
 * - **Held**, the knob presses in and the bubble shows the number.
 * - **Marks** (optional) name points along the range, and the nearest one lights.
 */

type Mark = { value: number; label: string }

/**
 * - `classic`: a dark fill up to the knob, nothing on the empty part.
 * - `ruler`: tick marks along the empty part, the fill covers them as it grows.
 * - `inset`: the ticks live inside the fill, like a measured tape.
 */
export type PillVariant = 'classic' | 'ruler' | 'inset'

type Props = {
  variant?: PillVariant
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  format?: (value: number) => string
  marks?: readonly Mark[]
}

const GLIDE_MS = 220
const KNOB = 22
/**
 * How close to a mark the pointer has to come, in px, before the value sticks
 * to it. Enough to land on the default without aiming, small enough that the
 * values either side of it are still reachable by dragging.
 */
const STICK_PX = 7

const snap = (value: number, min: number, max: number, step: number): number => {
  const stepped = Math.round((value - min) / step) * step + min
  // Rounding to the step's own precision, so 0.1 steps do not produce 0.30000000000000004.
  const decimals = (String(step).split('.')[1] ?? '').length
  return Math.min(max, Math.max(min, Number(stepped.toFixed(decimals))))
}

export function PillSlider({ variant = 'ruler', label, value, min, max, step, onChange, format, marks }: Props): React.ReactElement {
  const track = useRef<HTMLDivElement | null>(null)
  const [held, setHeld] = useState(false)
  const [gliding, setGliding] = useState(false)
  const glideTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(glideTimer.current), [])

  const valueAt = useCallback(
    (clientX: number): number => {
      const element = track.current
      if (element === null) return value
      const box = element.getBoundingClientRect()
      // The knob's centre travels inside the track, inset by half a knob at
      // each end, so the fill never pokes out past the knob at 0 or 100.
      const usable = Math.max(1, box.width - KNOB)
      const t = Math.min(1, Math.max(0, (clientX - box.left - KNOB / 2) / usable))
      // A mark within reach catches the pointer: the default is the value you
      // come back to most, and hunting for it a hundredth at a time is a chore.
      for (const mark of marks ?? []) {
        const at = (mark.value - min) / (max - min)
        if (Math.abs(at - t) * usable <= STICK_PX) return mark.value
      }
      return snap(min + t * (max - min), min, max, step)
    },
    [marks, max, min, step, value],
  )

  const press = (event: React.PointerEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const onKnob = (event.target as HTMLElement).closest('.pill__knob') !== null
    // A press on the track glides to the point; one on the knob only grabs it.
    if (!onKnob) {
      setGliding(true)
      window.clearTimeout(glideTimer.current)
      glideTimer.current = window.setTimeout(() => setGliding(false), GLIDE_MS)
      onChange(valueAt(event.clientX))
    }
    setHeld(true)
    const move = (moved: PointerEvent): void => {
      setGliding(false)
      onChange(valueAt(moved.clientX))
    }
    const up = (): void => {
      setHeld(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const t = max === min ? 0 : (value - min) / (max - min)
  const shown = format ? format(value) : String(value)
  const nearest =
    marks === undefined || marks.length === 0
      ? -1
      : marks.reduce((best, mark, i) => (Math.abs(mark.value - value) < Math.abs((marks[best]?.value ?? 0) - value) ? i : best), 0)

  return (
    <div className={`pill pill--${variant}${held ? ' is-held' : ''}${gliding ? ' is-gliding' : ''}`} style={{ ['--t' as string]: t }}>
      <div className="pill__head">
        <span className="pill__label">{label}</span>
        <span className="pill__value">{shown}</span>
      </div>
      <div
        className="pill__track"
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={shown}
        onPointerDown={press}
        onKeyDown={(event) => {
          const big = event.shiftKey ? 10 : 1
          let next: number | null = null
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = value - step * big
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = value + step * big
          if (event.key === 'Home') next = min
          if (event.key === 'End') next = max
          if (next === null) return
          event.preventDefault()
          setGliding(true)
          window.clearTimeout(glideTimer.current)
          glideTimer.current = window.setTimeout(() => setGliding(false), GLIDE_MS)
          onChange(snap(next, min, max, step))
        }}
      >
        <span className="pill__ticks" aria-hidden="true" />
        <span className="pill__fill" aria-hidden="true" />
        <span className="pill__knob" aria-hidden="true">
          <i />
          <span className="pill__bubble">{shown}</span>
        </span>
      </div>
      {marks !== undefined && marks.length > 0 && (
        <div className="pill__marks" aria-hidden="true">
          {marks.map((mark, i) => (
            <span
              key={mark.label}
              className={`pill__mark${i === nearest ? ' is-near' : ''}`}
              style={{ ['--at' as string]: (mark.value - min) / (max - min) }}
            >
              <i />
              {mark.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
