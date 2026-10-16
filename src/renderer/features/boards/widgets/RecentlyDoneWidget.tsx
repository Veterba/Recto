import { recentlyDone, spanLabel } from '../board-view'
import { CardList } from './CardList'
import type { WidgetProps } from './registry'

/** The last five cards to enter Done, by the `completed` date written when they did. */
export function RecentlyDoneWidget({ cards, today, onOpenCard }: WidgetProps): React.ReactElement {
  return (
    <CardList
      cards={recentlyDone(cards)}
      empty="Nothing done yet."
      today={today}
      onOpenCard={onOpenCard}
      when={(card) => spanLabel({ from: card.completedDay!, to: card.completedDay! }, today)}
    />
  )
}
