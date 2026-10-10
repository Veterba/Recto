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
  /** The part of the answer the harness wrote itself (a task list), shown before the model's words. */
  preface?: string | null
  /** The prompt the model answered from (scored, not kept in results.jsonl). */
  contextText?: string
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
  'missing items',
  'decoy in context',
  'ungrounded claim',
  'wrong route',
  'too slow',
  'error',
] as const
export type Reason = (typeof REASONS)[number]

export type Scores = {
  /** Expected notes among the first four distinct notes read, out of at most four; null when the case expects none. */
  recall4: number | null
  /** expectItems the answer names, as a share; null when the case lists none. */
  items?: number | null
  /** The router sent it where its kind says; null before there is a router. */
  routerOk?: boolean | null
  /** Notes the answer names or links, numbers it gives and notes it describes, that were not in its context. */
  ungrounded?: string[]
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

/** Where the router should send a case of each kind. */
export const ROUTE: Record<Case['kind'], string> = {
  'same-language': 'notes',
  'cross-language': 'notes',
  'named-note': 'notes',
  'follow-up': 'notes',
  'not-in-vault': 'notes',
  private: 'notes',
  recent: 'recent',
  tasks: 'tasks',
  'small-talk': 'smalltalk',
  self: 'self',
  review: 'review',
  advice: 'advice',
}

/** "a|b": does the answer say either? Case-insensitive. */
const mentions = (answer: string, item: string): boolean => item.split('|').some((alt) => fold(answer).includes(fold(alt)))

/**
 * Notes the answer refers to without having had them: a [[link]] to anything
 * not in its context, or a vault note's title set off as a reference - in
 * quotes, «», bold or brackets. Titles of notes it did have are taken out of
 * the text first ("2026-09-28" inside "2026-09-28 — v0.9" is not a claim), and
 * a title merely used as words in a sentence ("weekly goals") is not one either.
 */
export function ungroundedClaims(
  answer: string,
  context: readonly ContextNote[],
  vaultTitles: readonly string[],
  contextText = '',
): string[] {
  const given = fold(contextText)
  const had = [...new Set(context.flatMap((c) => [fold(noteName(c.path)), fold(c.title)]))].sort((a, b) => b.length - a.length)
  let text = fold(answer)
  for (const h of had) if (h !== '') text = text.split(h).join(' ')
  const titles = new Map(vaultTitles.map((t) => [fold(t), t]))
  const out = new Set<string>()
  for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) {
    const t = m[1]!.trim()
    if (t !== '') out.add(titles.get(t) ?? t)
  }
  const quoted = /[«“"„]([^»”"\n]{2,80})[»”"]|\*\*([^*\n]{2,80})\*\*|\*([^*\n]{2,80})\*|\(([^)\n]{2,80})\)/g
  for (const m of text.matchAll(quoted)) {
    const inner = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim().replace(/\.md$/, '')
    const title = titles.get(inner)
    // Words quoted from the notes it was given ("Weekly goals — asked by 7 of 12") are not a claim about another note.
    if (title !== undefined && !given.includes(inner)) out.add(title)
  }
  if (contextText !== '') {
    for (const n of numberClaims(answer, contextText)) out.add(`number ${n}`)
    for (const d of descriptionClaims(answer, context, contextText)) out.add(`description “${d}”`)
  }
  return [...out]
}

/** Numbers as whole tokens: "67", "20+", "60k", "0.12", "2026-10-03", "3/12". */
const NUMBER = /(?<![\p{L}\d.,:/-])\d+(?:[.,:/-]\d+)*k?\+?(?![\p{L}\d])/gu
/** Every number in a text, however it sits ("v0.9", "Unit4"): what the context has. */
const ANY_NUMBER = /\d+(?:[.,:/-]\d+)*k?/g
/** Things a vault has, after which even a small number is a count of them. */
const COUNTED =
  /^\s*(?:\+\s*)?(?:notes?|dailies|daily notes|tasks?|folders?|files?|links?|days?|weeks?|entries|projects?|заметк\p{L}*|задач\p{L}*|пап\p{L}*|файл\p{L}*|ссыл\p{L}*|дн\p{L}*|дней|недел\p{L}*|запис\p{L}*|проект\p{L}*)\b/iu

