import { doneColumn } from '../boards'
import { overdue, spanLabel } from '../board-view'
import { CardList } from './CardList'
import type { WidgetProps } from './registry'

/** Unfinished cards past their last day, the oldest first. */
export function OverdueWidget({ board, cards, today, onOpenCard }: WidgetProps): React.ReactElement {
  return (
    <CardList
      cards={overdue(cards, today, doneColumn(board.columns))}
      empty="Nothing late."
      today={today}
      onOpenCard={onOpenCard}
      when={(card) => spanLabel({ from: card.span!.to, to: card.span!.to }, today)}
    />
  )
}
