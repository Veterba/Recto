import { doneColumn } from '../boards'
import { dueSoon, dueState, spanLabel } from '../board-view'
import type { WidgetProps } from './registry'

/** Unfinished cards that are late or due in the next three days, soonest first. */
export function DueSoonWidget({ board, cards, today, onOpenCard }: WidgetProps): React.ReactElement {
  const list = dueSoon(cards, today, doneColumn(board.columns))
  if (list.length === 0) return <p className="board-due__empty">Nothing late or due in the next three days.</p>
  return (
    <ul className="board-due">
      {list.map((card) => {
        const state = dueState(card.span, today)
        return (
          <li key={card.path}>
            <button className="board-due__item" onClick={() => onOpenCard(card.path)}>
              <span className={`board-due__mark${card.level === null ? '' : ` is-${card.level}`}`} aria-hidden="true" />
              <span className="board-due__title">{card.title}</span>
              <span className={`board-due__when${state === null ? '' : ` is-${state}`}`}>
                {state === 'late' ? 'Late · ' : ''}
                {spanLabel({ from: card.span!.to, to: card.span!.to }, today)}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
