import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCases, type Case } from '../../scripts/evals/cases.ts'
import { languageOf, percentile, saysNotFound, score, type Answered } from '../../scripts/evals/metrics.ts'
import { readGrades, renderReport, type RunConfig } from '../../scripts/evals/report.ts'
import { guard, newRunId } from '../../scripts/evals/store.ts'

const answered = (over: Partial<Answered> = {}): Answered => ({
  id: 'x',
  context: [],
  answer: '',
  error: null,
  ttftMs: 1000,
  totalMs: 3000,
  prepareMs: 100,
  stats: { promptTokens: 100, promptMs: 200, evalTokens: 30, evalMs: 2000, loadMs: 0 },
  ...over,
})
const ctx = (...paths: string[]): Answered['context'] => paths.map((p) => ({ path: p, title: p, heading: null, score: 1 }))
const caseOf = (over: Partial<Case>): Case => ({
  id: 'x',
  kind: 'same-language',
  messages: [],
  question: 'What is it?',
  expectNotes: [],
  expectAnswer: null,
  expectNoSources: false,
  ...over,
})

describe('cases', () => {
  it('reads the strict file format', () => {
    const file = readCases(
      'today: 2026-09-30\ncases:\n  - id: a\n    kind: recent\n    question: What did I do?\n    expectNotes: [Log one]\n',
    )
    expect(file.today).toBe('2026-09-30')
    expect(file.cases[0]).toMatchObject({ id: 'a', kind: 'recent', expectNotes: ['Log one'], expectNoSources: false })
  })

  it('normalises loose private files without needing ids or kinds', () => {
    const loose = readCases(
      '- q: Where is the plan?\n  notes: "[[Recto plan]], Ideas.md"\n  answer: In Recto plan\n- Just a question?\n',
      'mine',
    )
    expect(loose.cases).toEqual([
      {
        id: 'mine-01',
        kind: 'private',
        messages: [],
        question: 'Where is the plan?',
        expectNotes: ['Recto plan', 'Ideas'],
        expectAnswer: 'In Recto plan',
        expectNoSources: false,
      },
      {
        id: 'mine-02',
        kind: 'private',
        messages: [],
        question: 'Just a question?',
        expectNotes: [],
        expectAnswer: null,
        expectNoSources: false,
      },
    ])
    const mapping = readCases('What is in Later?: [Later]\nКто такой Игорь?: Ремонт кухни\n', 'm')
    expect(mapping.cases.map((c) => [c.question, c.expectNotes])).toEqual([
      ['What is in Later?', ['Later']],
      ['Кто такой Игорь?', ['Ремонт кухни']],
    ])
  })
})

describe('scoring', () => {
  it('recall@4 counts expected notes among the first four distinct notes read', () => {
    const c = caseOf({ expectNotes: ['B', 'E'] })
    const s = score(c, answered({ context: ctx('A.md', 'A.md', 'x/B.md', 'C.md', 'D.md', 'E.md'), answer: 'See B.' }))
    expect(s.recall4).toBe(0.5)
    expect(s.namedInAnswer).toBe(true)
    expect(s.pass).toBe(true)
  })

  it('a named note that was not read is "ignored named note"', () => {
    const s = score(caseOf({ kind: 'named-note', expectNotes: ['Plan'] }), answered({ context: ctx('Log.md'), answer: 'Hmm.' }))
    expect(s.pass).toBe(false)
    expect(s.reasons).toContain('ignored named note')
  })

  it('small talk must read nothing; not-in-vault must say so', () => {
    expect(score(caseOf({ kind: 'small-talk', question: 'hi' }), answered({ context: ctx('A.md'), answer: 'Hi!' })).reasons).toEqual([
      'unneeded retrieval',
    ])
    const notIn = caseOf({ kind: 'not-in-vault', question: 'What about Japan?' })
    expect(score(notIn, answered({ answer: "I couldn't find anything about Japan in your notes." })).pass).toBe(true)
    expect(score(notIn, answered({ answer: 'You loved Kyoto in April.' })).reasons).toContain('hallucination')
  })

  it('answering in another language fails; slow answers are only noted', () => {
    const ru = caseOf({ question: 'Когда полумарафон?', expectNotes: ['Running plan'] })
    expect(score(ru, answered({ context: ctx('Running plan.md'), answer: 'On 8 November.' })).reasons).toEqual(['language'])
    const slow = score(ru, answered({ context: ctx('Running plan.md'), answer: '8 ноября.', totalMs: 90_000 }))
    expect(slow.pass).toBe(true)
    expect(slow.reasons).toEqual(['too slow'])
  })

  it('tells the three languages apart', () => {
    expect(languageOf('Сколько мне нужно накопить?')).toBe('ru')
    expect(languageOf('Hvilke dager har jeg norskkurs?')).toBe('no')
    expect(languageOf('Jeg fant ingen notater om norskkurs i vaultet. Vil du sjekke planene for hytterunden i Hemsedal?')).toBe('no')
    expect(languageOf('I found it in your notes: four hours a day.')).toBe('en')
    expect(languageOf('Moving on 1 December to Grünerløkka, and the van is booked.')).toBe('en')
    expect(saysNotFound('В заметках об этом ничего нет.')).toBe(true)
    expect(saysNotFound('Your plan says iOS first.')).toBe(false)
    for (const honest of [
      'The vault contains no records of your activity.',
      'I found nothing about that week.',
      "The vault doesn't contain any information about it.",
    ])
      expect(saysNotFound(honest)).toBe(true)
  })

  it('percentiles by nearest rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9)
    expect(percentile([], 50)).toBeNull()
  })
})

