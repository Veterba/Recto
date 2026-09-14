import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * How much colour the sidebar takes - a slider that moves like a physical one.
 *
 * The value is drawn as a line through the middle of the track that is flat at
 * 0 and grows into a wave as the value rises: more colour, more movement. That
 * is Arc's, and it is a better readout than a filled bar because it says what
 * the control does - how much the panel is disturbed - instead of just "how
 * far along".
 *
 * Not `<input type="range">`: a native range cannot stretch, cannot glide, and
 * cannot tell you it is being held. Three behaviours, each doing a job:
 *
 * - **Held**, the track thickens and the thumb squashes. The control says "I
 *   have you" the moment you press, before anything has moved.
 * - **Jumps glide.** Clicking the track or pressing an arrow animates the
 *   VALUE, not just the thumb, so the sidebar itself fades to the new strength
 *   instead of snapping. A drag, by contrast, follows the pointer 1:1 - lag
 *   under your finger reads as the app being slow.
 * - **Past the ends it stretches**, with resistance, and springs back on
 *   release. The end of the range is felt rather than hit.
 */

const GLIDE_MS = 240
/**
 * How far past an end the thumb may be pulled, and how hard it resists.
 *
 * Small on purpose, and matched by the slider's own side padding: at 14px the
 * stretched thumb hung outside the popover.
 */
const STRETCH_MAX = 6
const STRETCH_RESIST = 0.3
/** Thumb width, which its travel is inset by so it never overhangs an end. */
const THUMB = 14

/** The wave, in viewBox units. */
const WAVE_W = 200
const WAVE_H = 24
const WAVELENGTH = 18
/** Crest height at 100. Kept inside the track with room to spare. */
const AMPLITUDE_MAX = 7

/**
 * The line, flat at 0 and a full wave at 100.
 *
 * Amplitude grows with the SQUARE ROOT of the value, not linearly: a linear
 * wave is visually nothing until about 30, and the low end is where people
 * set a subtle tint - exactly where the readout needs to show something.
 */
export function wavePath(value: number, phase: number): string {
  const amplitude = AMPLITUDE_MAX * Math.sqrt(Math.min(100, Math.max(0, value)) / 100)
  const mid = WAVE_H / 2
  const points: string[] = []
  for (let x = 0; x <= WAVE_W; x += 2) {
    const y = mid + amplitude * Math.sin(((x + phase) / WAVELENGTH) * Math.PI * 2)
    points.push(`${x === 0 ? 'M' : 'L'}${x} ${y.toFixed(2)}`)
  }
  return points.join(' ')
}

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Ease-out with a small overshoot, matching `--ease-pop` in the stylesheet. */
function easeOutBack(t: number): number {
  const c1 = 1.2
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}

type Props = {
  value: number
  onChange: (value: number) => void
  label: string
}

export function StrengthSlider({ value, onChange, label }: Props): React.ReactElement {
  const track = useRef<HTMLDivElement | null>(null)
  const frame = useRef<number | undefined>(undefined)
  const [held, setHeld] = useState(false)
  /** Signed px the thumb is pulled past an end; 0 inside the range. */
  const [stretch, setStretch] = useState(0)
  /** The value drawn, which during a glide runs ahead of props by a frame. */
  const [shown, setShown] = useState(value)
  /** The wave's horizontal offset, so it flows while the slider is in use. */
  const [phase, setPhase] = useState(0)
  const [hover, setHover] = useState(false)

  // Outside changes (a preset picked above) glide too, so the slider never
  // teleports to a value it did not travel to.
  const shownRef = useRef(shown)
  shownRef.current = shown
  const glideTo = useCallback(
    (target: number, emit: boolean) => {
      window.cancelAnimationFrame(frame.current ?? 0)
      const from = shownRef.current
      if (reduced() || Math.abs(target - from) < 0.5) {
        setShown(target)
        if (emit) onChange(target)
        return
      }
      const start = performance.now()
      const step = (now: number): void => {
        const t = Math.min(1, (now - start) / GLIDE_MS)
        const next = from + (target - from) * easeOutBack(t)
        setShown(Math.min(100, Math.max(0, next)))
        // Emitting every frame is what makes the SIDEBAR animate, not just the
        // thumb. Rounded, because appearance.json does not need 60 decimals
        // a second and the save is debounced anyway.
        if (emit) onChange(Math.min(100, Math.max(0, Math.round(next))))
        if (t < 1) frame.current = window.requestAnimationFrame(step)
        else if (emit) onChange(target)
      }
      frame.current = window.requestAnimationFrame(step)
    },
    [onChange],
  )

  useEffect(() => {
    if (!held && Math.round(shownRef.current) !== value) glideTo(value, false)
    // Only react to the prop; `glideTo` changes identity with `onChange`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => () => window.cancelAnimationFrame(frame.current ?? 0), [])

  // The wave flows only while you are touching the control. A popover with a
  // permanently animating line is a popover you cannot stop looking at.
  useEffect(() => {
    if ((!held && !hover) || reduced()) return
    let id = 0
    let last = performance.now()
    const tick = (now: number): void => {
      // Faster the more colour there is, so the motion carries the value too.
      const speed = 10 + shownRef.current * 0.4
      setPhase((p) => (p + ((now - last) / 1000) * speed) % WAVELENGTH)
      last = now
      id = window.requestAnimationFrame(tick)
    }
    id = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(id)
  }, [held, hover])

  const valueAt = (clientX: number): { value: number; over: number } => {
    const box = track.current?.getBoundingClientRect()
    if (box === undefined) return { value, over: 0 }
    // The thumb's travel is inset by half its width at each end, so the value
    // is measured over that same inset span - or 100 would sit half off.
    const span = box.width - THUMB
    const raw = ((clientX - box.left - THUMB / 2) / span) * 100
    const clamped = Math.min(100, Math.max(0, raw))
    // Distance past the end, in px, for the stretch.
    const overPx = raw < 0 ? (raw / 100) * span : raw > 100 ? ((raw - 100) / 100) * span : 0
    return { value: Math.round(clamped / 5) * 5, over: overPx }
  }

  const onPointerDown = (event: React.PointerEvent): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setHeld(true)
    // A press on the track glides there; the drag that follows takes over.
    glideTo(valueAt(event.clientX).value, true)
  }

  const onPointerMove = (event: React.PointerEvent): void => {
    if (!held) return
    window.cancelAnimationFrame(frame.current ?? 0)
    const { value: next, over } = valueAt(event.clientX)
    setShown(next)
    if (next !== value) onChange(next)
    // Resistance: the further you pull, the less it gives, up to a hard stop.
    const pulled = Math.sign(over) * Math.min(STRETCH_MAX, Math.abs(over) * STRETCH_RESIST)
    setStretch(pulled)
  }

  const release = (): void => {
    setHeld(false)
    setStretch(0)
  }

  const pct = Math.min(100, Math.max(0, shown))

  return (
    <div
      className={`strength${held ? ' is-held' : ''}${stretch !== 0 ? ' is-stretched' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onKeyDown={(event) => {
        const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 10 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -10 : 0
        if (delta === 0) return
        event.preventDefault()
        glideTo(Math.min(100, Math.max(0, value + delta)), true)
      }}
      style={
        {
          '--pct-n': (pct / 100).toFixed(4),
          '--stretch': `${stretch}px`,
        } as React.CSSProperties
      }
    >
      <div className="strength__track" ref={track}>
        <svg
          className="strength__wave"
          viewBox={`0 0 ${WAVE_W} ${WAVE_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={wavePath(pct, phase)} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="strength__thumb" />
      </div>
    </div>
  )
}
