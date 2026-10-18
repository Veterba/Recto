import type { Priority } from '@shared/card-fields'
import type { Board, BoardWidgets } from '../boards'
import type { CardView } from '../board-view'
import { ByPriorityWidget } from './ByPriorityWidget'
import { CalendarWidget } from './CalendarWidget'
import { DoneWeekWidget } from './DoneWeekWidget'
import { DueSoonWidget } from './DueSoonWidget'
import { OverdueWidget } from './OverdueWidget'
import { RecentlyDoneWidget } from './RecentlyDoneWidget'
import { TodayWidget } from './TodayWidget'

/** What every widget is handed: the board, its cards (filters aside), today, and ways to open a card and filter. */
export type WidgetProps = {
  board: Board
  cards: CardView[]
  today: string
  /** The board's priority filter, if one is on. */
  priority: Priority | 'none' | null
  onOpenCard: (path: string) => void
  /** Filter the board to one priority; the same one again clears it. */
  onFilterPriority: (priority: Priority | 'none') => void
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
 * the board note's settings block stores only the ids, so an id this list no
 * longer knows is skipped rather than breaking the board.
 */
export const WIDGETS: readonly WidgetDef[] = [
  {
    id: 'calendar',
    title: 'Calendar',
    description: 'Cards with dates and columns with a date range',
    width: 'wide',
    Component: CalendarWidget,
  },
  { id: 'today', title: 'Today', description: 'Cards today falls inside, or due today', width: 'narrow', Component: TodayWidget },
  { id: 'done-week', title: 'Done this week', description: 'Cards moved to Done, per day', width: 'narrow', Component: DoneWeekWidget },
  { id: 'due-soon', title: 'Due soon', description: 'Due today and the next three days', width: 'narrow', Component: DueSoonWidget },
  { id: 'overdue', title: 'Overdue', description: 'Late cards, the oldest first', width: 'narrow', Component: OverdueWidget },
  { id: 'by-priority', title: 'By priority', description: 'Open cards per priority; click to filter', width: 'narrow', Component: ByPriorityWidget },
  { id: 'recently-done', title: 'Recently done', description: 'The last five cards to enter Done', width: 'narrow', Component: RecentlyDoneWidget },
]

/** A board that has never chosen: the first three, as before more widgets existed. */
export const DEFAULT_WIDGETS: BoardWidgets = { shown: true, list: ['calendar', 'done-week', 'due-soon'] }

export const widgetsOf = (board: Board): BoardWidgets => board.widgets ?? DEFAULT_WIDGETS
