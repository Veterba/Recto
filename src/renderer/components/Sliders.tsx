import { useCallback, useRef, useState } from 'react'
import { Icon } from './Icon'

/**
 * The rest of the slider family, beside `PillSlider`: a stepped dot picker for
 * a handful of named choices, a two-knob range with value badges, and a range
 * drawn over a histogram. Same materials throughout - dark fill, ringed knobs,
 * the `--pill-*` colours - so a panel can mix them and still look like one set.
 */

// --- stepped dots ------------------------------------------------------------------

type StepOption<T> = { value: T; label: string }

export function StepDots<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly StepOption<T>[]
  onChange: (value: T) => void
}): React.ReactElement {
  const index = Math.max(0, options.findIndex((option) => option.value === value))
  const go = (next: number): void => {
    const clamped = Math.min(options.length - 1, Math.max(0, next))
    if (clamped !== index) onChange(options[clamped]!.value)
  }
  return (
    <div className="steps" style={{ ['--i' as string]: index, ['--n' as string]: options.length }}>
      <div className="pill__head">
        <span className="pill__label">{label}</span>
        <span className="steps__current" key={String(value)}>
          {options[index]?.label}
        </span>
      </div>
      <div
        className="steps__track"
        role="radiogroup"
        aria-label={label}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') go(index - 1)
          if (event.key === 'ArrowRight') go(index + 1)
        }}
      >
        <button className="steps__arrow" aria-label="Previous" disabled={index === 0} onClick={() => go(index - 1)} tabIndex={-1}>
          <Icon name="chevron-left" size={13} />
        </button>
        <span className="steps__rule" aria-hidden="true" />
        <div className="steps__dots">
          <span className="steps__glider" aria-hidden="true" />
          {options.map((option, i) => (
            <button
              key={String(option.value)}
              role="radio"
              aria-checked={i === index}
              aria-label={option.label}
              title={option.label}
              className={`steps__dot${i === index ? ' is-on' : ''}`}
              onClick={() => go(i)}
              tabIndex={-1}
            >
              <i />
            </button>
          ))}
        </div>
        <span className="steps__rule" aria-hidden="true" />
        <button
          className="steps__arrow"
          aria-label="Next"
          disabled={index === options.length - 1}
          onClick={() => go(index + 1)}
          tabIndex={-1}
        >
          <Icon name="chevron-right" size={13} />
        </button>
      </div>
    </div>
  )
}

// --- dragging along a track --------------------------------------------------------

function useTrackDrag(
  min: number,
  max: number,
  step: number,
): { track: React.RefObject<HTMLDivElement | null>; valueAt: (clientX: number) => number } {
  const track = useRef<HTMLDivElement | null>(null)
  const valueAt = useCallback(
    (clientX: number) => {
      const element = track.current
      if (element === null) return min
      const box = element.getBoundingClientRect()
      const t = Math.min(1, Math.max(0, (clientX - box.left) / Math.max(1, box.width)))
      const raw = min + t * (max - min)
      const stepped = Math.round((raw - min) / step) * step + min
      const decimals = (String(step).split('.')[1] ?? '').length
      return Math.min(max, Math.max(min, Number(stepped.toFixed(decimals))))
    },
    [max, min, step],
  )
  return { track, valueAt }
}

/** How close, in px, a knob has to come to a default before it sticks. */
const STICK_PX = 7

/** Which of two knobs a press grabs: the nearer, and on a tie the one that can move that way. */
function nearer(value: number, low: number, high: number): 0 | 1 {
  if (low === high) return value < low ? 0 : 1
  return Math.abs(value - low) <= Math.abs(value - high) ? 0 : 1
}

