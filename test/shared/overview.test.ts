import { describe, expect, it } from 'vitest'
import {
  IDLE_MS,
  activeSeconds,
  addDays,
  averagePerDay,
  compact,
  dayOf,
  duration,
  editsFromSnapshots,
  mergeEdits,
  mergeWords,
  monthsBack,
  moveEdits,
  notesBetween,
  noteWords,
  overdue,
  recordWords,
  rediscover,
  streak,
  todayChange,
  weekStart,
  applyWords,
  mergeWritten,
  wordDiff,
  writtenBetween,
  writtenFromSnapshots,
  writtenOn,
  WORDS_RULE,
  type WordsDay,
} from '../../src/shared/overview'

/** The vault overview's sums: what each figure on the page is made of. */

const days = (...list: string[]): Record<string, string[]> => Object.fromEntries(list.map((d) => [d, ['a.md']]))

describe('days', () => {
  it('weeks start on Monday', () => {
    expect(weekStart('2026-10-18')).toBe('2026-10-12') // a Sunday
    expect(weekStart('2026-10-12')).toBe('2026-10-12')
    expect(weekStart('2026-10-01')).toBe('2026-09-28')
  })
  it('steps across months and daylight saving', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-29', -1)).toBe('2026-03-28')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
  })
  it('a month or a year back, or nothing when that day does not exist', () => {
    expect(monthsBack('2026-10-18', 1)).toBe('2026-09-18')
    expect(monthsBack('2026-10-18', 12)).toBe('2025-10-18')
    expect(monthsBack('2026-01-15', 1)).toBe('2025-12-15')
    expect(monthsBack('2026-03-31', 1)).toBeNull()
    expect(monthsBack('2028-02-29', 12)).toBeNull()
  })
})

describe('writing streak', () => {
  it('counts back from today when today has an edit', () => {
    expect(streak(days('2026-10-16', '2026-10-17', '2026-10-18'), '2026-10-18')).toEqual({ current: 3, longest: 3 })
  })
  it('is not broken by a today not yet written in', () => {
    expect(streak(days('2026-10-16', '2026-10-17'), '2026-10-18')).toEqual({ current: 2, longest: 2 })
  })
  it('is broken by a whole day without', () => {
    expect(streak(days('2026-10-15', '2026-10-16'), '2026-10-18').current).toBe(0)
  })
  it('keeps the longest run ever counted', () => {
    const edits = days('2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-10-18')
    expect(streak(edits, '2026-10-18')).toEqual({ current: 1, longest: 4 })
  })
  it('ignores a day with an empty list', () => {
    expect(streak({ '2026-10-18': [], '2026-10-17': ['a.md'] }, '2026-10-18')).toEqual({ current: 1, longest: 1 })
  })
  it('nothing counted yet is zero, not a failure', () => {
    expect(streak({}, '2026-10-18')).toEqual({ current: 0, longest: 0 })
  })
})

describe('notes touched', () => {
  it('counts each note once over the range', () => {
    const edits = { '2026-10-12': ['a.md', 'b.md'], '2026-10-13': ['a.md'], '2026-10-20': ['c.md'] }
    expect(notesBetween(edits, '2026-10-12', '2026-10-18')).toBe(2)
  })
})

