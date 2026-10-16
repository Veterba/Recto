import { dueState, spanLabel, type CardView } from '../board-view'

/**
 * A short list of cards, each a button that opens it: the priority mark, the
 * title, and on the right whatever the widget wants said about it.
 */
export function CardList({
  cards,
  empty,
  today,
  onOpenCard,
  when,
}: {
  cards: CardView[]
  empty: string
  today: string
  onOpenCard: (path: string) => void
  /** The right-hand words; by default the card's due day. */
  when?: (card: CardView) => string
}): React.ReactElement {
  if (cards.length === 0) return <p className="board-due__empty">{empty}</p>
  return (
    <ul className="board-due">
      {cards.map((card) => {
        const state = dueState(card.span, today)
        return (
          <li key={card.path}>
            <button className="board-due__item" title={card.title} onClick={() => onOpenCard(card.path)}>
              <span className={`board-due__mark${card.level === null ? '' : ` is-${card.level}`}`} aria-hidden="true" />
              <span className="board-due__title">{card.title}</span>
              <span className={`board-due__when${state === null || when !== undefined ? '' : ` is-${state}`}`}>
                {when !== undefined ? when(card) : card.span === null ? '' : spanLabel({ from: card.span.to, to: card.span.to }, today)}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
