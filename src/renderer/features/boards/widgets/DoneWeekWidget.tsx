import { doneThisWeek } from '../board-view'
import type { WidgetProps } from './registry'

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * How many cards went to Done this week, and on which days - counted from
 * each card's `completed` date, which is written when it enters Done.
 */
export function DoneWeekWidget({ cards, today }: WidgetProps): React.ReactElement {
  const { total, perDay } = doneThisWeek(cards, today)
  const max = Math.max(1, ...perDay)
  const todayIndex = (new Date(`${today}T12:00`).getDay() + 6) % 7
  return (
    <div className="board-done">
      <p className="board-done__big">
        {total} <small>{total === 1 ? 'card' : 'cards'} done</small>
      </p>
      <div className="board-done__chart" role="img" aria-label={`Done per day: ${perDay.join(', ')}`}>
        {perDay.map((n, i) => (
          <span key={i} className="board-done__col">
            <i className={i === todayIndex ? 'is-today' : ''} style={{ height: `${(n / max) * 100}%` }} title={`${n}`} />
            <span>{DAY_LETTERS[i]}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