/** "450 000" and "450,000" are one number, 450000; "60k" is 60000. */
const joinThousands = (text: string): string => text.replace(/(\d)[\u00a0\u202f ,](?=\d{3}(?!\d))/g, '$1')
const normal = (token: string): string => {
  const t = token.replace(/\+$/, '')
  return /^\d+k$/i.test(t) ? `${t.slice(0, -1)}000` : t
}

const MONTHS: readonly RegExp[] = [
  /^(jan|январ)/i,
  /^(feb|феврал)/i,
  /^(mar|март)/i,
  /^(apr|апрел)/i,
  /^(may|ма[яй])/i,
  /^(jun|июн)/i,
  /^(jul|июл)/i,
  /^(aug|август)/i,
  /^(sep|сентябр)/i,
  /^(oct|октябр)/i,
  /^(nov|ноябр)/i,
  /^(dec|декабр)/i,
]
/** The month named right after a number ("29 сентября") or right before it ("September 23"): "09", or null. */
function monthAround(text: string, at: number, length: number): string | null {
  const after = /^[\s–-]*(?:\d{1,2}\s+)?(\p{L}+)/u.exec(text.slice(at + length))?.[1] ?? ''
  const before = /(\p{L}+)\s+$/u.exec(text.slice(0, at))?.[1] ?? ''
  for (const word of [after, before]) {
    const i = MONTHS.findIndex((re) => re.test(word))
    if (i >= 0) return String(i + 1).padStart(2, '0')
  }
  return null
}

/**
 * Numbers the answer gives that its context never had: a count or a fact
 * about the vault ("67 dailies") must come from what it read, never from a
 * guess. A number of two digits or more, or any number counting notes, tasks,
 * days and the like, is a claim; a list's "1.", "2-3 ideas" and "1:1" are not.
 * Written another way ("450,000" for "450 000") it is the same number, and the
 * sum or difference of two numbers the context has ("you still need 230 000"
 * of 540 000 with 310 000 saved) is worked out from it, not made up. The
 * question's own numbers count as given (contextText includes the prompt).
 */
export function numberClaims(answer: string, contextText: string): string[] {
  const whole = [...joinThousands(contextText).matchAll(ANY_NUMBER)].map((m) => m[0])
  // Each number, and the parts of a date or a version ("2026" of 2026-09-23) - the parts are not summed.
  const given = new Set(whole.flatMap((t) => [normal(t), ...t.split(/[-/:]/), t.replace(/\.0+$/, '')]))
  const values = [
    ...new Set(
      whole
        .map(normal)
        .filter((g) => /^\d+(\.\d+)?$/.test(g))
        .map(Number),
    ),
  ].slice(0, 400)
  const derived = (n: number): boolean => values.some((a) => values.some((b) => a + b === n || a - b === n))
  const isoDays = new Set([...contextText.matchAll(/\d{4}-(\d{2})-(\d{2})/g)].map((m) => `${m[1]}-${m[2]}`))
  const out = new Set<string>()
  for (const line of joinThousands(answer).split('\n')) {
    const body = line.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '')
    for (const m of body.matchAll(NUMBER)) {
      // "230 тысяч", "1.5 million": the word is part of the number.
      const scale = /^\s*(тысяч\p{L}*|тыс\.?|thousand)/iu.test(body.slice(m.index! + m[0].length))
        ? 1e3
        : /^\s*(млн|миллион\p{L}*|million)/iu.test(body.slice(m.index! + m[0].length))
          ? 1e6
          : 1
      const n = scale === 1 || !/^\d+(\.\d+)?$/.test(normal(m[0])) ? normal(m[0]) : String(Number(normal(m[0])) * scale)
      const counts = COUNTED.test(body.slice(m.index! + m[0].length))
      if (n.length < 2 && !counts) continue
      if (given.has(n)) continue
      // "2-3 notes a day", "1/2", "1:1": a range, a fraction or a ratio of its own making.
      if (/^\d[-/:]\d$/.test(n)) continue
      if (/^\d+(\.\d+)?$/.test(n) && derived(Number(n))) continue
      // "29 сентября", "23 September": a day in words, the context's 2026-09-29.
      const month = monthAround(body, m.index!, m[0].length)
      if (month !== null && /^\d{1,2}$/.test(n) && isoDays.has(`${month}-${n.padStart(2, '0')}`)) continue
      out.add(m[0])
    }
  }
  return [...out]
}

