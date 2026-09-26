import { useState, useRef, useCallback, useEffect } from 'react'

/** How long the wheel waits after the last scroll before settling. */
const SETTLE_MS = 140

export function useWheelPosition(
  count: number,
  onSettle: (index: number) => void,
): {
  position: number
  nudge: (by: number) => void
  goTo: (index: number) => void
} {
  const [position, setPosition] = useState(0)
  const live = useRef(0)
  const frame = useRef(0)
  const settleTimer = useRef<number | undefined>(undefined)
  const onSettleRef = useRef(onSettle)
  onSettleRef.current = onSettle

  const set = (value: number): void => {
    live.current = value
    setPosition(value)
  }

  /** Spring to a whole item, then report it. */
  const animateTo = useCallback((target: number) => {
    cancelAnimationFrame(frame.current)
    const from = live.current
    const started = performance.now()
    const duration = 320
    const tick = (now: number): void => {
      const t = Math.min(1, (now - started) / duration)
      // easeOutBack, gently: arrives with the smallest overshoot, like a detent.
      const c = 1.2
      const eased = 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
      set(from + (target - from) * eased)
      if (t < 1) frame.current = requestAnimationFrame(tick)
      else {
        set(target)
        onSettleRef.current(target)
      }
    }
    frame.current = requestAnimationFrame(tick)
  }, [])

  const nudge = useCallback(
    (by: number) => {
      cancelAnimationFrame(frame.current)
      // Past either end it resists, then springs back when it settles.
      let next = live.current + by
      if (next < 0) next = live.current + by * 0.3
      if (next > count - 1) next = live.current + by * 0.3
      set(Math.min(count - 1 + 0.6, Math.max(-0.6, next)))
      window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(() => animateTo(Math.min(count - 1, Math.max(0, Math.round(live.current)))), SETTLE_MS)
    },
    [animateTo, count],
  )

  const goTo = useCallback(
    (index: number) => {
      window.clearTimeout(settleTimer.current)
      animateTo(Math.min(count - 1, Math.max(0, index)))
    },
    [animateTo, count],
  )

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      window.clearTimeout(settleTimer.current)
    },
    [],
  )

  return { position, nudge, goTo }
}
