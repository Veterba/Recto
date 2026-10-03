import type { AiMessage } from '../../shared/ai'
import { periodFrom, todayLine, type Period } from './period'
import { queryTerms } from './context'
import type { BotModelProvider } from './provider'
import type { Classified } from './classify'

/**
 * The router: one short call before the answer that says what kind of
 * message this is and what to look for. Small talk and questions about Recto
 * itself skip the vault entirely; tasks and "what did I do" questions go to
 * the task index and the notes of their period; everything else is a vault
 * search - with the question rewritten to stand alone, and search words in
 * both English and Russian, so a Russian question finds English notes.
 *
 * The model only classifies and rewrites. Dates are worked out in code
 * (period.ts) from the time words; when the call fails or returns nonsense,
 * the message is treated as a plain question about the notes.
 */

export const ROUTE_KINDS = ['notes', 'smalltalk', 'self', 'tasks', 'recent', 'review', 'advice'] as const
export type RouteKind = (typeof ROUTE_KINDS)[number]

export type Route = {
  kind: RouteKind
  /** The question, rewritten to stand on its own. */
  query: string
  keywordsEn: string[]
  keywordsRu: string[]
  /** Note titles the user named ("look in Recto plan", [[Recto plan]]). */
  notes: string[]
  /** The time words as the user wrote them, if any. */
  when: string | null
  period: Period | null
  /** The scope the user named in their own words ("math notes", "my vault"), from the model; code resolves it. */
  scope: string | null
  /** The model's reply could not be read: these are the defaults. */
  parseFailed: boolean
  /** Decided by the rules (quickKind), the example questions (classify.ts) or the model. */
  by: 'rules' | 'embedding' | 'model'
  /** The classifier's best kind and how sure it was, when it was asked. */
  classified?: { kind: RouteKind; score: number; margin: number }
  ms: number
}

const ROUTER_SYSTEM = `Sort the message for an assistant that answers from the user's notes. Never answer it. JSON only:
{"kind":"notes|smalltalk|self|tasks|recent|review|advice","query":"...","keywords_en":[],"keywords_ru":[],"notes":[],"when":null,"scope":null}
smalltalk: greetings, thanks, chit-chat. self: about the assistant itself (model, knowledge, privacy). tasks: the user's to-dos, open/done/overdue. recent: what the user did or changed in a period. review: improve or critique notes, a note's structure, the vault. advice: help to plan or prepare, ideas or suggestions built on the notes. notes: everything else.
query: the message made standalone using the earlier turns, else "".
keywords_en: up to 3 search words in ENGLISH - translate them if the message is not in English. keywords_ru: the same words in RUSSIAN - translate them if the message is not in Russian. Nouns and names only.
Example: "Когда у меня полумарафон?" -> {"kind":"notes","query":"","keywords_en":["half marathon","race"],"keywords_ru":["полумарафон","забег"],"notes":[],"when":null}
notes: note titles the user explicitly named, else []. when: the time words as written, else null. scope: the group of notes the user named in their words ("math notes", "my vault", "project X"), else null.`

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()) : []

/** The router's reply as a route; whatever is missing or wrong falls back to "a question about the notes". */
export function parseRoute(raw: string, question: string, today: Date): Omit<Route, 'ms' | 'by'> {
  const fallback = { kind: 'notes' as const, query: question, keywordsEn: [], keywordsRu: [], notes: [], when: null, scope: null }
  let parsed: Record<string, unknown> | null = null
  try {
    const json = /\{[\s\S]*\}/.exec(raw)?.[0]
    if (json !== undefined) parsed = JSON.parse(json) as Record<string, unknown>
  } catch {
    parsed = null
  }
  const kind = parsed !== null && (ROUTE_KINDS as readonly unknown[]).includes(parsed['kind']) ? (parsed['kind'] as RouteKind) : null
  const base =
    parsed === null || kind === null
      ? { ...fallback, parseFailed: true }
      : {
          kind,
          query: typeof parsed['query'] === 'string' && parsed['query'].trim().length > 2 ? parsed['query'].trim() : question,
          keywordsEn: asList(parsed['keywords_en']),
          keywordsRu: asList(parsed['keywords_ru']),
          notes: asList(parsed['notes']),
          when: typeof parsed['when'] === 'string' && parsed['when'].trim() !== '' ? parsed['when'].trim() : null,
          scope: typeof parsed['scope'] === 'string' && parsed['scope'].trim() !== '' ? parsed['scope'].trim() : null,
          parseFailed: false,
        }
  // The period: from the user's own words first, then from the words the router picked out.
  const period = periodFrom(question, today) ?? (base.when === null ? null : periodFrom(base.when, today))
  return { ...base, period }
}

