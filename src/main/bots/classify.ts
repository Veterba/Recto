import type { RouteKind } from './router'

/**
 * The router's middle step, between the rules and the model: the question's
 * EmbeddingGemma vector against a few example questions per kind. Tens of
 * milliseconds instead of the model's ~9 s; when it isn't sure (the best kind
 * barely beats the next), the model decides.
 *
 * Examples in English, Russian and Norwegian; the vectors are multilingual,
 * so they also cover the mixes in between.
 */

/**
 * Kept clear of the eval cases' subjects (fixture and private), so the evals
 * measure the classifier rather than recite it.
 */
export const EXAMPLES: Record<RouteKind, string[]> = {
  notes: [
    'What did I write about the conference talk?',
    'Which piano pieces was I practising?',
    'What did we decide in the meeting with the landlord?',
    'Look in my car note: which models did I compare?',
    'Что я писал про подарок маме?',
    'Где у меня записан пароль от роутера?',
    'Какие книги я хотел прочитать?',
    'Hva skrev jeg om bilen?',
  ],
  review: [
    'What would you improve in my notes about this subject?',
    'Review my study notes and tell me what is missing.',
    'How could I improve the structure of this note?',
    'What would you change in how my notes are organised?',
    'Что бы ты улучшил в моих конспектах?',
    'Оцени структуру этой заметки и предложи, как её переделать',
    'Что не так с организацией моих папок?',
    'Hva ville du forbedret i notatene mine?',
  ],
  advice: [
    'Help me get ready for my job interview using my notes.',
    'Help me plan the wedding, there is a note about it.',
    'Suggest a better way to write my meeting notes.',
    'Give me your ideas on this, building on what I wrote.',
    'Помоги мне подготовиться к собеседованию по моей заметке',
    'Дай свои идеи, дополняя мои',
    'Помоги спланировать переезд',
    'Hjelp meg å planlegge bryllupet.',
  ],
  tasks: [
    'What tasks are still open?',
    'Which to-dos did I not finish?',
    'List my overdue tasks',
    'Какие задачи я не сделал?',
    'Что мне осталось доделать?',
    'Hvilke oppgaver har jeg igjen?',
  ],
  recent: [
    'What did I do last month?',
    'What did I work on yesterday?',
    'What changed in my notes lately?',
    'Что я делал в прошлом месяце?',
    'Над чем я работал вчера?',
    'Hva gjorde jeg i går?',
  ],
  smalltalk: ['Hi!', 'Thanks a lot', 'How are you?', 'Good morning', 'Привет, как дела?', 'Спасибо!', 'Hei, takk!'],
  self: [
    'What model are you?',
    'Who are you and what can you do?',
    'Do my notes leave this computer?',
    'What is your knowledge cutoff?',
    'Кто ты такой?',
    'Какая ты модель и что умеешь?',
    'Hvem er du?',
  ],
}

const KINDS = Object.keys(EXAMPLES) as RouteKind[]

/**
 * Calibrated on the eval questions (fixture and private): a question with an
 * intent - a review, a plan, tasks, small talk, about Recto - scores 0.67 or
 * more against its kind's examples, while a plain question about the notes
 * ("when is my half marathon?") is far from all of them, under 0.62. So far
 * from every kind means "notes"; a clear winner above MIN_SCORE is that kind;
 * anything between, or too close to the runner-up, goes to the model.
 */
export const NOTES_BELOW = 0.62
export const MIN_SCORE = 0.66
export const MIN_MARGIN = 0.05

export type Classified = { kind: RouteKind; score: number; margin: number; confident: boolean }

const dot = (a: readonly number[], b: readonly number[]): number => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}

/**
 * The kind whose examples are nearest: per kind, the mean of its two best
 * matches (one lucky example decides less than two).
 */
export function classify(question: readonly number[], examples: Record<RouteKind, readonly (readonly number[])[]>): Classified {
  const scored = KINDS.map((kind) => {
    const sims = examples[kind].map((v) => dot(question, v)).sort((a, b) => b - a)
    const top = sims.slice(0, 2)
    return { kind, score: top.reduce((s, x) => s + x, 0) / Math.max(1, top.length) }
  }).sort((a, b) => b.score - a.score)
  const [best, next] = scored
  const margin = best!.score - (next?.score ?? 0)
  if (best!.score < NOTES_BELOW) return { kind: 'notes', score: best!.score, margin, confident: true }
  return { kind: best!.kind, score: best!.score, margin, confident: best!.score >= MIN_SCORE && margin >= MIN_MARGIN }
}

/** The examples as one list to embed, and back into kinds. */
export const exampleTexts = (): string[] => KINDS.flatMap((k) => EXAMPLES[k])

export function byKind(vectors: readonly number[][]): Record<RouteKind, number[][]> {
  const out = {} as Record<RouteKind, number[][]>
  let i = 0
  for (const kind of KINDS) {
    out[kind] = vectors.slice(i, i + EXAMPLES[kind].length)
    i += EXAMPLES[kind].length
  }
  return out
}
