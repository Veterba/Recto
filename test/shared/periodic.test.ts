import { describe, expect, it } from 'vitest'
import { folderLayout, nameTakenElsewhere, parentLink, pathTree, periodNotePath, todayPeriod } from '../../src/shared/periodic'
import {
  DEFAULT_TEMPLATE_SETTINGS,
  fillTemplate,
  periodKey,
  periodicFolders,
  weekRange,
  type Period,
  type PeriodicSettings,
} from '../../src/shared/templates'

/** Friday 9 October 2026: ISO week 41, Thursday 8 October. */
const day = new Date(2026, 9, 9, 10, 0)

function settings(on: readonly Period[], patch: Partial<PeriodicSettings> = {}): PeriodicSettings {
  const base = DEFAULT_TEMPLATE_SETTINGS.periodic
  const period = (p: Period): PeriodicSettings[Period] => ({ ...base[p], enabled: on.includes(p) })
  return {
    ...base,
    folder: 'Journal',
    daily: period('daily'),
    weekly: period('weekly'),
    monthly: period('monthly'),
    yearly: period('yearly'),
    ...patch,
  }
}

const paths = (s: PeriodicSettings, date = day): Partial<Record<Period, string>> =>
  Object.fromEntries(
    (['yearly', 'monthly', 'weekly', 'daily'] as const).filter((p) => s[p].enabled).map((p) => [p, periodNotePath(p, date, s).path]),
  )

describe('folder layout', () => {
  it('a month folder only when it holds more than the month note; a week folder only with daily notes', () => {
    const at = (on: Period[], group = false): { month: boolean; week: boolean } => folderLayout(new Set(on), group)
    expect(at(['monthly'])).toEqual({ month: false, week: false })
    expect(at(['weekly'])).toEqual({ month: false, week: false })
    expect(at(['weekly'], true)).toEqual({ month: true, week: false })
    expect(at(['weekly', 'monthly'])).toEqual({ month: true, week: false })
    expect(at(['yearly', 'monthly'])).toEqual({ month: false, week: false })
    expect(at(['monthly'], true)).toEqual({ month: false, week: false })
    expect(at(['daily'])).toEqual({ month: true, week: true })
    expect(at(['daily', 'weekly', 'monthly', 'yearly'])).toEqual({ month: true, week: true })
  })

  it('monthly only', () => {
    expect(paths(settings(['monthly']))).toEqual({ monthly: 'Journal/2026/2026-10.md' })
  })

  it('weekly only, and with group by month', () => {
    expect(paths(settings(['weekly']))).toEqual({ weekly: 'Journal/2026/2026-W41.md' })
    expect(paths(settings(['weekly'], { groupByMonth: true }))).toEqual({ weekly: 'Journal/2026/10/2026-W41.md' })
  })

  it('monthly and weekly share the month folder', () => {
    expect(paths(settings(['monthly', 'weekly']))).toEqual({
      monthly: 'Journal/2026/10/2026-10.md',
      weekly: 'Journal/2026/10/2026-W41.md',
    })
  })

  it('yearly only, and yearly with monthly', () => {
    expect(paths(settings(['yearly']))).toEqual({ yearly: 'Journal/2026/2026.md' })
    expect(paths(settings(['yearly', 'monthly']))).toEqual({ yearly: 'Journal/2026/2026.md', monthly: 'Journal/2026/2026-10.md' })
  })

  it('all on', () => {
    expect(paths(settings(['daily', 'weekly', 'monthly', 'yearly']))).toEqual({
      yearly: 'Journal/2026/2026.md',
      monthly: 'Journal/2026/10/2026-10.md',
      weekly: 'Journal/2026/10/W41/2026-W41.md',
      daily: 'Journal/2026/10/W41/2026-10-09.md',
    })
  })

  it('daily only stays exactly where it always went', () => {
    expect(paths(settings(['daily']))).toEqual({ daily: 'Journal/2026/10/W41/2026-10-09.md' })
    expect(periodNotePath('daily', new Date(2025, 11, 29), settings(['daily'])).folder).toBe('Journal/2025/12/W01')
  })

  it('a period with a separate folder lays itself out there as if it were alone', () => {
    const s = settings(['daily', 'weekly', 'monthly'], { monthly: { enabled: true, template: null, folder: 'Months' } })
    expect(paths(s)).toEqual({
      monthly: 'Months/2026/2026-10.md',
      weekly: 'Journal/2026/10/W41/2026-W41.md',
      daily: 'Journal/2026/10/W41/2026-10-09.md',
    })
    expect(periodicFolders(s)).toEqual(['Journal', 'Months'])
  })
})

