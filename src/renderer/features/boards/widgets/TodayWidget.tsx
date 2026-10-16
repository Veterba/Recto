import { doneColumn } from '../boards'
import { spanLabel, todayCards } from '../board-view'
import { CardList } from './CardList'
import type { WidgetProps } from './registry'

/** Unfinished cards today falls inside - between start and due, or due today. */
export function TodayWidget({ board, cards, today, onOpenCard }: WidgetProps): React.ReactElement {
  return (
    <CardList
      cards={todayCards(cards, today, doneColumn(board.columns))}
      empty="Nothing on for today."
      today={today}
      onOpenCard={onOpenCard}
      when={(card) => (card.span!.to === today ? 'Due today' : `until ${spanLabel({ from: card.span!.to, to: card.span!.to }, today)}`)}
    />
  )
}
