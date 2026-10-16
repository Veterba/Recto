import { describe, expect, it } from 'vitest'
import type { BoardCardInfo } from '../../../../src/shared/index-results'
import {
  calendarBars,
  doneThisWeek,
  dueSoon,
  filterCards,
  mondayOf,
  overdue,
  priorityCounts,
  recentlyDone,
  sortCards,
  spanLabel,
  stepView,
  todayCards,
  toView,
  viewDays,
  viewStart,
} from '../../../../src/renderer/features/boards/board-view'
import { UNKNOWN_COLUMN } from '../../../../src/renderer/features/boards/boards'

const columns = [
  { id: 'todo', name: 'To do', start: '2026-10-14', due: '2026-10-25' },
  { id: 'done', name: 'Done' },
]

const row = (over: Partial<BoardCardInfo>): BoardCardInfo => ({
  path: `tasks/${over.title ?? 'x'}.md`,
  title: 'x',
  description: '',
  status: 'todo',
  order: null,
  start: null,
  due: null,
  completed: null,
  priority: null,
  tags: null,
  checklist: { done: 0, total: 0 },
  links: 0,
  ...over,
})
const card = (over: Partial<BoardCardInfo>): ReturnType<typeof toView> => toView(row(over), columns)

describe('cards on the board', () => {
  it('reads the fields once: column, priority, span, tags, completed day', () => {
    const view = card({
      status: 'lost',
      priority: 'High',
      start: '2026-10-20',
      due: '2026-10-16T08:00',
      tags: 'ui,#docs',
      completed: '2026-10-15T10:00',
    })
    expect(view.column).toBe(UNKNOWN_COLUMN)
    expect(view.level).toBe('high')
    expect(view.span).toEqual({ from: '2026-10-16', to: '2026-10-16' })
    expect(view.tagList).toEqual(['ui', 'docs'])
    expect(view.completedDay).toBe('2026-10-15')
  })

  it('filters by words in the title or description, and by one priority', () => {
    const cards = [
      card({ title: 'Glass columns', priority: 'high' }),
      card({ title: 'Panel', description: 'glass sheet' }),
      card({ title: 'Other', priority: 'medium' }),
    ]
    expect(filterCards(cards, { query: 'glass', priority: null }).map((c) => c.title)).toEqual(['Glass columns', 'Panel'])
    expect(filterCards(cards, { query: 'glass', priority: 'high' }).map((c) => c.title)).toEqual(['Glass columns'])
    expect(filterCards(cards, { query: '', priority: 'medium' }).map((c) => c.title)).toEqual(['Other'])
    expect(filterCards(cards, { query: '', priority: 'none' }).map((c) => c.title)).toEqual(['Panel'])
  })

  it('sorts by priority, due date or title; manual keeps the dragged order', () => {
    const cards = [
      card({ title: 'b', order: 1, priority: 'low', due: '2026-10-20' }),
      card({ title: 'a', order: 2, due: '2026-10-18' }),
      card({ title: 'c', order: 3, priority: 'high' }),
    ]
    expect(sortCards(cards, 'manual').map((c) => c.title)).toEqual(['b', 'a', 'c'])
    expect(sortCards(cards, 'priority').map((c) => c.title)).toEqual(['c', 'b', 'a'])
    expect(sortCards(cards, 'due').map((c) => c.title)).toEqual(['a', 'b', 'c'])
    expect(sortCards(cards, 'title').map((c) => c.title)).toEqual(['a', 'b', 'c'])
  })
})

