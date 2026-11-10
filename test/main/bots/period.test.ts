import { describe, expect, it } from 'vitest'
import { periodFrom } from '../../../src/main/bots/period'

// Wednesday 30 September 2026, as in the eval fixture.
const today = new Date(2026, 8, 30)
const p = (text: string): string | null => {
  const r = periodFrom(text, today)
  return r === null ? null : `${r.from}..${r.to}`
}

describe('time words to a period', () => {
  it('weeks run Monday to Sunday', () => {
    expect(p('what did I do last week')).toBe('2026-09-21..2026-09-27')
    expect(p('что я не доделал с прошлой недели')).toBe('2026-09-21..2026-09-27')
    expect(p('hva gjorde jeg forrige uke')).toBe('2026-09-21..2026-09-27')
    expect(p('what is open this week')).toBe('2026-09-28..2026-09-30')
    expect(p('что нового на этой неделе')).toBe('2026-09-28..2026-09-30')
  })

  it('a weekday is the most recent one before today; "since" runs to today', () => {
    expect(p("What's still open from Wednesday?")).toBe('2026-09-23..2026-09-23')
    expect(p('anything new since Monday?')).toBe('2026-09-28..2026-09-30')
    expect(p('What did I do on Wednesday last week?')).toBe('2026-09-23..2026-09-23')
    expect(p('что я делал в пятницу на прошлой неделе')).toBe('2026-09-25..2026-09-25')
    expect(p('what did I do on Thursday')).toBe('2026-09-24..2026-09-24')
    expect(p('что было в среду')).toBe('2026-09-23..2026-09-23')
    expect(p('Что нового в Lark с понедельника?')).toBe('2026-09-28..2026-09-30')
    expect(p('со среды')).toBe('2026-09-23..2026-09-30')
  })

  it('looking ahead: tomorrow, the day after, next week, and a weekday still to come', () => {
    // Wednesday 30 September.
    expect(p('what do I have tomorrow')).toBe('2026-10-01..2026-10-01')
    expect(p('что у меня послезавтра')).toBe('2026-10-02..2026-10-02')
    expect(p('tasks for next week')).toBe('2026-10-05..2026-10-11')
    expect(p('что запланировано на следующей неделе')).toBe('2026-10-05..2026-10-11')
    expect(p('What do I have on Friday?')).toBe('2026-10-02..2026-10-02')
    expect(p('what is planned for Monday')).toBe('2026-10-05..2026-10-05')
    expect(p('hva skal jeg gjøre på fredag')).toBe('2026-10-02..2026-10-02')
    // Asked about what was: still the one before today.
    expect(p('what did I have on Friday')).toBe('2026-09-25..2026-09-25')
  })

  it('«с» is "since" only right before the day: «в среду с Колей» is one Wednesday', () => {
    expect(p('что я обсуждал в среду с Колей')).toBe('2026-09-23..2026-09-23')
    expect(p('что нового с понедельника')).toBe('2026-09-28..2026-09-30')
  })

  it('yesterday, today, last N days, explicit dates', () => {
    expect(p('yesterday')).toBe('2026-09-29..2026-09-29')
    expect(p('что я делал вчера')).toBe('2026-09-29..2026-09-29')
    expect(p('i dag')).toBe('2026-09-30..2026-09-30')
    expect(p('the last 3 days')).toBe('2026-09-28..2026-09-30')
    expect(p('what happened on 2026-09-23')).toBe('2026-09-23..2026-09-23')
    expect(p('что было 23 сентября')).toBe('2026-09-23..2026-09-23')
    expect(p('notes from September 17')).toBe('2026-09-17..2026-09-17')
  })

  it('nothing when there are no time words', () => {
    expect(p('What is the ratio for my sourdough starter?')).toBeNull()
    expect(p('Какие задачи у меня просрочены?')).toBeNull()
    expect(p('мая')).toBeNull()
    expect(p('may I ask something')).toBeNull()
    expect(p('что было 5 мая')).toBe('2026-05-05..2026-05-05')
  })
})

describe('this and last week', () => {
  it('runs from last week’s Monday to today', () => {
    const sat = new Date(2026, 9, 3, 12)
    expect(periodFrom('Посмотри все задачи что я не сделал на это и прошлой неделе', sat)).toEqual({ from: '2026-09-21', to: '2026-10-03' })
    expect(periodFrom('tasks from this and last week', sat)).toEqual({ from: '2026-09-21', to: '2026-10-03' })
  })
})
