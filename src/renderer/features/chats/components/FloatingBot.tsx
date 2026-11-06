import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BotPlace } from '../../../app/appearance'
import { RectoBot, type BotState } from '../../recto-bot'
import { setBotMotion } from '../bot-motion'

/**
 * Recto's face in a corner of the workspace: click it for Quick ask. It can
 * be dragged anywhere and settles on the nearest edge when let go; where it
 * settled - the edge and how far along it - is remembered. It lives inside
 * the workspace area, so it never sits on the sidebar or the Chats panel.
 */

export const BOT_SIZE = 48
const MARGIN = 14
/** How long a dropped bot takes to glide to its edge. */
const GLIDE_MS = 220
/** A press that moves less than this is a click, not a drag. */
const CLICK_SLOP = 4

type Props = {
  place: BotPlace
  onPlace: (place: BotPlace) => void
  onClick: () => void
  state: BotState
  /** Quick ask is open: the face shows it is listening. */
  active: boolean
  /** Over a page with no free corner (a board): on a frosted disc that blurs what is behind it. */
  frosted?: boolean
}

/** The bars that bound where the bot may stand. */
const BARS = '.tabs__bar, .md__bar, .backlinks'

/**
 * Where the bot may stand: the note's own area - under the tab bar and the
 * row of arrows below it (`top`), over a Linked mentions bar (`below`) - and
 * there only along the left, right and bottom edges.
 */
export type BotArea = { top: number; width: number; height: number; below: number }

/** Measured from the workspace element. */
export function botArea(parent: HTMLElement): BotArea {
  const box = parent.getBoundingClientRect()
  let ceiling = box.top
  for (const bar of parent.querySelectorAll<HTMLElement>('.tabs__bar, .md__bar')) {
    const r = bar.getBoundingClientRect()
    // Only the bars along the top: a pane split below has its own further down.
    if (r.height > 0 && r.top <= box.top + 2 * BOT_SIZE) ceiling = Math.max(ceiling, r.bottom)
  }
  let floor = box.bottom
  for (const bar of parent.querySelectorAll<HTMLElement>('.backlinks')) {
    const r = bar.getBoundingClientRect()
    if (r.height > 0 && r.bottom >= box.bottom - 2) floor = Math.min(floor, r.top)
  }
  const top = ceiling - box.top
  const below = box.bottom - floor
  return { top, width: parent.clientWidth, height: Math.max(0, parent.clientHeight - top - below), below }
}

/**
 * `botArea`, kept current, at once: the workspace and the bars that bound it
 * are watched for size, so a Linked mentions bar opening or closing moves the
 * bot in the same frame; and the view itself is watched, so a bar that comes
 * or goes with another tab is seen in the next frame, not after a delay.
 */
