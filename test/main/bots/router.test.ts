import { describe, expect, it } from 'vitest'
import { parseRoute, quickKind, routedTerms } from '../../../src/main/bots/router'

const today = new Date(2026, 8, 30)

describe('the router reply', () => {
  it('reads kind, query, both keyword sets, named notes and the period', () => {
    const r = parseRoute(
      '{"kind":"tasks","query":"что я не доделал","keywords_en":["tasks"],"keywords_ru":["задачи"],"notes":[],"when":"с прошлой недели"}',
      'что я не доделал с прошлой недели',
      today,
    )
    expect(r).toMatchObject({ kind: 'tasks', keywordsEn: ['tasks'], keywordsRu: ['задачи'], parseFailed: false })
    expect(r.period).toEqual({ from: '2026-09-21', to: '2026-09-27' })
  })

  it("takes the period from the user's words before the router's", () => {
    const r = parseRoute(
      '{"kind":"recent","query":"q","keywords_en":[],"keywords_ru":[],"notes":[],"when":"yesterday"}',
      'what did I do last week',
      today,
    )
    expect(r.period).toEqual({ from: '2026-09-21', to: '2026-09-27' })
  })

  it('falls back to a plain notes question when the reply is not JSON or the kind is unknown', () => {
    for (const raw of ['', 'Sure! Here is the JSON:', '{"kind":"weather"}', '{"kind": notes}']) {
      const r = parseRoute(raw, 'Где план?', today)
      expect(r).toMatchObject({ kind: 'notes', query: 'Где план?', parseFailed: true, notes: [] })
    }
  })

  it('finds the JSON inside extra text', () => {
    expect(parseRoute('```json\n{"kind":"smalltalk","query":"hi"}\n```', 'hi', today)).toMatchObject({
      kind: 'smalltalk',
      parseFailed: false,
    })
  })
})

describe('search words for a routed question', () => {
  it('adds the English and Russian keywords to the rewritten question', () => {
    const r = parseRoute(
      '{"kind":"notes","query":"Что я решил про уведомления в Lark","keywords_en":["notifications","Lark"],"keywords_ru":["уведомления"],"notes":[]}',
      'Что я решил про уведомления в Lark?',
      today,
    )
    expect(routedTerms('Что я решил про уведомления в Lark?', { ...r, by: 'model', ms: 0 })).toEqual([
      'решил',
      'уведомлен',
      'lark',
      'notificatio',
    ])
  })
})

describe('the obvious cases, by rules', () => {
  it('sorts small talk, self, tasks and recent; leaves the rest to the model', () => {
    const cases: [string, string | null][] = [
      ['hi!', 'smalltalk'],
      ['Спасибо, очень помог!', 'smalltalk'],
      ['haha nice', 'smalltalk'],
      ['thanks, and what did I decide about streaks?', null],
      ['What model are you?', 'self'],
      ['Из какого года твои знания?', 'self'],
      ['Are my notes sent anywhere?', 'self'],
      ['что я не доделал с прошлой недели, посмотри все задачи, а не только одну специфику', 'tasks'],
      ["What's still open from Wednesday?", 'tasks'],
      ['Which tasks did I finish last week?', 'tasks'],
      ['Что мне ещё осталось доделать по экспорту?', 'tasks'],
      ['Какие задачи у меня просрочены?', 'tasks'],
      ['What did I do last week?', 'recent'],
      ['Что нового в Lark с понедельника?', 'recent'],
      ['Когда у меня полумарафон?', null],
      ['Look in Beta feedback - what do testers ask for most?', null],
    ]
    for (const [message, kind] of cases) expect([message, quickKind(message)]).toEqual([message, kind])
  })
})
