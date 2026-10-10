import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCases, type Case } from '../../scripts/evals/cases.ts'
import { descriptionClaims, languageOf, numberClaims, percentile, saysNotFound, score, type Answered } from '../../scripts/evals/metrics.ts'
import { differentSnapshot, readGrades, renderReport, snapshotName, type RunConfig } from '../../scripts/evals/report.ts'
import { guard, newRunId, noteNames, runPaths } from '../../scripts/evals/store.ts'

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
  expectItems: [],
  forbidNotes: [],
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
        expectItems: [],
        forbidNotes: [],
      },
      {
        id: 'mine-02',
        kind: 'private',
        messages: [],
        question: 'Just a question?',
        expectNotes: [],
        expectAnswer: null,
        expectNoSources: false,
        expectItems: [],
        forbidNotes: [],
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

describe('the new checks', () => {
  it('items, decoys and ungrounded claims', () => {
    const c = caseOf({ kind: 'tasks', expectItems: ['privacy policy|политик', 'dentist|стоматолог'], forbidNotes: ['Линейные уравнения'] })
    const a = answered({
      context: ctx('Daily/2026-09-23.md', 'Учёба/Линейные уравнения.md', 'Log/2026-09-28 — v0.9.md'),
      answer: 'Open: privacy policy (2026-09-23). See [[Recto plan]], «Lark plan» and 2026-09-28 — v0.9; weekly goals next.',
    })
    const s = score(c, a, ['Recto plan', 'Lark plan', 'Weekly goals', '2026-09-28', 'Daily'])
    expect(s.items).toBe(0.5)
    expect(s.ungrounded).toEqual(['Recto plan', 'Lark plan'])
    expect(s.reasons).toEqual(expect.arrayContaining(['missing items', 'decoy in context', 'ungrounded claim']))
  })

  it('recall@4 is out of at most four expected notes', () => {
    const c = caseOf({ kind: 'recent', expectNotes: ['a', 'b', 'c', 'd', 'e', 'f'] })
    expect(score(c, answered({ context: ctx('a.md', 'b.md', 'c.md', 'd.md') })).recall4).toBe(1)
  })

  it('router accuracy compares the routed kind with the case kind', () => {
    expect(score(caseOf({ kind: 'small-talk', question: 'hi' }), answered({ router: { kind: 'smalltalk' } })).routerOk).toBe(true)
    expect(score(caseOf({ kind: 'tasks' }), answered({ router: { kind: 'notes' } })).reasons).toContain('wrong route')
  })
})

describe('grounded numbers and descriptions', () => {
  const ctx = '## The vault\n812 notes. Daily: 31 notes. 45 notes with no links.\n\n## Japan trip\n60k NOK for two, March next year.'

  it('a count the context never gave is a claim; one it gave is not', () => {
    expect(numberClaims('You have 67 dailies and 45 notes with no links.', ctx)).toEqual(['67'])
    expect(numberClaims('Your vault has 3 folders.', ctx)).toEqual(['3'])
  })

  it('the same number written another way, or worked out from two the context has, is not', () => {
    const notes = 'Цель — 540 000 рублей, накоплено 310 000. Budget 450 000 rubles. Lark v0.9 shipped.'
    expect(numberClaims('Осталось 230 000 рублей.', notes)).toEqual([])
    expect(numberClaims('A budget of 450,000 rubles; version 0.9; a 1:1 call.', notes)).toEqual([])
    expect(numberClaims('About 1,200,000 in total.', notes)).toEqual(['1200000'])
    expect(numberClaims('Остаётся ещё около 230 тысяч; виджет на iOS 17.', notes + ' iOS 17.0')).toEqual([])
    // A day in words is the context's ISO date; a day the context never had is still a claim.
    const days = 'from 2026-09-23 to 2026-09-29'
    expect(numberClaims('From 23 September to 29 September; заметка от 28–29 сентября.', days + ' 2026-09-28')).toEqual([])
    expect(numberClaims('On 20 September 2026.', days)).toEqual(['20'])
  })

  it("a list's numbering, small ranges and the context's own numbers are not", () => {
    expect(numberClaims('1. Pick 2-3 notes a day.\n2. Budget: 60k NOK for two.', ctx)).toEqual([])
  })

  it('a description of a note in words it never read is a claim', () => {
    const context = [{ path: 'Work/Trasncript pipeline.md', title: 'Trasncript pipeline', heading: null, score: 1 }]
    const read =
      'Trasncript pipeline\nNote about my first project from my internship. Teams transcript, summary by a model, sent by email to recipients.'
    expect(descriptionClaims('Trasncript pipeline is a mobile banking application with blockchain wallets.', context, read)).toHaveLength(1)
    expect(
      descriptionClaims('Trasncript pipeline is your internship project: a Teams transcript summarised and sent by email.', context, read),
    ).toEqual([])
    // A Russian line about an English note is not checked word by word.
    expect(descriptionClaims('Trasncript pipeline — это твой проект для стажировки с почтой.', context, `## Right now\n${read}`)).toEqual(
      [],
    )
    // Its own ideas are its own.
    expect(descriptionClaims('**My suggestions**\nThe project is a candidate for scheduled cronjobs everywhere.', context, read)).toEqual(
      [],
    )
  })
})

describe('snapshots', () => {
  it('cases name their snapshot and day; proposed notes are kept', () => {
    const r = readCases(
      'snapshot: private-2026-10-10\ntoday: 2026-10-10\ncases:\n  - id: A\n    question: q?\n    proposed: true\n    expectNotes: [X]\n',
    )
    expect(r.snapshot).toBe('private-2026-10-10')
    expect(r.today).toBe('2026-10-10')
    expect(r.cases[0]!.proposed).toBe(true)
  })

  it('runs on different snapshots are marked, a run from before snapshots is a live copy', () => {
    const run = (snapshot?: string) => ({
      vault: { kind: 'copy' as const, notes: 1, languages: {}, ...(snapshot === undefined ? {} : { snapshot }) },
    })
    expect(differentSnapshot(run(), run('private-2026-10-10'))).toBe(true)
    expect(differentSnapshot(run('private-2026-10-10'), run('private-2026-10-10'))).toBe(false)
    expect(snapshotName(run())).toBe('a live copy of the vault')
  })
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
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-evals-vault-'))
  const evals = path.join(vault, 'Projects', 'Evals Qwen')
  fs.mkdirSync(path.join(evals, 'qwen3.5-9b'), { recursive: true })
  fs.writeFileSync(path.join(evals, 'qwen3.5-9b', 'Eval 2026-10-03 09-05 — baseline.md'), '# old run\n')
  fs.mkdirSync(path.join(vault, 'Other'), { recursive: true })
  fs.writeFileSync(path.join(vault, 'Other', 'Eval 2026-10-03 09-06 — taken.md'), 'mine\n')
  const run = runPaths(vault, evals, 'qwen3.5:9b', '2026-10-03 10-00 — baseline')

  it('a run is one note in the evals folder, its data hidden in .recto/evals', () => {
    expect(path.relative(vault, run.note)).toBe(path.join('Projects', 'Evals Qwen', 'qwen3.5-9b', 'Eval 2026-10-03 10-00 — baseline.md'))
    expect(path.relative(vault, run.data)).toBe(path.join('.recto', 'evals', '2026-10-03 10-00 — baseline'))
  })

  it('allows the index, the log, the grades and the new run only', () => {
    for (const f of [
      path.join(evals, 'Recto evals.md'),
      path.join(evals, 'Eval log.md'),
      path.join(vault, '.recto', 'evals', 'graded.jsonl'),
    ])
      expect(() => guard(f, vault, evals, null)).not.toThrow()
    expect(() => guard(run.note, vault, evals, run)).not.toThrow()
    expect(() => guard(path.join(run.data, 'results.jsonl'), vault, evals, run)).not.toThrow()
    expect(() => guard(path.join(evals, 'qwen3.5-9b', 'Eval 2026-10-03 09-05 — baseline.md'), vault, evals, run)).toThrow()
    expect(() => guard(path.join(vault, '.recto', 'evals', 'older run', 'config.json'), vault, evals, run)).toThrow()
    expect(() => guard(path.join(vault, 'Recto plan.md'), vault, evals, run)).toThrow()
  })

  it('names runs by time and label, never with a name the vault already has', () => {
    expect(newRunId(vault, 'baseline', new Date(2026, 9, 3, 10, 0))).toBe('2026-10-03 10-00 — baseline')
    expect(newRunId(vault, 'baseline', new Date(2026, 9, 3, 9, 5))).toBe('2026-10-03 09-05 — baseline (2)')
    expect(newRunId(vault, 'taken', new Date(2026, 9, 3, 9, 6))).toBe('2026-10-03 09-06 — taken (2)')
    expect(noteNames(vault).has('eval 2026-10-03 09-05 — baseline')).toBe(true)
  })
})