export function useBotArea(parentOf: () => HTMLElement | null): BotArea {
  const [area, setArea] = useState<BotArea>({ top: 0, width: 0, height: 0, below: 0 })
  const get = useRef(parentOf)
  get.current = parentOf
  useLayoutEffect(() => {
    const parent = get.current()
    if (parent === null) return
    const measure = (): void => {
      const next = botArea(parent)
      setArea((prev) =>
        prev.top === next.top && prev.width === next.width && prev.height === next.height && prev.below === next.below ? prev : next,
      )
    }
    const resized = new ResizeObserver(measure)
    let watched: Element[] = []
    const watch = (): void => {
      const bars = [...parent.querySelectorAll(BARS)]
      if (bars.length !== watched.length || bars.some((bar, i) => bar !== watched[i])) {
        resized.disconnect()
        resized.observe(parent)
        for (const bar of bars) resized.observe(bar)
        watched = bars
      }
      measure()
    }
    // Views come and go as elements: looked at once a frame, however many changed in it.
    let frame = 0
    const changed = new MutationObserver(() => {
      if (frame === 0)
        frame = requestAnimationFrame(() => {
          frame = 0
          watch()
        })
    })
    changed.observe(parent, { childList: true, subtree: true })
    watch()
    return () => {
      resized.disconnect()
      changed.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])
  return area
}

/**
 * Where a place is, in the workspace's pixels. Along a side edge the place is
 * measured against the whole height, Linked mentions or not, so opening the bar
 * moves the bot only if the bar would reach it - and then just above the bar.
 */
export function pointOf(place: BotPlace, area: BotArea): { x: number; y: number } {
  const free = { x: Math.max(0, area.width - BOT_SIZE - 2 * MARGIN), y: Math.max(0, area.height + area.below - BOT_SIZE - 2 * MARGIN) }
  const lowest = area.top + area.height - BOT_SIZE - MARGIN
  switch (place.edge) {
    case 'left':
      return { x: MARGIN, y: Math.min(lowest, area.top + MARGIN + place.at * free.y) }
    case 'right':
      return { x: area.width - BOT_SIZE - MARGIN, y: Math.min(lowest, area.top + MARGIN + place.at * free.y) }
    case 'bottom':
      return { x: MARGIN + place.at * free.x, y: lowest }
  }
}

/** The edge nearest a point - left, right or bottom, never the top - and how far along it: where a dropped bot settles. */
export function snap(point: { x: number; y: number }, area: BotArea): BotPlace {
  const centre = { x: point.x + BOT_SIZE / 2, y: point.y - area.top + BOT_SIZE / 2 }
  const distances: [BotPlace['edge'], number][] = [
    ['left', centre.x],
    ['right', area.width - centre.x],
    ['bottom', area.height - centre.y],
  ]
  const edge = distances.reduce((best, d) => (d[1] < best[1] ? d : best))[0]
  const along = (v: number, length: number): number => Math.min(1, Math.max(0, (v - MARGIN) / Math.max(1, length - BOT_SIZE - 2 * MARGIN)))
  return { edge, at: edge === 'bottom' ? along(point.x, area.width) : along(point.y - area.top, area.height + area.below) }
}

export function FloatingBot({ place, onPlace, onClick, state, active, frosted = false }: Props): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  /** Just let go: it glides to the edge. Any other move - a bar opening, a resize - is at once. */
  const [dropped, setDropped] = useState(false)
  useEffect(() => {
    if (!dropped) return
    const timer = setTimeout(() => setDropped(false), GLIDE_MS)
    return () => clearTimeout(timer)
  }, [dropped])
  // Quick ask's bubble goes with it.
  useEffect(() => setBotMotion({ drag, gliding: dropped }), [drag, dropped])

  const area = useBotArea(() => ref.current?.offsetParent as HTMLElement | null)
  const at = drag ?? pointOf(place, area)
  // Not shown until the area is measured: no jump from a corner on first show.
  const measured = area.width > 0
  const [settled, setSettled] = useState(false)
  useLayoutEffect(() => {
    if (!measured || settled) return
    const frame = requestAnimationFrame(() => setSettled(true))
    return () => cancelAnimationFrame(frame)
  }, [measured, settled])

  const start = useCallback(
    (ev: React.PointerEvent) => {
      ev.preventDefault()
      const from = { x: ev.clientX, y: ev.clientY }
      const origin = pointOf(place, area)
      let moved = false
      let last = origin
      const onMove = (move: PointerEvent): void => {
        const dx = move.clientX - from.x
        const dy = move.clientY - from.y
        if (!moved && Math.hypot(dx, dy) < CLICK_SLOP) return
        moved = true
        last = {
          x: Math.min(area.width - BOT_SIZE, Math.max(0, origin.x + dx)),
          y: Math.min(area.top + area.height - BOT_SIZE, Math.max(area.top, origin.y + dy)),
        }
        setDrag(last)
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        setDrag(null)
        if (moved) {
          setDropped(true)
          onPlace(snap(last, area))
        } else onClick()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [place, area, onPlace, onClick],
  )

  return (
    <div
      ref={ref}
      className={`floating-bot${settled ? ' is-settled' : ''}${drag !== null ? ' is-dragging' : ''}${dropped ? ' is-dropped' : ''}${active ? ' is-active' : ''}${frosted ? ' is-frosted' : ''}`}
      style={{ left: at.x, top: at.y, width: BOT_SIZE, height: BOT_SIZE, visibility: measured ? 'visible' : 'hidden' }}
      role="button"
      aria-label="Quick ask"
      aria-pressed={active}
      tabIndex={0}
      data-edge={place.edge}
      onPointerDown={start}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault()
          onClick()
        }
      }}
    >
      <RectoBot id="floating-bot" size={BOT_SIZE} state={state} />
    </div>
  )
}