function startDrag(onMove: (clientX: number) => void, onEnd: () => void): void {
  const move = (event: PointerEvent): void => onMove(event.clientX)
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    onEnd()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// --- two-knob range ------------------------------------------------------------------

export function RangeSlider({
  label,
  low,
  high,
  min,
  max,
  step,
  onChange,
  format = String,
  ruler,
  defaults,
}: {
  label: string
  low: number
  high: number
  min: number
  max: number
  step: number
  onChange: (low: number, high: number) => void
  format?: (value: number) => string
  /** Numbered ticks under the track. */
  ruler?: readonly number[]
  /**
   * Where the pair started out, marked on the track and slightly magnetic.
   *
   * A range you have dialled is hard to undo from memory - these say what it
   * was before you touched it, and catch the knob on the way past.
   */
  defaults?: readonly number[]
}): React.ReactElement {
  const { track, valueAt } = useTrackDrag(min, max, step)
  const [held, setHeld] = useState<0 | 1 | null>(null)
  const at = (v: number): number => (v - min) / (max - min)

  /** A default within a few pixels catches the knob. */
  const stick = (value: number): number => {
    const width = track.current?.getBoundingClientRect().width ?? 0
    if (defaults === undefined || width <= 0) return value
    const reach = (STICK_PX / width) * (max - min)
    for (const mark of defaults) if (Math.abs(mark - value) <= reach) return mark
    return value
  }

  const press = (event: React.PointerEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const value = valueAt(event.clientX)
    const knob = nearer(value, low, high)
    setHeld(knob)
    const apply = (clientX: number): void => {
      const v = stick(valueAt(clientX))
      if (knob === 0) onChange(Math.min(v, high), high)
      else onChange(low, Math.max(v, low))
    }
    apply(event.clientX)
    startDrag(apply, () => setHeld(null))
  }

  return (
    <div className={`range${held !== null ? ' is-held' : ''}`}>
      <div className="pill__head">
        <span className="pill__label">{label}</span>
        <span className="pill__value">
          {format(low)} – {format(high)}
        </span>
      </div>
      <div className="range__track" ref={track} onPointerDown={press} role="group" aria-label={label}>
        <span className="range__bar" style={{ left: `${at(low) * 100}%`, right: `${(1 - at(high)) * 100}%` }} />
        {defaults?.map((mark) => (
          <span key={`default-${mark}`} className="range__default" style={{ left: `${at(mark) * 100}%` }} aria-hidden="true" />
        ))}
        {[low, high].map((v, i) => (
          <span
            key={i}
            className={`range__knob${held === i ? ' is-held' : ''}`}
            style={{ left: `${at(v) * 100}%` }}
            role="slider"
            tabIndex={0}
            aria-label={i === 0 ? `${label}, from` : `${label}, to`}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={v}
            onKeyDown={(event) => {
              const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : 0
              if (delta === 0) return
              event.preventDefault()
              if (i === 0) onChange(Math.min(high, Math.max(min, low + delta)), high)
              else onChange(low, Math.max(low, Math.min(max, high + delta)))
            }}
          >
            <span className="range__badge">{format(v)}</span>
          </span>
        ))}
      </div>
      {ruler !== undefined && (
        <div className="range__ruler" aria-hidden="true">
          {ruler.map((tick) => (
            <span key={tick} style={{ left: `${at(tick) * 100}%` }}>
              <i />
              {format(tick)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// --- histogram range -----------------------------------------------------------------

export type HistogramBin = { label: string; count: number }

/**
 * A range over bins, drawn as a histogram: the bars inside the range are dark,
 * the rest recede. The histogram is the point - it shows where the notes are
 * before you choose which of them to keep.
 */
export function HistogramRange({
  label,
  bins,
  low,
  high,
  onChange,
  summary,
}: {
  label: string
  bins: readonly HistogramBin[]
  /** Bin indices, inclusive. */
  low: number
  high: number
  onChange: (low: number, high: number) => void
  summary: string
}): React.ReactElement {
  const last = Math.max(0, bins.length - 1)
  const { track, valueAt } = useTrackDrag(0, last, 1)
  const [held, setHeld] = useState(false)
  const tallest = bins.reduce((m, bin) => Math.max(m, bin.count), 0)
  const at = (i: number): number => (last === 0 ? 0 : i / last)

  const press = (event: React.PointerEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const knob = nearer(valueAt(event.clientX), low, high)
    setHeld(true)
    const apply = (clientX: number): void => {
      const v = valueAt(clientX)
      if (knob === 0) onChange(Math.min(v, high), high)
      else onChange(low, Math.max(v, low))
    }
    apply(event.clientX)
    startDrag(apply, () => setHeld(false))
  }

  return (
    <div className={`hist${held ? ' is-held' : ''}`}>
      <div className="pill__head">
        <span className="pill__label">{label}</span>
        <span className="pill__value">{summary}</span>
      </div>
      <div className="hist__bars" aria-hidden="true">
        {bins.map((bin, i) => (
          <span key={bin.label} className={`hist__bar${i >= low && i <= high ? ' is-in' : ''}`} title={`${bin.label}: ${bin.count}`}>
            <i style={{ height: `${tallest === 0 ? 4 : 6 + (Math.sqrt(bin.count) / Math.sqrt(tallest)) * 94}%` }} />
          </span>
        ))}
      </div>
      <div className="hist__track" ref={track} onPointerDown={press} role="group" aria-label={label}>
        <span className="range__bar" style={{ left: `${at(low) * 100}%`, right: `${(1 - at(high)) * 100}%` }} />
        {[low, high].map((v, i) => (
          <span
            key={i}
            className="range__knob range__knob--small"
            style={{ left: `${at(v) * 100}%` }}
            role="slider"
            tabIndex={0}
            aria-label={i === 0 ? `${label}, from` : `${label}, to`}
            aria-valuemin={0}
            aria-valuemax={last}
            aria-valuenow={v}
            aria-valuetext={bins[v]?.label}
            onKeyDown={(event) => {
              const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
              if (delta === 0) return
              event.preventDefault()
              if (i === 0) onChange(Math.min(high, Math.max(0, low + delta)), high)
              else onChange(low, Math.max(low, Math.min(last, high + delta)))
            }}
          />
        ))}
      </div>
      <div className="hist__labels" aria-hidden="true">
        <span>{bins[0]?.label}</span>
        <span>{bins[last]?.label}</span>
      </div>
    </div>
  )
}