/**
 * The obvious cases, decided without the model: a greeting or a thank-you,
 * a question about Recto itself, a question about tasks or about what the
 * user did lately. Returns null when it isn't obvious - then the model sorts
 * it. Rules are fast (the model call costs seconds on a 16 GB Mac) and, for
 * these, more reliable than a small model.
 */
export function quickKind(message: string): RouteKind | null {
  const t = message.toLowerCase().trim()
  const words = t.match(/[\p{L}\p{N}]+/gu) ?? []
  const SMALLTALK =
    /^(hi|hey|hello|hei|hallo|yo|thanks?|thank you|thx|ty|ok|okay|cool|nice|great|lol|haha+|ha+|wow|good (morning|night|evening)|bye|привет|приветик|здравствуй(те)?|спасибо|пасиб|благодарю|ок|окей|ага|класс|круто|супер|отлично|хорошо|понятно|ясно|пока|доброе утро|спокойной ночи|ха+|takk|tusen takk|ha det)(?![\p{L}\p{N}])/u
  if (
    words.length <= 6 &&
    SMALLTALK.test(t) &&
    !/\b(what|how|where|when|which|who|why|что|как|где|когда|какой|какие|кто|почему|hva|hvor|når)\b/.test(t)
  )
    return 'smalltalk'
  if (words.length === 0) return 'smalltalk'
  if (
    /\b(what|which) (model|llm)|\bwho are you\b|what are you\b|your (knowledge|training|cutoff)|knowledge cutoff|are my notes (sent|uploaded|shared)|do you send|leave (my|this) (computer|mac)|about yourself\b|как о модели|о себе|какая ты модель|какая (у тебя )?модель|кто ты(?![\p{L}])|чем ты (можешь быть )?полез|твои знания|твоих знаний|откуда ты|отправляются ли|куда уходят|hvilken modell|hvem er du/u.test(
      t,
    )
  )
    return 'self'
  if (
    /\b(to-?dos?|tasks?|unfinished|overdue|still open|left to do|haven't (done|finished)|didn't (do|finish)|did i (finish|complete)|have i (done|finished))\b|задач|не доделал|не сделал|недоделан|доделать|осталось сделать|просроч|дела на|список дел|oppgave|gjøremål/.test(
      t,
    )
  )
    return 'tasks'
  // "What did I write about Japan?" is a question about the notes; "what did I do last week" is about a period.
  const timed = /\b(lately|recently|these days)\b|недавно|в последнее время|i det siste/.test(t) || periodFrom(t, new Date()) !== null
  if (
    timed &&
    /\bwhat (did|have) i (do|done|work(ed)? on|write|written|change)|what('s| is) new\b|what changed\b|что (я )?(делал|сделал|писал|менял|нового)|чем я занимал|над чем я работал|hva gjorde jeg|hva har jeg gjort/.test(
      t,
    )
  )
    return 'recent'
  if (/\b(improve|improvements?|critique|review|restructure|what would you change)\b|улучш|переделал бы|что не так|forbedre/.test(t))
    return 'review'
  if (
    /\bhelp me (with|prepare|plan|get ready)|\bprepare (me )?for\b|\bsuggest\b|\b(your|some) (ideas|advice|suggestions)\b|помоги|подготов|посоветуй|(свои|твои) идеи|предложи|hjelp meg/.test(
      t,
    )
  )
    return 'advice'
  return null
}

