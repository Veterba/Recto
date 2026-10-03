import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { intentOf, renderTaskAnswer, topicWords } from '../../../src/main/bots/task-answer'
import { queryTerms } from '../../../src/main/bots/context'
import { extractTasks, groupTasks, normaliseTask, noteDate, tasksInPeriod, type TaskRow } from '../../../src/shared/tasks'

const FIXTURE = path.join(__dirname, '../../../tests/bots/eval/fixture-vault')

function rows(): TaskRow[] {
  const out: TaskRow[] = []
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else {
        const rel = path.relative(FIXTURE, full)
        const title = e.name.replace(/\.md$/, '')
        for (const t of extractTasks(rel, fs.readFileSync(full, 'utf8'), {}, title))
          out.push({
            path: rel,
            title,
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
  return out
}

const answer = (question: string, from: string, to: string, inferred: { path: string; title: string; items: string[] }[] = []): string =>
  renderTaskAnswer({ ...tasksInPeriod(groupTasks(rows()), from, to), inferred }, question, queryTerms(question), '2026-09-30').text

describe('the answer to a tasks question', () => {
  it('your real question: every open item by day, then one done line, in Russian', () => {
    const text = answer('что я не доделал с прошлой недели, посмотри все задачи, а не только одну специфику', '2026-09-21', '2026-09-27')
    expect(text).toBe(
      [
        'Не доделано (6):',
        '• 21 сен - Write Lark privacy policy',
        '• 22 сен - Разобрать фото из Лиссабона',
        '• 23 сен - Записаться к стоматологу; Try the new interval session',
        '• 24 сен - Отправить отчёт по расходам',
        '• 25 сен - Order fibre internet for the new flat',
        '',
        "Сделано за этот период: 3 - Review Maria's payments doc, Купить подарок Ане на день рождения, Long run 16 km.",
      ].join('\n'),
    )
  })

  it('what got done: the done list in full', () => {
    const text = answer('Which tasks did I finish last week?', '2026-09-21', '2026-09-27')
    expect(text.split('\n').slice(0, 4)).toEqual([
      'Done (3):',
      "• 24 Sep - Review Maria's payments doc",
      '• 25 Sep - Купить подарок Ане на день рождения',
      '• 27 Sep - Long run 16 km',
    ])
  })

  it('a topic narrows it to what matches, plain-text tasks included', () => {
    const text = answer('Что мне ещё осталось доделать по экспорту?', '2026-09-17', '2026-09-30', [
      { path: 'Projects/Lark/Экспорт.md', title: 'Экспорт', items: ['доделать экспорт в JSON до релиза'] },
    ])
    expect(text).toBe(['Не доделано про «экспорту» (1):', '• Экспорт - доделать экспорт в JSON до релиза (без чекбокса)'].join('\n'))
  })

  it('reads what the question asks', () => {
    expect(intentOf('Какие задачи у меня просрочены?')).toBe('overdue')
    expect(intentOf('Which Lark tasks are done?')).toBe('done')
    expect(intentOf('Which Lark tasks from last week are still open, and which are done?')).toBe('open')
    expect(topicWords(queryTerms('что я не доделал с прошлой недели, посмотри все задачи, а не только одну специфику'))).toEqual([])
    expect(topicWords(queryTerms('Что мне ещё осталось доделать по экспорту?'))).toEqual(['экспор'])
    expect(topicWords(queryTerms('Which Lark tasks are done?'))).toEqual(['lark'])
  })
})
