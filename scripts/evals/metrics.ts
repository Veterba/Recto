import type { Case } from './cases.ts'

/**
 * How one answer is scored, and how a run's numbers are summed up. Every rule
 * here is written out in the report's Metrics section, in the same words.
 */

export type ContextNote = { path: string; title: string; heading: string | null; score: number }

export type Stats = { promptTokens: number; promptMs: number; evalTokens: number; evalMs: number; loadMs: number }

/** What the app sent back for one case (src/main/bots/eval-mode.ts). */
export type Answered = {
  id: string
  context: ContextNote[]
  answer: string
  error: string | null
  ttftMs: number | null
  totalMs: number
  prepareMs: number
  stats: Stats | null
  /** Filled from stage 3 on; null before. */
  router?: unknown
  steps?: unknown
  toolCalls?: unknown
}

export type Lang = 'en' | 'ru' | 'no'

export const REASONS = [
  'retrieval miss',
  'wrong note',
  'ignored named note',
  'language',
  'hallucination',
  'unneeded retrieval',
  'too slow',
  'error',
] as const
export type Reason = (typeof REASONS)[number]

export type Scores = {
  /** Expected notes among the first four distinct notes read, as a share; null when the case expects none. */
  recall4: number | null
  /** The answer names one of the expected notes. */
  namedInAnswer: boolean | null
  /** Notes read when they should be, none when they shouldn't. */
  sourcesCorrect: boolean | null
  /** Not-in-vault: the answer says the notes don't have it. */
  honest: boolean | null
  /** Answered in the question's language. */
  languageOk: boolean
  pass: boolean
  reasons: Reason[]
}

/** Above this an answer is "too slow" - noted, not failed. */
export const SLOW_MS = 60_000

export const noteName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
const fold = (s: string): string => s.normalize('NFC').toLowerCase().trim()

const NORWEGIAN =
  /^(jeg|ikke|og|har|du|det|på|med|til|hvilke|hva|dager|kl|når|eller|er|en|et|av|om|som|vi|fra|må|kan|ingen|vil|kanskje|fant|også|hvis|bare|noen|hos|deg|meg|din|mitt|min)$/
// Not "i" or "for": they are Norwegian words too.
const ENGLISH = /^(the|and|is|to|of|in|a|with|on|my|it|you|that|what|this|at|be|are|from|was|have|your|did|not)$/

/**
 * The language of a text: mostly Cyrillic is Russian; Norwegian when its
 * small words outnumber English ones (æøå count once - a place name in an
 * English note is still English); else English.
 */
export function languageOf(text: string): Lang {
  const letters = text.match(/\p{L}/gu) ?? []
  if (letters.length === 0) return 'en'
  const cyrillic = letters.filter((l) => /\p{Script=Cyrillic}/u.test(l)).length
  if (cyrillic / letters.length > 0.3) return 'ru'
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? []
  const norwegian = words.filter((w) => NORWEGIAN.test(w)).length + (/[æøå]/i.test(text) ? 1 : 0)
  const english = words.filter((w) => ENGLISH.test(w)).length
  return norwegian > english ? 'no' : 'en'
}