describe('ISO weeks', () => {
  it('a week belongs to the year and month of its Thursday', () => {
    // 2026 has 53 ISO weeks (it starts on a Thursday): the week of 29 December 2026
    // is 2026-W53, and 2027-W01 starts on Monday 4 January 2027.
    expect(periodKey('weekly', new Date(2026, 11, 29))).toBe('2026-W53')
    expect(periodKey('weekly', new Date(2027, 0, 1))).toBe('2026-W53')
    expect(periodKey('weekly', new Date(2027, 0, 4))).toBe('2027-W01')
    // Monday 29 December 2025 starts 2026-W01: its Thursday is 1 January 2026.
    const s = settings(['weekly', 'monthly'])
    expect(periodNotePath('weekly', new Date(2025, 11, 29), s).path).toBe('Journal/2026/01/2026-W01.md')
    expect(periodNotePath('weekly', new Date(2025, 11, 31), s).path).toBe('Journal/2026/01/2026-W01.md')
  })

  it("a week across a month boundary goes to its Thursday's month", () => {
    const s = settings(['weekly', 'monthly'])
    // Monday 28 September 2026 - Sunday 4 October: Thursday 1 October.
    expect(periodNotePath('weekly', new Date(2026, 8, 28), s).path).toBe('Journal/2026/10/2026-W40.md')
    // Monday 26 October - Sunday 1 November: Thursday 29 October.
    expect(periodNotePath('weekly', new Date(2026, 10, 1), s).path).toBe('Journal/2026/10/2026-W44.md')
  })

  it('a week that starts in December and has its Thursday in January belongs to the new year', () => {
    // Monday 31 December 2029 starts 2030-W01.
    expect(periodNotePath('weekly', new Date(2029, 11, 31), settings(['weekly'])).path).toBe('Journal/2030/2030-W01.md')
  })
})

describe('links up the chain', () => {
  it('to the nearest period that is on', () => {
    expect(parentLink('daily', day, settings(['daily', 'weekly', 'monthly', 'yearly']))).toEqual({ key: 'week', value: '[[2026-W41]]' })
    expect(parentLink('daily', day, settings(['daily', 'monthly']))).toEqual({ key: 'month', value: '[[2026-10]]' })
    expect(parentLink('daily', day, settings(['daily', 'yearly']))).toEqual({ key: 'year', value: '[[2026]]' })
    expect(parentLink('daily', day, settings(['daily']))).toBe(null)
    expect(parentLink('monthly', day, settings(['monthly', 'yearly']))).toEqual({ key: 'year', value: '[[2026]]' })
    expect(parentLink('yearly', day, settings(['yearly', 'monthly']))).toBe(null)
  })

  it("a week's month and year are its Thursday's", () => {
    expect(parentLink('weekly', new Date(2026, 8, 28), settings(['weekly', 'monthly']))).toEqual({ key: 'month', value: '[[2026-10]]' })
    expect(parentLink('weekly', new Date(2025, 11, 29), settings(['weekly', 'yearly']))).toEqual({ key: 'year', value: '[[2026]]' })
  })
})

describe('placeholders for periodic notes', () => {
  it('fills week, month, year and the week range', () => {
    const vars = { title: '2026-W41', path: 'x.md', now: day }
    expect(fillTemplate('{{week}} {{month}} {{year}} {{week_start}}–{{week_end}}', vars)).toBe(
      '2026-W41 2026-10 2026 2026-10-05–2026-10-11',
    )
    expect(fillTemplate('{{week_start}}–{{week_end}}', { ...vars, weekStart: 'sunday' })).toBe('2026-10-04–2026-10-10')
  })

  it('a week range by its start day', () => {
    const sat = weekRange(day, 'saturday')
    expect([sat.start.getDate(), sat.end.getDate()]).toEqual([3, 9])
  })
})

describe('preview tree', () => {
  it('folders first, nested', () => {
    expect(pathTree(['J/2026/10/2026-W41.md', 'J/2026/10/2026-10.md', 'J/2026/2026.md'])).toEqual([
      { depth: 0, name: 'J/', file: false },
      { depth: 1, name: '2026/', file: false },
      { depth: 2, name: '10/', file: false },
      { depth: 3, name: '2026-10.md', file: true },
      { depth: 3, name: '2026-W41.md', file: true },
      { depth: 2, name: '2026.md', file: true },
    ])
  })
})

describe('unique names', () => {
  it('refuses a name that exists elsewhere in the vault, whatever its case', () => {
    const notes = ['Old/2026-W41.md', 'Journal/2026/2026.md', 'Notes/2026-10 plan.md']
    expect(nameTakenElsewhere('Journal/2026/2026-W41.md', notes)).toBe('Old/2026-W41.md')
    expect(nameTakenElsewhere('Journal/2026/2026-w41.md', notes)).toBe('Old/2026-W41.md')
    expect(nameTakenElsewhere('Journal/2026/2026.md', notes)).toBe(null)
    expect(nameTakenElsewhere('Journal/2026/2026-10.md', notes)).toBe(null)
  })
})

describe("today's note", () => {
  it('is the shortest period that is on, for every combination', () => {
    const all: Period[] = ['daily', 'weekly', 'monthly', 'yearly']
    for (let mask = 0; mask < 16; mask++) {
      const on = all.filter((_, i) => (mask & (1 << i)) !== 0)
      expect(todayPeriod(settings(on))).toBe(on[0] ?? null)
    }
  })

  it('with daily off and weekly on it is this week, 2026-W42 on 16 October 2026', () => {
    const s = settings(['weekly', 'monthly'])
    const period = todayPeriod(s)
    expect(period).toBe('weekly')
    expect(periodNotePath(period!, new Date(2026, 9, 16), s).key).toBe('2026-W42')
  })
})
