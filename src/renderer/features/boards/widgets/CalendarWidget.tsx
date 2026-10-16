import { useState } from 'react'
import { addDays } from '@shared/card-fields'
import { isoWeek } from '@shared/templates'
import { Icon } from '../../../ui/Icon'
import { mondayOf, spanLabel, weekBars } from '../board-view'
import type { WidgetProps } from './registry'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * A week of the board: each card with dates as a bar across its days, each
 * column with a date range as a dashed bar, a line on today. Arrows move a
 * week at a time; clicking a card's bar opens it in the panel.
 */
export function CalendarWidget({ board, cards, today, onOpenCard }: WidgetProps): React.ReactElement {
  const [monday, setMonday] = useState(() => mondayOf(today))
  const bars = weekBars(cards, board.columns, monday)
  const [y, m, d] = monday.split('-').map(Number)
  const week = isoWeek(new Date(y!, m! - 1, d!)).week
  const todayIndex = [0, 1, 2, 3, 4, 5, 6].find((i) => addDays(monday, i) === today)

  return (
    <div className="board-cal">
      <div className="board-cal__nav">
        <button className="icon-btn" aria-label="Previous week" onClick={() => setMonday(addDays(monday, -7))}>
          <Icon name="chevron-left" size={13} />
        </button>
        <span className="board-cal__week">
          Week {week} · {spanLabel({ from: monday, to: addDays(monday, 6) }, today)}
        </span>
        <button className="icon-btn" aria-label="Next week" onClick={() => setMonday(addDays(monday, 7))}>
          <Icon name="chevron-right" size={13} />
        </button>
        {todayIndex === undefined && (
          <button className="btn btn--ghost btn--sm" onClick={() => setMonday(mondayOf(today))}>
            Today
          </button>
        )}
      </div>
      <div className="board-cal__days">
        {DAY_NAMES.map((name, i) => (
          <span key={name} className={`board-cal__day${i === todayIndex ? ' is-today' : ''}`}>
            {name} {Number(addDays(monday, i).slice(8))}
          </span>
        ))}
      </div>
      <div className="board-cal__bars">
        {todayIndex !== undefined && (
          <span className="board-cal__today" aria-hidden="true" style={{ left: `calc(${todayIndex} / 7 * 100% + 100% / 14)` }} />
        )}
        {bars.map((bar) =>
          bar.kind === 'column' ? (
            <span key={bar.key} className="board-cal__bar is-column" style={{ gridColumn: `${bar.from + 1} / ${bar.to + 2}` }}>
              {bar.label}
            </span>
          ) : (
            <button
              key={bar.key}
              className={`board-cal__bar${bar.level === null ? '' : ` is-${bar.level}`}${bar.before ? ' is-cut-start' : ''}${bar.after ? ' is-cut-end' : ''}`}
              style={{ gridColumn: `${bar.from + 1} / ${bar.to + 2}` }}
              data-path={bar.path ?? undefined}
              title={bar.label}
              onClick={() => bar.path !== null && onOpenCard(bar.path)}
            >
              {bar.label}
            </button>
          ),
        )}
        {bars.length === 0 && <span className="board-cal__empty">Nothing dated this week.</span>}
      </div>
    </div>
  )
}