describe('the calendar', () => {
  const monday = '2026-10-12'

  it('finds the Monday of a week', () => {
    expect(mondayOf('2026-10-16')).toBe(monday)
    expect(mondayOf('2026-10-12')).toBe(monday)
    expect(mondayOf('2026-10-18')).toBe(monday)
  })

  it('places a single day, a range, a range cut by the week, and a column range', () => {
    const bars = calendarBars(
      [
        card({ title: 'One day', due: '2026-10-16' }),
        card({ title: 'Range', start: '2026-10-13', due: '2026-10-15', priority: 'high' }),
        card({ title: 'Long', start: '2026-10-08', due: '2026-10-30' }),
        card({ title: 'Next week', due: '2026-10-20' }),
        card({ title: 'Undated' }),
      ],
      columns,
      monday,
      7,
    )
    expect(bars.map((b) => [b.label, b.from, b.to, b.before, b.after])).toEqual([
      ['Column: To do', 2, 6, false, true],
      ['Long', 0, 6, true, true],
      ['Range', 1, 3, false, false],
      ['One day', 4, 4, false, false],
    ])
    expect(bars.find((b) => b.label === 'Range')).toMatchObject({ kind: 'card', level: 'high', path: 'tasks/Range.md' })
    // A bar cut by the week still knows its whole range, for the end arrow and the hover.
    expect(bars.find((b) => b.label === 'Long')?.span).toEqual({ from: '2026-10-08', to: '2026-10-30' })
  })

  it('a range crossing weeks is cut differently in each, and whole in a month', () => {
    const cards = [card({ title: 'Across', start: '2026-10-16', due: '2026-10-21' })]
    const [thisWeek] = calendarBars(cards, [], '2026-10-12', 7)
    const [nextWeek] = calendarBars(cards, [], '2026-10-19', 7)
    const [twoWeeks] = calendarBars(cards, [], '2026-10-12', 14)
    const [month] = calendarBars(cards, [], '2026-10-01', 31)
    expect([thisWeek!.from, thisWeek!.to, thisWeek!.before, thisWeek!.after]).toEqual([4, 6, false, true])
    expect([nextWeek!.from, nextWeek!.to, nextWeek!.before, nextWeek!.after]).toEqual([0, 2, true, false])
    expect([twoWeeks!.from, twoWeeks!.to, twoWeeks!.after]).toEqual([4, 9, false])
    expect([month!.from, month!.to]).toEqual([15, 20])
    expect(calendarBars(cards, [], '2026-10-26', 7)).toEqual([])
  })

  it('views: a week or two from a Monday, a month from its 1st; arrows step a whole view', () => {
    expect(viewStart('week', '2026-10-16')).toBe('2026-10-12')
    expect(viewStart('2weeks', '2026-10-16')).toBe('2026-10-12')
    expect(viewStart('month', '2026-10-16')).toBe('2026-10-01')
    expect(viewDays('week', '2026-10-12')).toBe(7)
    expect(viewDays('2weeks', '2026-10-12')).toBe(14)
    expect(viewDays('month', '2026-02-01')).toBe(28)
    expect(stepView('week', '2026-10-12', 1)).toBe('2026-10-19')
    expect(stepView('week', '2026-10-12', -1)).toBe('2026-10-05')
    expect(stepView('2weeks', '2026-10-12', 1)).toBe('2026-10-26')
    expect(stepView('month', '2026-10-01', 1)).toBe('2026-11-01')
    expect(stepView('month', '2026-12-01', 1)).toBe('2027-01-01')
    expect(stepView('month', '2026-01-01', -1)).toBe('2025-12-01')
    // A month dragged off its 1st steps to the next month's 1st, not 31 days on.
    expect(stepView('month', '2026-10-05', 1)).toBe('2026-11-01')
  })
})

describe('done this week and due soon', () => {
  it('counts cards by the day they entered Done, this week only', () => {
    const cards = [
      card({ title: 'a', completed: '2026-10-12' }),
      card({ title: 'b', completed: '2026-10-16T09:00' }),
      card({ title: 'c', completed: '2026-10-16' }),
      card({ title: 'd', completed: '2026-10-09' }),
      card({ title: 'e', status: 'done' }),
    ]
    expect(doneThisWeek(cards, '2026-10-16')).toEqual({ total: 3, perDay: [1, 0, 0, 0, 2, 0, 0] })
  })

  const dated = [
    card({ title: 'later', due: '2026-10-20' }),
    card({ title: 'late', due: '2026-10-10' }),
    card({ title: 'older', start: '2026-10-01', due: '2026-10-05' }),
    card({ title: 'in three days', due: '2026-10-19' }),
    card({ title: 'today', due: '2026-10-16', priority: 'low' }),
    card({ title: 'spanning', start: '2026-10-14', due: '2026-10-18', priority: 'high' }),
    card({ title: 'finished', due: '2026-10-15', status: 'done' }),
  ]

  it('due soon is today and the next three days, soonest first, without late or finished ones', () => {
    expect(dueSoon(dated, '2026-10-16', 'done').map((c) => c.title)).toEqual(['today', 'spanning', 'in three days'])
  })

  it('overdue is the late ones, the oldest first', () => {
    expect(overdue(dated, '2026-10-16', 'done').map((c) => c.title)).toEqual(['older', 'late'])
  })

  it('today is every open card today falls inside, highest priority first', () => {
    expect(todayCards(dated, '2026-10-16', 'done').map((c) => c.title)).toEqual(['spanning', 'today'])
  })

  it('counts open cards per priority', () => {
    expect(priorityCounts(dated, 'done')).toEqual({ high: 1, medium: 0, low: 1, none: 4 })
  })

  it('recently done is the last five to get a completed date, newest first', () => {
    const cards = ['01', '03', '02', '06', '05', '04'].map((d) => card({ title: `d${d}`, status: 'done', completed: `2026-10-${d}` }))
    cards.push(card({ title: 'open' }))
    cards.push(card({ title: 'same day, later', status: 'done', completed: '2026-10-06T18:00' }))
    expect(recentlyDone(cards).map((c) => c.title)).toEqual(['same day, later', 'd06', 'd05', 'd04', 'd03'])
  })
})

describe("a card's dates as words", () => {
  it('a day, a range in a month, across months, and another year', () => {
    const today = '2026-10-16'
    expect(spanLabel({ from: '2026-10-16', to: '2026-10-16' }, today)).toBe('16 Oct')
    expect(spanLabel({ from: '2026-10-12', to: '2026-10-16' }, today)).toBe('12–16 Oct')
    expect(spanLabel({ from: '2026-09-28', to: '2026-10-02' }, today)).toBe('28 Sep – 2 Oct')
    expect(spanLabel({ from: '2026-12-30', to: '2027-01-03' }, today)).toBe('30 Dec – 3 Jan 2027')
  })
})
