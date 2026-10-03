import { parse } from 'yaml'

/**
 * Eval cases: the fixture's own (tests/bots/eval/cases.yaml, strict) and the
 * user's private ones (tests/bots/eval/private/*.yaml), which may be loose -
 * a question and the notes it should find, sometimes an answer in one line.
 * Loose files are read as they are and normalised in memory, never rewritten.
 */

export type Turn = { role: 'user' | 'assistant'; content: string }

export const KINDS = [
  'same-language',
  'cross-language',
  'named-note',
  'follow-up',
  'recent',
  'tasks',
  'not-in-vault',
  'small-talk',
  'self',
  'review',
  'advice',
  'private',
] as const

export type Kind = (typeof KINDS)[number]

export type Case = {
  id: string
  kind: Kind
  messages: Turn[]
  question: string
  expectNotes: string[]
  expectAnswer: string | null
  expectNoSources: boolean
  /** Things the answer must name, each "a|b" for either wording. */
  expectItems: string[]
  /** Notes that must never be in the context. */
  forbidNotes: string[]
  /** What a good answer must contain or avoid, for whoever judges it (private cases). */
  rubric?: string[]
}

export type CaseFile = { today: string | null; cases: Case[] }

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)

const list = (value: unknown): string[] => {
  if (typeof value === 'string')
    return value
      .split(/[,;]\s*/)
      .map((s) => s.trim())
      .filter(Boolean)
  // A loose YAML item with a colon in it ("Uses the note: …") reads as a one-key mapping: put it back together.
  const item = (v: unknown): string =>
    typeof v === 'string'
      ? v.trim()
      : typeof v === 'object' && v !== null && !Array.isArray(v)
        ? Object.entries(v)
            .map(([k, x]) => `${k}: ${String(x)}`)
            .join('; ')
        : String(v)
  if (Array.isArray(value)) return value.map(item).filter(Boolean)
  return []
}

const turns = (value: unknown): Turn[] =>
  Array.isArray(value)
    ? value.flatMap((t): Turn[] => {
        const role = (t as { role?: unknown }).role
        const content = text((t as { content?: unknown }).content)
        return (role === 'user' || role === 'assistant') && content !== null ? [{ role, content }] : []
      })
    : []

const kindOf = (value: unknown): Kind => ((KINDS as readonly unknown[]).includes(value) ? (value as Kind) : 'private')

/** One case from whatever shape it was written in. Null when there is no question in it. */
function normalise(raw: unknown, index: number, prefix: string): Case | null {
  if (typeof raw === 'string') raw = { question: raw }
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const question = text(r['question'] ?? r['q'] ?? r['ask'] ?? r['prompt'])
  if (question === null) return null
  const expectNoSources = r['expectNoSources'] === true || r['noSources'] === true
  return {
    id: text(r['id']) ?? `${prefix}-${String(index + 1).padStart(2, '0')}`,
    kind: kindOf(r['kind']),
    messages: turns(r['messages'] ?? r['history']),
    question,
    expectNotes: list(r['expectNotes'] ?? r['notes'] ?? r['expect'] ?? r['sources']).map((n) =>
      n.replace(/^\[\[|\]\]$/g, '').replace(/\.md$/i, ''),
    ),
    expectAnswer: text(r['expectAnswer'] ?? r['answer'] ?? r['a']),
    expectNoSources,
    expectItems: list(r['expectItems'] ?? r['items']),
    forbidNotes: list(r['forbidNotes']).map((n) => n.replace(/^\[\[|\]\]$/g, '').replace(/\.md$/i, '')),
    ...(Array.isArray(r['rubric']) ? { rubric: list(r['rubric']) } : {}),
  }
}

/**
 * Cases from YAML text. Takes `cases: [...]` or a bare list, and also a plain
 * mapping of question → notes (the loosest way to write one down).
 */
export function readCases(yamlText: string, prefix = 'case'): CaseFile {
  const doc = parse(yamlText) as unknown
  let items: unknown[] = []
  let today: string | null = null
  if (Array.isArray(doc)) items = doc
  else if (typeof doc === 'object' && doc !== null) {
    const d = doc as Record<string, unknown>
    today = text(d['today'] instanceof Date ? (d['today'] as Date).toISOString().slice(0, 10) : d['today'])
    if (Array.isArray(d['cases'])) items = d['cases']
    else
      items = Object.entries(d)
        .filter(([key]) => key !== 'today')
        .map(([question, notes]) =>
          typeof notes === 'object' && notes !== null && !Array.isArray(notes) ? { question, ...notes } : { question, notes },
        )
  }
  const cases = items.map((item, i) => normalise(item, i, prefix)).filter((c): c is Case => c !== null)
  // Ids must be unique: a second one gets a number.
  const seen = new Map<string, number>()
  for (const c of cases) {
    const n = (seen.get(c.id) ?? 0) + 1
    seen.set(c.id, n)
    if (n > 1) c.id = `${c.id}-${n}`
  }
  return { today, cases }
}

/** The conversation as the bot gets it: the earlier turns, then the question. */
export const conversationOf = (c: Case): Turn[] => [...c.messages, { role: 'user', content: c.question }]
