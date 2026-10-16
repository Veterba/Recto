import { doneColumn } from '../boards'
import { dueSoon } from '../board-view'
import { CardList } from './CardList'
import type { WidgetProps } from './registry'

/** Unfinished cards due today or in the next three days, soonest first. Late ones are under Overdue. */
export function DueSoonWidget({ board, cards, today, onOpenCard }: WidgetProps): React.ReactElement {
  return (
    <CardList
      cards={dueSoon(cards, today, doneColumn(board.columns))}
      empty="Nothing due in three days."
      today={today}
      onOpenCard={onOpenCard}
    />
  )
}
