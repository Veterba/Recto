import { describe, expect, it } from 'vitest'
import type { BoardCardInfo } from '../../../../src/shared/index-results'
import {
  doneThisWeek,
  dueSoon,
  filterCards,
  mondayOf,
  sortCards,
  spanLabel,
  toView,
  weekBars,
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

  it('filters by words in the title or description, and by High only', () => {
    const cards = [
      card({ title: 'Glass columns', priority: 'high' }),
      card({ title: 'Panel', description: 'glass sheet' }),
      card({ title: 'Other' }),
    ]
    expect(filterCards(cards, { query: 'glass', highOnly: false }).map((c) => c.title)).toEqual(['Glass columns', 'Panel'])
    expect(filterCards(cards, { query: 'glass', highOnly: true }).map((c) => c.title)).toEqual(['Glass columns'])
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
    const bars = weekBars(
      [
        card({ title: 'One day', due: '2026-10-16' }),
        card({ title: 'Range', start: '2026-10-13', due: '2026-10-15', priority: 'high' }),
        card({ title: 'Long', start: '2026-10-08', due: '2026-10-30' }),
        card({ title: 'Next week', due: '2026-10-20' }),
        card({ title: 'Undated' }),
      ],
      columns,
      monday,
    )
    expect(bars.map((b) => [b.label, b.from, b.to, b.before, b.after])).toEqual([
      ['Column: To do', 2, 6, false, true],
      ['Long', 0, 6, true, true],
      ['Range', 1, 3, false, false],
      ['One day', 4, 4, false, false],
    ])
    expect(bars.find((b) => b.label === 'Range')).toMatchObject({ kind: 'card', level: 'high', path: 'tasks/Range.md' })
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

  it('lists late cards and the next three days, soonest first, without finished ones', () => {
    const cards = [
      card({ title: 'later', due: '2026-10-20' }),
      card({ title: 'late', due: '2026-10-10' }),
      card({ title: 'in three days', due: '2026-10-19' }),
      card({ title: 'today', due: '2026-10-16' }),
      card({ title: 'finished', due: '2026-10-15', status: 'done' }),
    ]
    expect(dueSoon(cards, '2026-10-16', 'done').map((c) => c.title)).toEqual(['late', 'today', 'in three days'])
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
