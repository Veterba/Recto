import { doneColumn } from '../boards'
import { priorityCounts } from '../board-view'
import type { WidgetProps } from './registry'

const ROWS = [
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
  { key: 'none', label: 'No priority' },
] as const

/** Open cards per priority. A row filters the board to that priority; again, or the toolbar chip, clears it. */
export function ByPriorityWidget({ board, cards, priority, onFilterPriority }: WidgetProps): React.ReactElement {
  const counts = priorityCounts(cards, doneColumn(board.columns))
  const max = Math.max(1, counts.high, counts.medium, counts.low, counts.none)
  return (
    <ul className="board-pris">
      {ROWS.map(({ key, label }) => (
        <li key={key}>
          <button
            className={`board-pris__row${priority === key ? ' is-on' : ''}`}
            aria-pressed={priority === key}
            onClick={() => onFilterPriority(key)}
          >
            <span className="board-pris__label">{label}</span>
            <span className="board-pris__track" aria-hidden="true">
              {counts[key] > 0 && <i className={`is-${key}`} style={{ width: `${(counts[key] / max) * 100}%` }} />}
            </span>
            <span className="board-pris__n">{counts[key]}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
