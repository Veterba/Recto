import { useEffect, useRef, useState } from 'react'
import type { TopicsRunNotice } from '@shared/topics'
import { api } from '../api'
import { Icon } from './Icon'

/** How long a notice stays, and how long the keyboard must be still before one appears. */
const SHOW_MS = 6_000
const QUIET_MS = 1_500

/**
 * "Topics added to 12 notes · Undo", in the status bar, once per run.
 *
 * The one visible trace of a run: no modal, no popup, and nothing while you
 * type - a notice that arrives mid-sentence waits until the keyboard has been
 * still for a moment, then stays six seconds. Undo reverses the whole run.
 */
export function TopicsNotice(): React.ReactElement | null {
  const [shown, setShown] = useState<TopicsRunNotice | null>(null)
  const queue = useRef<TopicsRunNotice[]>([])
  const lastKey = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const showing = useRef(false)

  useEffect(() => {
    const onKey = (): void => {
      lastKey.current = Date.now()
    }
    window.addEventListener('keydown', onKey, true)

    const next = (): void => {
      window.clearTimeout(timer.current)
      const since = Date.now() - lastKey.current
      if (since < QUIET_MS) {
        timer.current = window.setTimeout(next, QUIET_MS - since)
        return
      }
      const item = queue.current.shift() ?? null
      showing.current = item !== null
      setShown(item)
      if (item !== null) timer.current = window.setTimeout(next, SHOW_MS)
    }

    const off = api.on('topics:run', (run) => {
      queue.current.push(run)
      if (!showing.current) next()
    })
    return () => {
      off()
      window.removeEventListener('keydown', onKey, true)
      window.clearTimeout(timer.current)
    }
  }, [])

  if (shown === null) return null

  return (
    <span className="status__notice" role="status">
      <Icon name="tags" size={12} />
      <span className="status__notice-text">{shown.label}</span>
      <button
        className="status__notice-undo"
        onClick={() => {
          void api.invoke('topics:undo-last-run')
          showing.current = false
          setShown(null)
        }}
      >
        Undo
      </button>
    </span>
  )
}