describe('words written: the words you added that day and kept', () => {
  const words = (n: number, from = 0): string => Array.from({ length: n }, (_, i) => `w${from + i}`).join(' ')
  /** A note saved again and again on one day, as the editor does. */
  function note(start: string, day = '2026-10-19') {
    let written = {}
    let text = start
    return {
      save(next: string): void {
        written = applyWords(written, day, 'A.md', wordDiff(text, next))
        text = next
      },
      count: (): number => writtenOn(written, day),
    }
  }

  it('each word typed counts, and each of them deleted again comes off', () => {
    const n = note('')
    n.save('one two three four five six seven eight nine ten')
    expect(n.count()).toBe(10)
    n.save('one two three four five six seven')
    expect(n.count()).toBe(7)
    n.save('one two three four five six seven eight')
    expect(n.count()).toBe(8)
    n.save('')
    expect(n.count()).toBe(0)
  })

  it('paste 500 and delete 800 that were there before: 500 written, never below zero', () => {
    const old = words(800, 1000)
    const n = note(old)
    n.save(`${old} ${words(500)}`)
    n.save(words(500))
    expect(n.count()).toBe(500)
    n.save('')
    expect(n.count()).toBe(0)
  })

  it('a word changed counts one; text moved counts nothing', () => {
    const changed = note('the cat sat')
    changed.save('the dog sat')
    expect(changed.count()).toBe(1)
    const moved = note('one two\n\nthree four')
    moved.save('three four\n\none two')
    expect(moved.count()).toBe(0)
  })

  it("Recto's own writes and other apps' never count: no words in, none out", () => {
    // A board move, a completed stamp: noteEdited without texts sends an empty change.
    expect(applyWords({}, '2026-10-19', 'tasks/Board.md', { added: [], removed: [] })).toEqual({})
    expect(wordDiff('Body.', 'Body.')).toEqual({ added: [], removed: [] })
  })

  it('the week sums its days; two copies of the file merge word by word by the larger, never the sum', () => {
    const written = {
      '2026-10-12': { 'A.md': { a: 100 } },
      '2026-10-14': { 'A.md': { a: 20 }, 'B.md': { b: 30 } },
      '2026-10-20': { 'A.md': { a: 999 } },
    }
    expect(writtenBetween(written, '2026-10-12', '2026-10-18')).toBe(150)
    expect(mergeWritten(written, { '2026-10-14': { 'A.md': { a: 25, c: 1 } } })['2026-10-14']).toEqual({ 'A.md': { a: 25, c: 1 }, 'B.md': { b: 30 } })
    expect(mergeWritten(written, written)).toEqual(written)
  })

  it('read off version history: each version against the one before, only on days the note was yours', () => {
    const at = (day: string, hour: number): number => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).getTime()
    const rows = [
      { path: 'A.md', ts: at('2026-10-18', 9), body: 'first copy the index took' },
      { path: 'A.md', ts: at('2026-10-18', 10), body: 'first copy the index took and five more words here' },
      { path: 'A.md', ts: at('2026-10-18', 11), body: 'first copy the index took and five more' },
      { path: 'A.md', ts: at('2026-10-19', 10), body: 'and five' },
      { path: 'B.md', ts: at('2026-10-19', 9), body: 'other' },
      { path: 'B.md', ts: at('2026-10-19', 11), body: 'other app wrote all of this' },
    ]
    // B changed that day, but not by you: not in edits. A: five typed, two taken back.
    const written = writtenFromSnapshots(rows, { '2026-10-18': ['A.md'], '2026-10-19': ['A.md'] })
    expect(writtenOn(written, '2026-10-18')).toBe(3)
    expect(writtenOn(written, '2026-10-19')).toBe(0)
  })
})

describe("the vault's total words, by rule", () => {
  const w = (start: number, end: number, rule?: number): WordsDay => ({ start, startAt: 1, end, endAt: 2, ...(rule === undefined ? {} : { rule }) })

  it('a count keeps the day’s first and moves its last', () => {
    const once = recordWords({}, '2026-10-18', 1000, 10)
    const twice = recordWords(once, '2026-10-18', 1040, 20)
    expect(twice['2026-10-18']).toEqual({ start: 1000, startAt: 10, end: 1040, endAt: 20, rule: WORDS_RULE })
  })

  it('a day counted under the old rule starts again under the new one: no change between rules', () => {
    // Counted 18,080 under rule 1 this morning; under rule 2 (board notes out) the vault reads 16,700.
    const next = recordWords({ '2026-10-19': w(18_080, 18_100) }, '2026-10-19', 16_700, 30)
    expect(next['2026-10-19']).toEqual({ start: 16_700, startAt: 30, end: 16_700, endAt: 30, rule: WORDS_RULE })
    expect(next['2026-10-19']!.end - next['2026-10-19']!.start).toBe(0)
  })

  it('two copies under different rules: the newer rule stands alone', () => {
    expect(mergeWords({ '2026-10-19': w(100, 120) }, { '2026-10-19': w(90, 95, WORDS_RULE) })['2026-10-19']).toEqual(w(90, 95, WORDS_RULE))
  })
})

