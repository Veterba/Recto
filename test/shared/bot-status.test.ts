import { describe, expect, it } from 'vitest'
import { langOfText, statusPhrases, stepsSummary } from '../../src/shared/bot-status'
import type { BotStep } from '../../src/shared/bots'

const job = (steps: BotStep[], lang: 'en' | 'ru' = 'en', text = '') => ({ state: 'preparing' as const, steps, text, lang })

describe('status text', () => {
  it('words the running step, in the question’s language', () => {
    expect(statusPhrases(job([]))?.[0]).toBe('Thinking…')
    expect(statusPhrases(job([{ action: 'Задачи', result: '', state: 'running', kind: 'tasks' }], 'ru'))?.[0]).toBe('Смотрю задачи…')
    expect(statusPhrases(job([{ action: 'Opened', result: 'Tutta', state: 'running', kind: 'open', subject: 'Tutta' }]))?.[0]).toBe(
      'Reading Tutta…',
    )
    expect(
      statusPhrases(
        job([{ action: 'Заметки за период', result: '', state: 'running', kind: 'period', subject: 'прошлую неделю' }], 'ru'),
      )?.[0],
    ).toBe('Листаю прошлую неделю…')
  })

  it('a finished step is not claimed: back to thinking; the first words are writing', () => {
    expect(statusPhrases(job([{ action: 'Searching notes', result: '“a”', state: 'done', kind: 'search' }]))?.[0]).toBe('Thinking…')
    expect(statusPhrases(job([], 'ru', 'Привет'))?.[0]).toBe('Пишу…')
    expect(statusPhrases({ ...job([]), state: 'queued' })).toBeNull()
  })

  it('every phrase has calm variants', () => {
    expect(statusPhrases(job([{ action: 'Searching notes', result: '', state: 'running', kind: 'search' }]))).toEqual([
      'Digging through notes…',
      'Still digging…',
      'Looking a bit further…',
    ])
  })

  it('the folded card counts the notes, in the steps’ language', () => {
    expect(stepsSummary([{ action: 'Reading Math', result: '12/12', state: 'done', kind: 'read' }])).toBe('Looked through 12 notes')
    expect(stepsSummary([{ action: 'Открыл', result: 'Tutta', state: 'done', kind: 'open' }])).toBe('Просмотрел 1 заметку')
    expect(stepsSummary([{ action: 'Ищу в заметках', result: 'ничего', state: 'done', kind: 'search' }])).toBe('1 шаг')
  })

  it("with the answer's record, the card counts what it really read in full; with none read, what it skimmed", () => {
    const around = { action: 'Read around', result: '“Japan trip plan”', state: 'done', kind: 'read' } as const
    const opened = (subject: string) => ({ action: 'Opened', result: `“${subject}”`, state: 'done', kind: 'open', subject }) as const
    const record = (read: string[], skimmed: string[] = []) => ({ read, skimmed, proposals: [] })
    // "Kyoto" and "Trips/Kyoto" are one note; a section read is a skim - the record knows, the steps do not.
    const steps = [around, opened('Kyoto'), opened('Trips/Kyoto'), opened('Budget')]
    expect(stepsSummary(steps, record(['Trips/Kyoto.md'], ['Budget.md']))).toBe('Looked through 1 note')
    expect(stepsSummary([around], record([], ['A.md', 'B.md', 'C.md', 'D.md']))).toBe('Skimmed 4 notes')
    expect(stepsSummary([{ ...around, action: 'Читаю вокруг' }], record([], ['A.md', 'B.md']))).toBe('Пролистал 2 заметки')
    expect(stepsSummary([around], record([]))).toBe('1 step')
  })

  it('the language of a question', () => {
    expect(langOfText('Что у меня по Recto?')).toBe('ru')
    expect(langOfText('What about Recto?')).toBe('en')
  })
})
