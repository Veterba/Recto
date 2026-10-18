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
import type { Column } from '../../../../src/renderer/features/boards/boards'

const columns: Column[] = [
  { id: '0', index: 0, name: 'To do', start: '2026-10-14', due: '2026-10-25' },
  { id: '1', index: 1, name: 'Done', done: true },
]
const DONE = '1'

const row = (over: Partial<BoardCardInfo>): BoardCardInfo => ({
  path: `tasks/${over.title ?? 'x'}.md`,
  title: 'x',
  description: '',
  start: null,
  due: null,
  completed: null,
  priority: null,
  tags: null,
  checklist: { done: 0, total: 0 },
  links: 0,
  ...over,
})
let next = 0
/** A card that is a note, in a column (the first by default), at a place in it (in the order made by default). */
const card = (over: Partial<BoardCardInfo> & { column?: string; index?: number }): ReturnType<typeof toView> => {
  const { column = '0', index = next++, ...fields } = over
  const title = fields.title ?? 'x'
  return toView({ text: `[[${title}]]`, link: title, raw: `- [ ] [[${title}]]` }, row(fields), columns[Number(column)]!, index)
}

describe('cards on the board', () => {
  it('reads the fields once: priority, span, tags, completed day', () => {
    const view = card({
      column: DONE,
      priority: 'High',
      start: '2026-10-20',
      due: '2026-10-16T08:00',
      tags: 'ui,#docs',
      completed: '2026-10-15T10:00',
    })
    expect(view.column).toBe(DONE)
    expect(view.key).toBe('tasks/x.md')
    expect(view.level).toBe('high')
    expect(view.span).toEqual({ from: '2026-10-16', to: '2026-10-16' })
    expect(view.tagList).toEqual(['ui', 'docs'])
    expect(view.completedDay).toBe('2026-10-15')
  })

  it('a line of text is a card too: its first line the title, the rest its description', () => {
    const view = toView({ text: 'Buy stamps\nat the post office', link: null, raw: '- [ ] Buy stamps\n    at the post office' }, null, columns[0]!, 3)
    expect(view).toMatchObject({ light: true, title: 'Buy stamps', description: 'at the post office', path: '', key: 'text:0:3', level: null })
    // A link to a note that is not there yet is drawn with its name until it is.
    expect(toView({ text: '[[Later/Not yet]]', link: 'Later/Not yet', raw: '- [ ] [[Later/Not yet]]' }, null, columns[0]!, 0)).toMatchObject({
      light: false,
      title: 'Not yet',
      key: 'link:0:0',
    })
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

  it("sorts by priority, due date or title; manual keeps the board file's order", () => {
    const cards = [
      card({ title: 'c', index: 2, priority: 'high' }),
      card({ title: 'b', index: 0, priority: 'low', due: '2026-10-20' }),
      card({ title: 'a', index: 1, due: '2026-10-18' }),
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
      card({ title: 'e', column: DONE }),
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
    card({ title: 'finished', due: '2026-10-15', column: DONE }),
  ]

  it('due soon is today and the next three days, soonest first, without late or finished ones', () => {
    expect(dueSoon(dated, '2026-10-16', DONE).map((c) => c.title)).toEqual(['today', 'spanning', 'in three days'])
  })

  it('overdue is the late ones, the oldest first', () => {
    expect(overdue(dated, '2026-10-16', DONE).map((c) => c.title)).toEqual(['older', 'late'])
  })

  it('today is every open card today falls inside, highest priority first', () => {
    expect(todayCards(dated, '2026-10-16', DONE).map((c) => c.title)).toEqual(['spanning', 'today'])
  })

  it('counts open cards per priority', () => {
    expect(priorityCounts(dated, DONE)).toEqual({ high: 1, medium: 0, low: 1, none: 4 })
  })

  it('recently done is the last five to get a completed date, newest first', () => {
    const cards = ['01', '03', '02', '06', '05', '04'].map((d) => card({ title: `d${d}`, column: DONE, completed: `2026-10-${d}` }))
    cards.push(card({ title: 'open' }))
    cards.push(card({ title: 'same day, later', column: DONE, completed: '2026-10-06T18:00' }))
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
