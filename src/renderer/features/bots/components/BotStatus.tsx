import { useEffect, useRef, useState } from 'react'

/**
 * The status text of a working answer ("Reading Tutta…"), beside the face,
 * in the header and in the sidebar row. A new phrase crossfades in over the
 * old one (150 ms); a phrase that stays for more than 4 s gives way to its
 * calm variants, one every 3 s ("Still digging…"), and the step's own phrase
 * comes back when the step changes. A soft shimmer runs over it and the
 * ellipsis breathes - neither with reduced motion, where the text also stays
 * put (and so it is still in snapshots).
 */

const CALM_AFTER_MS = 4000
const CALM_EVERY_MS = 3000

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** The phrase to show now: the first, then after a while the calm ones in turn. */
export function useStatusText(phrases: readonly string[] | null): string | null {
  const key = phrases?.[0] ?? null
  const [tick, setTick] = useState(0)
  useEffect(() => {
    setTick(0)
    if (key === null || phrases === null || phrases.length < 2 || reducedMotion()) return
    let timer = window.setTimeout(function step() {
      setTick((t) => t + 1)
      timer = window.setTimeout(step, CALM_EVERY_MS)
    }, CALM_AFTER_MS)
    return () => window.clearTimeout(timer)
    // A new step's phrase starts over; the same step's list is the same list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (phrases === null) return null
  // The calm ones only: the step's own phrase is shown once, first.
  return tick === 0 ? phrases[0]! : phrases[1 + ((tick - 1) % (phrases.length - 1))]!
}

/** One phrase, crossfading from the last; its "…" drawn as dots that breathe. */
export function StatusText({ text, className = '' }: { text: string; className?: string }): React.ReactElement {
  const [shown, setShown] = useState<{ now: string; was: string | null }>({ now: text, was: null })
  const last = useRef(text)
  useEffect(() => {
    if (text === last.current) return
    setShown({ now: text, was: last.current })
    last.current = text
    const timer = window.setTimeout(() => setShown({ now: text, was: null }), 150)
    return () => window.clearTimeout(timer)
  }, [text])
  const words = (t: string): React.ReactElement => (
    <>
      {t.replace(/…$/, '')}
      {t.endsWith('…') && (
        <span className="bot-doing__dots" aria-hidden="true">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      )}
    </>
  )
  return (
    // Not role="status": that is the app's toast. The words are read as they change.
    <span className={`bot-doing ${className}`} aria-live="polite" data-text={text}>
      {shown.was !== null && (
        <span className="bot-doing__text is-leaving" aria-hidden="true">
          {words(shown.was)}
        </span>
      )}
      <span key={shown.now} className={`bot-doing__text${shown.was !== null ? ' is-entering' : ''}`}>
        {words(shown.now)}
      </span>
    </span>
  )
}