/** "Nothing in the notes about it", in the three languages the vault has. */
const NOT_FOUND = [
  /\b(no|not|n't|nothing|none)\b[^.!?\n]{0,60}\b(notes?|vault|mentions?|mentioned|information|info|find|found|cover|covers|records?|written|details?)\b/i,
  /\b(doesn't|does not|don't|do not|didn't)\s+(contain|have|mention|cover)\b/i,
  /\b(found|see|is) nothing\b/i,
  /\b(couldn't|could not|can't|cannot|didn't|did not|don't|do not)\s+(find|see|locate)\b/i,
  /(нет|ничего|не нашёл|не нашел|не нашла|не упомина|отсутству|не нашлось|нет информации|нет заметки|нет данных)/i,
  /\b(ingen|ikke|finner ikke|fant ikke)\b/i,
]
export const saysNotFound = (answer: string): boolean => NOT_FOUND.some((re) => re.test(answer))

/** The distinct notes read, in the order they came. */
export function notesRead(context: readonly ContextNote[]): string[] {
  const out: string[] = []
  for (const c of context) if (!out.includes(noteName(c.path))) out.push(noteName(c.path))
  return out
}

export function score(c: Case, a: Answered): Scores {
  const read = notesRead(a.context).map(fold)
  const top4 = read.slice(0, 4)
  const expected = c.expectNotes.map(fold)
  const noSources = c.expectNoSources || c.kind === 'small-talk' || c.kind === 'self'
  const recall4 = expected.length === 0 ? null : expected.filter((n) => top4.includes(n)).length / expected.length
  const namedInAnswer = expected.length === 0 ? null : expected.some((n) => fold(a.answer).includes(n))
  const sourcesCorrect = noSources ? read.length === 0 : expected.length > 0 ? expected.some((n) => read.includes(n)) : null
  const honest = c.kind === 'not-in-vault' ? saysNotFound(a.answer) : null
  const languageOk = a.answer.trim() === '' || languageOf(a.answer) === languageOf(c.question)

  const reasons: Reason[] = []
  if (a.error !== null) reasons.push(a.error.toLowerCase().includes('timeout') || a.error.includes('aborted') ? 'too slow' : 'error')
  if (recall4 !== null && recall4 < 0.5)
    reasons.push(c.kind === 'named-note' ? 'ignored named note' : recall4 === 0 && read.length > 0 ? 'wrong note' : 'retrieval miss')
  if (noSources && read.length > 0) reasons.push('unneeded retrieval')
  if (honest === false) reasons.push('hallucination')
  if (!languageOk) reasons.push('language')
  const pass = reasons.length === 0
  if (a.totalMs > SLOW_MS && !reasons.includes('too slow')) reasons.push('too slow')
  return { recall4, namedInAnswer, sourcesCorrect, honest, languageOk, pass, reasons }
}

/** The p-th percentile (0–100) by nearest rank; null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((x, y) => x - y)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!
}

const mean = (values: readonly number[]): number | null => (values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length)
const share = (values: readonly (boolean | null)[]): number | null => {
  const known = values.filter((v): v is boolean => v !== null)
  return known.length === 0 ? null : known.filter(Boolean).length / known.length
}

export type Scored = { case: Case; answered: Answered; scores: Scores }

export type Summary = {
  cases: number
  passed: number
  passRate: number
  recall4: number | null
  namedInAnswer: number | null
  sourcesCorrect: number | null
  honest: number | null
  ttftP50: number | null
  ttftP90: number | null
  totalP50: number | null
  totalP90: number | null
  tokensPerSec: number | null
}

export function summarise(rows: readonly Scored[]): Summary {
  const passed = rows.filter((r) => r.scores.pass).length
  const ttft = rows.flatMap((r) => (r.answered.ttftMs === null ? [] : [r.answered.ttftMs]))
  const total = rows.map((r) => r.answered.totalMs)
  const speeds = rows.flatMap((r) =>
    r.answered.stats !== null && r.answered.stats.evalMs > 0 ? [r.answered.stats.evalTokens / (r.answered.stats.evalMs / 1000)] : [],
  )
  return {
    cases: rows.length,
    passed,
    passRate: rows.length === 0 ? 0 : passed / rows.length,
    recall4: mean(rows.flatMap((r) => (r.scores.recall4 === null ? [] : [r.scores.recall4]))),
    namedInAnswer: share(rows.map((r) => r.scores.namedInAnswer)),
    sourcesCorrect: share(rows.map((r) => r.scores.sourcesCorrect)),
    honest: share(rows.map((r) => r.scores.honest)),
    ttftP50: percentile(ttft, 50),
    ttftP90: percentile(ttft, 90),
    totalP50: percentile(total, 50),
    totalP90: percentile(total, 90),
    tokensPerSec: mean(speeds),
  }
}
