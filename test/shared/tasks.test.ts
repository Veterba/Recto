import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractTasks, groupTasks, isDaily, normaliseTask, noteDate, tasksInPeriod, type TaskRow } from '../../src/shared/tasks'

const FIXTURE = path.join(__dirname, '../../tests/bots/eval/fixture-vault')

describe('reading tasks out of a note', () => {
  it('checkboxes anywhere, plain items under a Tasks heading, no empty placeholders', () => {
    const body = [
      '# 2026-09-24',
      'Some text with - [ ] not a task inline.',
      '## Tasks',
      '- [ ] Write Lark privacy policy',
      '- [x] Review **Maria’s** doc',
      '- [ ] ',
      '- plain item counts here',
      '### Option tasks',
      '- [ ] Разобрать фото',
      '## Notes',
      '- a plain list item, not a task',
      '```',
      '- [ ] in code, not a task',
      '```',
    ].join('\n')
    expect(extractTasks('Daily/2026-09-24.md', body, {}, '2026-09-24').map((t) => [t.text, t.done, t.source, t.heading])).toEqual([
      ['Write Lark privacy policy', false, 'checkbox', 'Tasks'],
      ['Review Maria’s doc', true, 'checkbox', 'Tasks'],
      ['plain item counts here', false, 'list', 'Tasks'],
      ['Разобрать фото', false, 'checkbox', 'Option tasks'],
    ])
  })

  it('a card in tasks/ is one task; templates and chats have none', () => {
    expect(extractTasks('tasks/Weekly goals.md', '# Weekly goals\n\nText.', { board: 'lark', status: 'todo' }, 'Weekly goals')).toEqual([
      { text: 'Weekly goals', done: false, heading: null, line: 0, source: 'card', status: 'todo' },
    ])
    expect(extractTasks('Template/Daily.md', '## Tasks\n- [ ] x', {}, 'Daily')).toEqual([])
    expect(extractTasks('chats/recto/t.md', '- [ ] x', {}, 't')).toEqual([])
  })

  it('a note’s day: the daily’s name, else frontmatter, else its file time', () => {
    expect(noteDate('Daily/2026/09/W39/2026-09-23.md', {}, 0)).toBe('2026-09-23')
    expect(noteDate('Projects/Lark/Экспорт.md', { date: '2026-09-29' }, 0)).toBe('2026-09-29')
    expect(isDaily('Daily/2026/09/W39/2026-09-23.md')).toBe(true)
    expect(isDaily('Projects/Lark/Lark log/2026-09-23 — v0.7.md')).toBe(true)
    expect(isDaily('Projects/Lark/Lark plan.md')).toBe(false)
  })
})

/** The fixture's dailies, as the index would hold them. */
function fixtureRows(): TaskRow[] {
  const rows: TaskRow[] = []
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else {
        const rel = path.relative(FIXTURE, full)
        const name = e.name.replace(/\.md$/, '')
        for (const t of extractTasks(rel, fs.readFileSync(full, 'utf8'), {}, name))
          rows.push({
            path: rel,
            title: name,
            text: t.text,
            norm: normaliseTask(t.text),
            done: t.done,
            source: t.source,
            status: t.status,
            noteDate: noteDate(rel, {}, 0),
            doneAt: null,
            due: null,
          })
      }
    }
  }
  walk(path.join(FIXTURE, 'Daily'))
  return rows
}

describe('tasks across daily notes', () => {
  const groups = groupTasks(fixtureRows())
  const names = (list: { group: { text: string } }[]): string[] => list.map((x) => x.group.text)

  it('a task copied day to day is one task, open while its latest copy is unchecked', () => {
    const policy = groups.find((g) => g.text === 'Write Lark privacy policy')!
    expect(policy.occurrences.length).toBeGreaterThan(5)
    expect(policy.open).toBe(true)
    const gift = groups.find((g) => g.text.startsWith('Купить подарок'))!
    expect([gift.open, gift.since, gift.doneOn]).toEqual([false, '2026-09-22', '2026-09-25'])
  })

  it('last week: what is still open and what got done', () => {
    const week = tasksInPeriod(groups, '2026-09-21', '2026-09-27')
    expect(names(week.open)).toEqual([
      'Write Lark privacy policy',
      'Разобрать фото из Лиссабона',
      'Записаться к стоматологу',
      'Try the new interval session',
      'Отправить отчёт по расходам',
      'Order fibre internet for the new flat',
    ])
    expect(names(week.done)).toEqual(["Review Maria's payments doc", 'Купить подарок Ане на день рождения', 'Long run 16 km'])
    // Each named by its first copy inside the period.
    expect(week.open[0]!.note.noteDate).toBe('2026-09-21')
  })

  it('from Wednesday: only what that day had, still open', () => {
    expect(names(tasksInPeriod(groups, '2026-09-23', '2026-09-23', 'open').open)).toEqual([
      'Write Lark privacy policy',
      'Разобрать фото из Лиссабона',
      'Записаться к стоматологу',
      'Try the new interval session',
    ])
  })
})
