import type { Board, BoardWidgets } from '../boards'
import type { CardView } from '../board-view'
import { CalendarWidget } from './CalendarWidget'
import { DoneWeekWidget } from './DoneWeekWidget'
import { DueSoonWidget } from './DueSoonWidget'

/** What every widget is handed: the board, its cards (filters aside), today, and a way to open a card. */
export type WidgetProps = {
  board: Board
  cards: CardView[]
  today: string
  onOpenCard: (path: string) => void
}

export type WidgetDef = {
  id: string
  title: string
  /** One line in the "+ Widget" menu. */
  description: string
  /** How wide it sits in the strip. */
  width: 'wide' | 'narrow'
  Component: (props: WidgetProps) => React.ReactElement
}

/**
 * The widgets a board can show. A new one is a component and an entry here;
 * boards.json stores only the ids, so an id this list no longer knows is
 * skipped rather than breaking the board.
 */
export const WIDGETS: readonly WidgetDef[] = [
  {
    id: 'calendar',
    title: 'Calendar',
    description: 'The week: cards with dates and columns with a date range',
    width: 'wide',
    Component: CalendarWidget,
  },
  { id: 'done-week', title: 'Done this week', description: 'Cards moved to Done, per day', width: 'narrow', Component: DoneWeekWidget },
  { id: 'due-soon', title: 'Due soon', description: 'Late cards and the next three days', width: 'narrow', Component: DueSoonWidget },
]

/** A board that has never chosen: every widget, shown. */
export const DEFAULT_WIDGETS: BoardWidgets = { shown: true, list: WIDGETS.map((w) => w.id) }

export const widgetsOf = (board: Board): BoardWidgets => board.widgets ?? DEFAULT_WIDGETS
