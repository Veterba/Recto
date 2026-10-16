import { useEffect, useRef, useState } from 'react'
import { addDays } from '@shared/card-fields'
import { isoWeek } from '@shared/templates'
import { Icon } from '../../../ui/Icon'
import { CALENDAR_VIEWS, calendarBars, spanLabel, stepView, viewDays, viewStart, type CalendarView } from '../board-view'
import type { WidgetProps } from './registry'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const dateOf = (day: string): Date => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

/** What the header says the visible days are. */
function rangeTitle(view: CalendarView, from: string, days: number, today: string): string {
  const to = addDays(from, days - 1)
  const range = spanLabel({ from, to }, today)
  if (view === 'month' && from.endsWith('-01')) return `${MONTH_NAMES[dateOf(from).getMonth()]} ${from.slice(0, 4)}`
  const first = isoWeek(dateOf(from)).week
  const last = isoWeek(dateOf(to)).week
  return first === last ? `Week ${first} · ${range}` : `Weeks ${first}–${last} · ${range}`
}

/**
 * The board's dates: each card with dates as a bar across its days, each
 * column with a date range as a dashed bar, a line on today under them. A week,
 * two weeks or a month at a time: the arrows step a whole view, a sideways
 * scroll or a drag moves a day at a time, Today comes back. A bar that runs
 * past the visible days says where it ends; hovering any bar gives its range.
 */
export function CalendarWidget({ board, cards, today, onOpenCard }: WidgetProps): React.ReactElement {
  const [view, setView] = useState<CalendarView>('week')
  const [from, setFrom] = useState(() => viewStart('week', today))
  const days = viewDays(view, from)
  const bars = calendarBars(cards, board.columns, from, days)
  const todayIndex = Array.from({ length: days }, (_, i) => i).find((i) => addDays(from, i) === today)
  const grid = useRef<HTMLDivElement | null>(null)

  // A sideways scroll moves the days. Not React's onWheel, which is passive:
  // the strip around the calendar scrolls sideways too and must not take it.
  const wheel = useRef(0)
  useEffect(() => {
    const el = grid.current
    if (el === null) return
    const onWheel = (event: WheelEvent): void => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
      event.preventDefault()
      wheel.current += event.deltaX
      const step = el.clientWidth / days
      const moved = Math.trunc(wheel.current / step)
      if (moved === 0) return
      wheel.current -= moved * step
      setFrom((current) => addDays(current, moved))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [days])

  /** Dragging the empty grid moves the days with the pointer. */
  const drag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button') !== null) return
    const el = event.currentTarget
    const step = el.clientWidth / days
    const start = event.clientX
    const startFrom = from
    el.setPointerCapture(event.pointerId)
    el.classList.add('is-dragging')
    const onMove = (ev: PointerEvent): void => setFrom(addDays(startFrom, -Math.round((ev.clientX - start) / step)))
    const onUp = (): void => {
      el.classList.remove('is-dragging')
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  const cols = { gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }

  return (
    <div className="board-cal" data-view={view}>
      <div className="board-cal__nav">
        <button className="icon-btn" aria-label="Previous" title="Previous" onClick={() => setFrom(stepView(view, from, -1))}>
          <Icon name="chevron-left" size={14} />
        </button>
        <button className="icon-btn" aria-label="Next" title="Next" onClick={() => setFrom(stepView(view, from, 1))}>
          <Icon name="chevron-right" size={14} />
        </button>
        <span className="board-cal__week">{rangeTitle(view, from, days, today)}</span>
        <button className="board-cal__today-btn" disabled={todayIndex !== undefined} onClick={() => setFrom(viewStart(view, today))}>
          Today
        </button>
        <span className="board-seg" role="group" aria-label="Calendar view">
          {CALENDAR_VIEWS.map((v) => (
            <button
              key={v.key}
              className={`board-seg__btn${view === v.key ? ' is-on' : ''}`}
              aria-pressed={view === v.key}
              onClick={() => {
                setView(v.key)
                // Keep the day in view that the old view was showing: today if it was there, else its first day.
                setFrom(viewStart(v.key, todayIndex !== undefined ? today : from))
              }}
            >
              {v.label}
            </button>
          ))}
        </span>
      </div>
      <div className="board-cal__days" style={cols}>
        {Array.from({ length: days }, (_, i) => {
          const day = addDays(from, i)
          const weekday = dateOf(day).getDay()
          return (
            <span
              key={day}
              className={`board-cal__day${i === todayIndex ? ' is-today' : ''}${weekday === 0 || weekday === 6 ? ' is-weekend' : ''}`}
              title={day}
            >
              {view === 'month' ? Number(day.slice(8)) : `${DAY_NAMES[weekday]} ${Number(day.slice(8))}`}
            </span>
          )
        })}
      </div>
      <div className="board-cal__bars" ref={grid} style={{ ...cols, ['--cal-days' as string]: days }} onPointerDown={drag}>
        {todayIndex !== undefined && (
          <span className="board-cal__today" aria-hidden="true" style={{ left: `calc(${(todayIndex + 0.5) / days} * 100%)` }} />
        )}
        {bars.map((bar) => {
          const range = spanLabel(bar.span, today)
          const end = bar.after ? (
            <span className="board-cal__end" aria-label={`ends ${spanLabel({ from: bar.span.to, to: bar.span.to }, today)}`}>
              → {spanLabel({ from: bar.span.to, to: bar.span.to }, today)}
            </span>
          ) : null
          const cls = `board-cal__bar${bar.kind === 'column' ? ' is-column' : ''}${bar.level === null ? '' : ` is-${bar.level}`}${
            bar.before ? ' is-cut-start' : ''
          }${bar.after ? ' is-cut-end' : ''}`
          const style = { gridColumn: `${bar.from + 1} / ${bar.to + 2}` }
          return bar.kind === 'column' ? (
            <span key={bar.key} className={cls} style={style} title={`${bar.label} · ${range}`}>
              <span className="board-cal__label">{bar.label}</span>
              {end}
            </span>
          ) : (
            <button
              key={bar.key}
              className={cls}
              style={style}
              data-path={bar.path ?? undefined}
              title={`${bar.label} · ${range}`}
              onClick={() => bar.path !== null && onOpenCard(bar.path)}
            >
              <span className="board-cal__label">{bar.label}</span>
              {end}
            </button>
          )
        })}
        {bars.length === 0 && <span className="board-cal__empty">Nothing dated in these days.</span>}
      </div>
    </div>
  )
}