const STOP = new Set(
  'about these those their there which where while would could should after before other every being having within without first second third really things thing notes users their yours about также этого этой которые который которая может можно очень своих своей твоих твоей заметки заметка заметке заметок'.split(
    ' ',
  ),
)
/** "X is a …", "X describes …", «X - это …»: the answer saying what a note or a project is. */
const DESCRIBES =
  /\b(?:is|are|was)\s+(?:a|an|the|about|your|my)\b|\b(?:describes?|covers?|explains?|documents?|is about|focuses on)\b|\s(?:—|-)\s*это\b|\bэто\s|описыва\p{L}*|посвящ\p{L}*|рассказыва\p{L}*/iu

/**
 * Sentences that say what a note or project is, in words found nowhere in
 * what the answer was given: a description of a note it didn't read, or made
 * up for one it did ("Transcript pipeline is a tool for…" when the note says
 * something else). A sentence counts when it names a note it had (or "the
 * project", «проект») and describes it with three or more longer words, none
 * of which - by their first five letters - are in the context.
 */
export function descriptionClaims(answer: string, context: readonly ContextNote[], contextText: string): string[] {
  const given = fold(contextText)
  const stems = new Set((given.match(/\p{L}{5,}/gu) ?? []).map((w) => w.slice(0, 5)))
  // A sentence can only be checked against notes in its own script: a Russian line about an English
  // note shares no words with it and is not made up for that. What the notes are written in: the
  // context after the prompt's own rules (which are English).
  const notesPart = contextText.slice(Math.max(0, contextText.indexOf('## Right now')))
  const letters = notesPart.match(/\p{L}/gu) ?? []
  const cyrillicShare = letters.length === 0 ? 0 : letters.filter((l) => /\p{Script=Cyrillic}/u.test(l)).length / letters.length
  const checkable = (sentence: string): boolean => {
    const cyrillic = (sentence.match(/\p{Script=Cyrillic}/gu) ?? []).length > (sentence.match(/\p{Script=Latin}/gu) ?? []).length
    return cyrillic ? cyrillicShare >= 0.3 : cyrillicShare <= 0.7
  }
  const names = [...new Set(context.flatMap((c) => [fold(noteName(c.path)), fold(c.title)]))].filter((n) => n.length >= 3)
  const out: string[] = []
  // Facts come before the model's own ideas; what follows "My suggestions" is its own.
  const facts = answer.split(/^.*(?:my suggestions?|my ideas|мои идеи|мои предложения).*$/im)[0] ?? ''
  for (const sentence of facts.split(/(?<=[.!?])\s+|\n+/)) {
    const s = fold(sentence.replace(/[*_`#>]/g, ''))
    if (!checkable(s)) continue
    const verb = DESCRIBES.exec(s)
    if (verb === null) continue
    if (!names.some((n) => s.includes(n)) && !/\b(?:the|this|your) project\b|проект/.test(s)) continue
    const words = (s.slice(verb.index + verb[0].length).match(/\p{L}{5,}/gu) ?? []).filter(
      (w) => !STOP.has(w) && !names.some((n) => n.includes(w)),
    )
    if (words.length >= 3 && words.every((w) => !stems.has(w.slice(0, 5)))) out.push(sentence.trim().slice(0, 80))
  }
  return out
}

/**
 * The model's own words: the answer without what the harness wrote for it
 * (a task list quotes the notes' items in their own language, and their
 * quotes). Runs from before the preface was recorded drop the list's "•"
 * lines instead.
 */
export function ownWords(a: Pick<Answered, 'answer' | 'preface'>): string {
  if (a.preface != null && a.answer.startsWith(a.preface)) return a.answer.slice(a.preface.length)
  return a.answer
    .split('\n')
    .filter((l) => !/^\s*•/.test(l))
    .join('\n')
}

export function score(c: Case, a: Answered, vaultTitles: readonly string[] = []): Scores {
  const read = notesRead(a.context).map(fold)
  const top4 = read.slice(0, 4)
  const expected = c.expectNotes.map(fold)
  const noSources = c.expectNoSources || c.kind === 'small-talk' || c.kind === 'self'
  const recall4 = expected.length === 0 ? null : expected.filter((n) => top4.includes(n)).length / Math.min(4, expected.length)
  const items = c.expectItems.length === 0 ? null : c.expectItems.filter((i) => mentions(a.answer, i)).length / c.expectItems.length
  const routed = (a.router as { kind?: unknown } | null | undefined)?.kind
  const routerOk = typeof routed === 'string' ? routed === ROUTE[c.kind] : null
  const decoys = c.forbidNotes.map(fold).filter((n) => read.includes(n))
  const own = ownWords(a)
  // A template or a draft in code ("[[Related note]]" as a placeholder, `[[Link]]` as syntax) is a suggestion, not a claim.
  const ungrounded = ungroundedClaims(own.replace(/```[\s\S]*?```|`[^`\n]*`/g, ' '), a.context, vaultTitles, a.contextText ?? '')
  const namedInAnswer = expected.length === 0 ? null : expected.some((n) => fold(a.answer).includes(n))
  const sourcesCorrect = noSources ? read.length === 0 : expected.length > 0 ? expected.some((n) => read.includes(n)) : null
  const honest = c.kind === 'not-in-vault' ? saysNotFound(a.answer) : null
  const languageOk = own.trim() === '' || languageOf(own) === languageOf(c.question)

  const reasons: Reason[] = []
  if (a.error !== null) reasons.push(a.error.toLowerCase().includes('timeout') || a.error.includes('aborted') ? 'too slow' : 'error')
  if (recall4 !== null && recall4 < 0.5)
    reasons.push(c.kind === 'named-note' ? 'ignored named note' : recall4 === 0 && read.length > 0 ? 'wrong note' : 'retrieval miss')
  if (noSources && read.length > 0) reasons.push('unneeded retrieval')
  if (honest === false) reasons.push('hallucination')
  if (!languageOk) reasons.push('language')
  if (items !== null && items < 0.75) reasons.push('missing items')
  if (decoys.length > 0) reasons.push('decoy in context')
  if (ungrounded.length > 0) reasons.push('ungrounded claim')
  if (routerOk === false) reasons.push('wrong route')
  const pass = reasons.length === 0
  if (a.totalMs > SLOW_MS && !reasons.includes('too slow')) reasons.push('too slow')
  return { recall4, items, routerOk, ungrounded, namedInAnswer, sourcesCorrect, honest, languageOk, pass, reasons }
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
  items: number | null
  routerAccuracy: number | null
  ungrounded: number
  /** Router replies that could not be read as JSON. */
  routerParseFailures: number
  /** Tool calls the model made itself, and the ones it wrote as text instead (parse failures). */
  modelToolCalls: number
  toolParseFailures: number
  /** How the router decided: by rules, by the example questions, by the model. */
  routerBy: { rules: number; embedding: number; model: number }
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
    items: mean(rows.flatMap((r) => (r.scores.items == null ? [] : [r.scores.items]))),
    routerAccuracy: share(rows.map((r) => r.scores.routerOk ?? null)),
    ungrounded: rows.reduce((n, r) => n + (r.scores.ungrounded?.length ?? 0), 0),
    routerParseFailures: rows.filter((r) => (r.answered.router as { parseFailed?: boolean } | null | undefined)?.parseFailed === true)
      .length,
    modelToolCalls: rows.reduce(
      (n, r) => n + ((r.answered.toolCalls as { by?: string }[] | null | undefined) ?? []).filter((t) => t.by === 'model').length,
      0,
    ),
    toolParseFailures: rows.reduce((n, r) => n + ((r.answered as { toolParseFailures?: number }).toolParseFailures ?? 0), 0),
    routerBy: {
      rules: rows.filter((r) => (r.answered.router as { by?: string } | null | undefined)?.by === 'rules').length,
      embedding: rows.filter((r) => (r.answered.router as { by?: string } | null | undefined)?.by === 'embedding').length,
      model: rows.filter((r) => (r.answered.router as { by?: string } | null | undefined)?.by === 'model').length,
    },
    ttftP50: percentile(ttft, 50),
    ttftP90: percentile(ttft, 90),
    totalP50: percentile(total, 50),
    totalP90: percentile(total, 90),
    tokensPerSec: mean(speeds),
  }
}