describe('time in Recto', () => {
  const now = 1_000_000_000
  it('counts a tick while focused and active in the last two minutes', () => {
    expect(activeSeconds(now, now - 5_000, true, 30_000)).toBe(30)
    expect(activeSeconds(now, now - IDLE_MS, true, 30_000)).toBe(30)
  })
  it('not when idle for longer, or not focused', () => {
    expect(activeSeconds(now, now - IDLE_MS - 1, true, 30_000)).toBe(0)
    expect(activeSeconds(now, now, false, 30_000)).toBe(0)
  })
  it('averages over the days counted, not the whole week', () => {
    const active = { '2026-10-15': 600, '2026-10-16': 1200, '2026-10-17': 0, '2026-10-18': 600 }
    // Counting began Thursday: four days, not seven.
    expect(averagePerDay(active, '2026-10-15', '2026-10-12', '2026-10-18')).toBe(600)
    expect(averagePerDay(active, '2026-10-01', '2026-10-12', '2026-10-18')).toBeCloseTo(2400 / 7)
    expect(averagePerDay(active, '2026-10-19', '2026-10-12', '2026-10-18')).toBeNull()
    expect(averagePerDay(active, null, '2026-10-12', '2026-10-18')).toBeNull()
  })
  it('reads as minutes and hours', () => {
    expect(duration(25 * 60)).toBe('25 min')
    expect(duration(130 * 60)).toBe('2 h 10 min')
    expect(duration(120 * 60)).toBe('2 h')
    expect(duration(0)).toBe('0 min')
  })
})

describe('overdue tasks', () => {
  it('past due and not done', () => {
    const cards = [
      { path: 'a', due: '2026-10-17', done: false },
      { path: 'b', due: '2026-10-17', done: true },
      { path: 'c', due: '2026-10-18', done: false },
      { path: 'd', due: '2026-10-01', done: false },
    ]
    expect(overdue(cards, '2026-10-18').map((c) => c.path)).toEqual(['a', 'd'])
  })
})

describe('rediscover', () => {
  const DAY = 86_400_000
  const now = new Date('2026-10-18T10:00:00').getTime()
  const index = {
    written: [
      { path: 'year.md', name: 'Year', date: '2025-10-18' },
      { path: 'month.md', name: 'Month', date: '2026-09-18' },
    ],
    linked: [
      { path: 'hub.md', name: 'Hub', links: 9 },
      { path: 'old.md', name: 'Old', links: 3 },
    ],
  }

  it('on this day prefers a month ago, then a year ago', () => {
    expect(rediscover(index, {}, now, '2026-10-18', now).onThisDay).toEqual({ path: 'month.md', name: 'Month', ago: 'month' })
    const yearOnly = { ...index, written: [index.written[0]!] }
    expect(rediscover(yearOnly, {}, now, '2026-10-18', now).onThisDay?.ago).toBe('year')
    expect(rediscover({ ...index, written: [] }, {}, now, '2026-10-18', now).onThisDay).toBeNull()
  })
  it('the most linked note not opened for 60 days', () => {
    const opened = { 'hub.md': now - 2 * DAY, 'old.md': now - 75 * DAY }
    expect(rediscover(index, opened, now - 100 * DAY, '2026-10-18', now).unopened).toEqual({ path: 'old.md', name: 'Old', days: 75 })
  })
  it('a note never opened counts from when recording began: nothing until 60 days of it', () => {
    expect(rediscover(index, {}, now - 10 * DAY, '2026-10-18', now).unopened).toBeNull()
    expect(rediscover(index, {}, now - 61 * DAY, '2026-10-18', now).unopened).toEqual({ path: 'hub.md', name: 'Hub', days: 61 })
  })
})

