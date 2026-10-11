import { describe, expect, it } from 'vitest'
import { answerLang, claimsAction, HONEST, honestAnswer } from '../../../src/main/bots/honesty'

/** Recto cannot change notes, so it must never say it did. */
describe('claims of an action', () => {
  it('catches them in Russian, English and Norwegian', () => {
    for (const s of [
      'Я обновил заметку.',
      'Я уже изменила таблицу в заметке.',
      'Готово, обновил таблицу.',
      'Обновил заметку «Планы».',
      'Таблица обновлена.',
      'Заметка была изменена.',
      'I updated the note.',
      "I've changed the table for you.",
      'I have just added the row.',
      "I've made the changes.",
      'The note has been updated.',
      'Jeg har oppdatert notatet.',
      'Jeg har lagt til raden.',
      'Notatet er nå endret.',
    ])
      expect(claimsAction(s), s).toBe(true)
  })

  it('leaves alone what is not a claim', () => {
    for (const s of [
      'Ты обновил заметку вчера.',
      'Я бы изменил таблицу так:',
      'Вот как может выглядеть таблица:',
      'You updated the note on Monday.',
      'I would change the second column.',
      'I can suggest a new table.',
      'Here is the table with the new row:',
      'Du har endret notatet.',
      'Updated tables are easier to read.',
      '| Обновил | 3 |',
    ])
      expect(claimsAction(s), s).toBe(false)
  })
})

describe('the honest answer', () => {
  it('replaces the claim once, keeps everything else, drops further claims', () => {
    const text = 'Я обновил заметку. Вот новая таблица:\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nТакже я изменил заголовок.'
    expect(honestAnswer(text, 'ru')).toBe(`${HONEST.ru} Вот новая таблица:\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n`)
    expect(honestAnswer('I updated the note. Here it is:', 'en')).toBe(`${HONEST.en} Here it is:`)
  })

  it('hides a claim still being written', () => {
    expect(honestAnswer('Я обновил зам', 'ru')).toBe(HONEST.ru)
  })

  it('changes nothing in an honest answer, or when a write really happened', () => {
    const honest = 'Я не могу менять заметки. Вот предложение:'
    expect(honestAnswer(honest, 'ru')).toBe(honest)
    expect(honestAnswer('I updated the note.', 'en', true)).toBe('I updated the note.')
  })

  it('answers in the question’s language', () => {
    expect(answerLang('Обнови таблицу в заметке')).toBe('ru')
    expect(answerLang('Can you edit the table?')).toBe('en')
    expect(answerLang('Kan du endre tabellen i notatet?')).toBe('no')
  })
})
