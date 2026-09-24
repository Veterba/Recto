import { useEffect, useRef, useState } from 'react'
import type { AutolinkAdded } from '@shared/autolinks'
import { api } from '../api'
import { Icon } from './Icon'

/** How long a notice stays, and how long the keyboard must be still before one appears. */
const SHOW_MS = 6_000
const QUIET_MS = 1_500

/**
 * "Added 2 links to Sourdough starter · Undo", in the status bar.
 *
 * The one visible trace of an Auto write: no modal, no popup, and nothing
 * while you type - a notice that arrives mid-sentence waits until the keyboard
 * has been still for a moment, then stays six seconds. Undo takes the links
 * back out and counts them as rejections, the same as deleting them by hand.
 */
export function AutolinkNotice(): React.ReactElement | null {
  const [shown, setShown] = useState<AutolinkAdded | null>(null)
  const queue = useRef<AutolinkAdded[]>([])
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

    const off = api.on('autolinks:added', (added) => {
      queue.current.push(added)
      if (!showing.current) next()
    })
    return () => {
      off()
      window.removeEventListener('keydown', onKey, true)
      window.clearTimeout(timer.current)
    }
  }, [])

  if (shown === null) return null
  const count = shown.targets.length

  return (
    <span className="status__notice" role="status" title={shown.targets.map((t) => t.name).join(', ')}>
      <Icon name="link" size={12} />
      <span className="status__notice-text">
        Added {count} {count === 1 ? 'link' : 'links'} to {shown.name}
      </span>
      <button
        className="status__notice-undo"
        onClick={() => {
          void api.invoke('autolinks:undo', shown.path, shown.targets.map((t) => t.target))
          showing.current = false
          setShown(null)
        }}
      >
        Undo
      </button>
    </span>
  )
}