/** The question's vector against the example questions; null when there is no embedding model. */
export type Classifier = (question: string) => Promise<Classified | null>

/**
 * Which kind of message this is, and what to search for. Never throws.
 *
 * Rules first (instant); then, for a question with no earlier turns, the
 * example questions (classify.ts, tens of milliseconds); the model only when
 * the classifier isn't sure, or for a follow-up, whose "it" and "there" need
 * the earlier turns rewritten into it. A question routed without the model
 * searches with its own words - its other language is the vectors' job.
 */
export async function route(
  provider: BotModelProvider,
  model: string,
  messages: readonly AiMessage[],
  today: Date,
  classifier: Classifier | null = null,
): Promise<Route> {
  const started = performance.now()
  const question = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const plain = (kind: RouteKind, by: 'rules' | 'embedding', classified?: Classified): Route => ({
    kind,
    query: question,
    keywordsEn: kind === 'smalltalk' || kind === 'self' ? [] : queryTerms(question),
    keywordsRu: [],
    notes: [],
    when: null,
    scope: null,
    period: periodFrom(question, today),
    parseFailed: false,
    by,
    ...(classified === undefined ? {} : { classified: { kind: classified.kind, score: classified.score, margin: classified.margin } }),
    ms: performance.now() - started,
  })
  // The obvious ones need no model: the words of the question are the search words.
  const quick = quickKind(question)
  if (quick !== null) return plain(quick, 'rules')
  const followUp = messages.slice(0, -1).some((m) => m.role === 'assistant')
  const classified = classifier === null || followUp ? null : await classifier(question).catch(() => null)
  // The classifier may only say what the rules would have caught on a closer look: never tasks or recent.
  if (classified !== null && classified.confident && classified.kind !== 'tasks' && classified.kind !== 'recent')
    return plain(classified.kind, 'embedding', classified)
  // The last two turns before the question, for "it" and "there".
  const before = messages.slice(0, -1).slice(-2)
  const earlier = before.map((m) => `${m.role === 'user' ? 'User' : 'Recto'}: ${m.content.slice(0, 600)}`).join('\n')
  const user = `Today is ${todayLine(today)}.${earlier === '' ? '' : `\nEarlier turns:\n${earlier}`}\nMessage: ${question}`
  let raw = ''
  try {
    raw = await provider.complete([{ role: 'user', content: user }], ROUTER_SYSTEM, {
      model,
      signal: AbortSignal.timeout(30_000),
      json: true,
      maxTokens: 140,
    })
  } catch {
    raw = ''
  }
  const parsed = parseRoute(raw, question, today)
  // Tasks and "what did I do" questions are the rules' to catch; when the model calls one of these
  // a tasks question and the rules didn't, it is nearly always a plain question ("when is my
  // half marathon?") - answered from the notes, not the task list.
  const kind = parsed.kind === 'tasks' || parsed.kind === 'recent' ? 'notes' : parsed.kind
  return {
    ...parsed,
    kind,
    by: 'model',
    ...(classified === null ? {} : { classified: { kind: classified.kind, score: classified.score, margin: classified.margin } }),
    ms: performance.now() - started,
  }
}

/**
 * Search words for a routed question: the rewritten question's own words,
 * then the router's English and Russian keywords - so a Russian question
 * also looks for the English words of an English note.
 */
export function routedTerms(question: string, r: Route | null): string[] {
  if (r === null) return queryTerms(question)
  const terms = [...queryTerms(r.query), ...r.keywordsEn.flatMap((k) => queryTerms(k)), ...r.keywordsRu.flatMap((k) => queryTerms(k))]
  return [...new Set(terms)].slice(0, 12)
}