describe('the stats files', () => {
  it('two copies of the edits merge by union', () => {
    const a = { '2026-10-17': ['a.md'], '2026-10-18': ['a.md'] }
    const b = { '2026-10-18': ['b.md', 'a.md'], '2026-10-19': ['c.md'] }
    expect(mergeEdits(a, b)).toEqual({ '2026-10-17': ['a.md'], '2026-10-18': ['a.md', 'b.md'], '2026-10-19': ['c.md'] })
  })
  it('two copies of the words keep the earliest start and the latest end of a day', () => {
    const a = { '2026-10-18': { start: 100, startAt: 5, end: 150, endAt: 50 } }
    const b = { '2026-10-18': { start: 120, startAt: 20, end: 170, endAt: 80 }, '2026-10-17': { start: 1, startAt: 1, end: 2, endAt: 2 } }
    expect(mergeWords(a, b)).toEqual({
      '2026-10-18': { start: 100, startAt: 5, end: 170, endAt: 80 },
      '2026-10-17': { start: 1, startAt: 1, end: 2, endAt: 2 },
    })
  })
  it('a rename moves a note’s days, and a folder’s', () => {
    const edits = { '2026-10-18': ['Notes/a.md', 'Notes/sub/b.md', 'Notes2/c.md'] }
    expect(moveEdits(edits, 'Notes/a.md', 'Notes/z.md')['2026-10-18']).toEqual(['Notes/sub/b.md', 'Notes/z.md', 'Notes2/c.md'])
    expect(moveEdits(edits, 'Notes', 'Old')['2026-10-18']).toEqual(['Notes2/c.md', 'Old/a.md', 'Old/sub/b.md'])
  })
  it('version history gives days with edits, never a note’s first version', () => {
    const at = (s: string): number => new Date(s).getTime()
    const rows = [
      { path: 'a.md', ts: at('2026-10-01T09:00:00') },
      { path: 'a.md', ts: at('2026-10-03T09:00:00') },
      { path: 'b.md', ts: at('2026-10-01T09:00:00') },
      { path: 'a.md', ts: at('2026-10-03T18:00:00') },
    ]
    expect(editsFromSnapshots(rows)).toEqual({ '2026-10-03': ['a.md'] })
  })
})

describe('words in a note', () => {
  it('counts what reads as words: links as their text, embeds and URLs as nothing', () => {
    expect(noteWords('# Title\n\nSome **bold** text, see [[Other note|that one]] and [docs](https://x.y).')).toBe(9)
    expect(noteWords('![[image.png]] https://example.com/a/b <!-- hidden words here -->')).toBe(0)
    expect(noteWords('- [ ] Задача на завтра\n| a | b |')).toBe(5)
  })
})

describe('today’s change', () => {
  it('up, with its period written out', () => {
    expect(todayChange(4)).toEqual({ text: '+4 today', tone: 'up' })
    expect(todayChange(1320)).toEqual({ text: '+1,320 today', tone: 'up' })
  })
  it('down, with a real minus sign', () => {
    expect(todayChange(-120)).toEqual({ text: '−120 today', tone: 'down' })
  })
  it('nothing today is no label at all, never "+0"', () => {
    expect(todayChange(0)).toBeNull()
    expect(todayChange(null)).toBeNull()
  })
  it('words today are what you added, so never below zero', () => {
    const written = { '2026-10-18': { 'A.md': { '#': 1240 } } }
    expect(todayChange(writtenOn(written, '2026-10-18'))).toEqual({ text: '+1,240 today', tone: 'up' })
    expect(todayChange(writtenOn(written, '2026-10-19'))).toBeNull()
  })
})

describe('display', () => {
  it('compacts big totals', () => {
    expect(compact(9_999)).toBe('9,999')
    expect(compact(41_200)).toBe('41.2k')
    expect(compact(41_000)).toBe('41k')
    expect(compact(250_400)).toBe('250k')
  })
  it('days are local', () => {
    expect(dayOf(new Date(2026, 9, 18, 23, 59))).toBe('2026-10-18')
  })
})