const config = (): RunConfig => ({
  report_version: 1,
  run_id: '2026-10-03 10-00 — baseline',
  label: 'baseline',
  date: '2026-10-03T08:00:00.000Z',
  model: 'qwen3.5:9b',
  profile: {},
  harness: { router: false, hybridRetrieval: false, namedNotes: false, tools: false, stickyContext: false },
  git: { commit: 'abcdef0123', branch: 'b', dirty: false },
  app_version: '0.9.3',
  system: 'You are Recto.',
  system_sha: 'aa',
  cases_file: 'cases.yaml',
  cases_sha: 'bb',
  today: null,
  vault: { kind: 'fixture', notes: 3, languages: { en: 3 } },
  machine: { chip: 'Apple M3', ram_bytes: 16 * 2 ** 30 },
  ollama: { version: '0.31.1', one_model_loaded: 'yes' },
  memory: { ollamaPeakBytes: null, appPeakBytes: null, modelBytes: null, swapBeforeBytes: null, swapAfterBytes: null },
  why: null,
})

describe('report', () => {
  it('reads back the grades ticked in a rendered report', () => {
    const rows = ['a', 'b', 'c'].map((id) => {
      const c = caseOf({ id, question: `Question ${id}?` })
      const a = answered({ id, answer: 'Answer.' })
      return { case: c, answered: a, scores: score(c, a) }
    })
    const md = renderReport(config(), rows, null)
    expect(md).toContain('# Recto Eval: baseline')
    for (const heading of [
      '## Summary',
      '## Setup',
      '## Dataset',
      '## Metrics',
      '## Results',
      '## Latency',
      '## Error analysis',
      '## Appendix: cases',
    ])
      expect(md).toContain(heading)
    const ticked = md
      .replace(/(### a ·[\s\S]*?)- \[ \] good/, '$1- [x] good')
      .replace(/(### b ·[\s\S]*?)- \[ \] bad\n- Note: /, '$1- [X] bad\n- Note: too vague')
    const grades = readGrades(ticked)
    expect(grades.get('a')).toEqual({ grade: 'good', note: '', question: 'Question a?' })
    expect(grades.get('b')).toEqual({ grade: 'bad', note: 'too vague', question: 'Question b?' })
    expect(grades.has('c')).toBe(false)
  })
})

describe('writing in the vault', () => {
  const evals = path.join(os.tmpdir(), 'Evals Qwen')
  const run = path.join(evals, 'qwen3.5-9b', '2026-10-03 10-00 — baseline')
  it('allows the index, log, grades and the new run only', () => {
    for (const f of ['Evals.md', 'Eval log.md', 'graded.jsonl']) expect(() => guard(path.join(evals, f), evals, null)).not.toThrow()
    expect(() => guard(path.join(run, 'report.md'), evals, run)).not.toThrow()
    expect(() => guard(path.join(evals, 'qwen3.5-9b', 'older run', 'report.md'), evals, run)).toThrow()
    expect(() => guard(path.join(evals, '..', 'Recto plan.md'), evals, run)).toThrow()
  })

  it('names runs by time and label', () => {
    expect(newRunId(os.tmpdir(), 'baseline', new Date(2026, 9, 3, 9, 5))).toBe('2026-10-03 09-05 — baseline')
  })
})
