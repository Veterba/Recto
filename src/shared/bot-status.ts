import type { BotJob, BotStep } from './bots'

/**
 * The status text beside the working face, in the header and in the sidebar
 * row: what the answer is doing right now, worded from its real steps and in
 * the question's language. Never a claim about something that isn't
 * happening - with no step running it is only "Thinking…".
 *
 * Each phrase comes with calm variants, shown in turn when a step runs long
 * (BotStatus.tsx), so a slow step still reads as alive.
 */

export type Lang = BotJob['lang']

/** Mostly Cyrillic letters: Russian; anything else gets English. */
export const langOfText = (text: string): Lang => {
  const letters = text.match(/\p{L}/gu) ?? []
  const cyrillic = letters.filter((l) => /\p{Script=Cyrillic}/u.test(l)).length
  return letters.length > 0 && cyrillic / letters.length > 0.3 ? 'ru' : 'en'
}

/** The phrase first, then its calm variants. */
type Phrases = readonly [string, ...string[]]

const THINKING: Record<Lang, Phrases> = { en: ['Thinking…', 'Still thinking…'], ru: ['Думаю…', 'Ещё думаю…'] }
const WRITING: Record<Lang, Phrases> = { en: ['Writing…', 'Still writing…'], ru: ['Пишу…', 'Ещё пишу…'] }

function forStep(step: BotStep, lang: Lang): Phrases {
  const ru = lang === 'ru'
  const subject = step.subject ?? ''
  switch (step.kind) {
    case 'tasks':
      return ru ? ['Смотрю задачи…', 'Ещё смотрю задачи…'] : ['Checking your tasks…', 'Still checking your tasks…']
    case 'period':
      return ru ? [`Листаю ${subject}…`, `Ещё листаю ${subject}…`] : [`Going through ${subject}…`, `Still going through ${subject}…`]
    case 'read':
    case 'open':
      return ru ? [`Читаю ${subject}…`, `Всё ещё читаю ${subject}…`] : [`Reading ${subject}…`, `Still reading ${subject}…`]
    case 'search':
    case 'map':
      return ru
        ? ['Копаюсь в заметках…', 'Ещё ищу…', 'Смотрю дальше…']
        : ['Digging through notes…', 'Still digging…', 'Looking a bit further…']
    default:
      return THINKING[lang]
  }
}

/** What the job is doing now, with its calm variants; null when it isn't working (queued or ended). */
export function statusPhrases(job: Pick<BotJob, 'state' | 'steps' | 'text' | 'lang'>): Phrases | null {
  if (job.state !== 'preparing' && job.state !== 'streaming') return null
  if (job.text !== '') return WRITING[job.lang]
  const running = job.steps.findLast((s) => s.state === 'running')
  return running === undefined ? THINKING[job.lang] : forStep(running, job.lang)
}

/** The folded steps card: "Looked through 12 notes", «Просмотрел 12 заметок», else the number of steps. */
export function stepsSummary(steps: readonly BotStep[]): string {
  const ru = steps.some((s) => /\p{Script=Cyrillic}/u.test(s.action))
  // "12 notes", «12 заметок», a scope read "31/31", a note opened.
  const count = (step: BotStep): number =>
    Number(/(\d+)\s+(?:notes?|заметк\p{L}*)/u.exec(step.result)?.[1] ?? /^\d+\/(\d+)$/.exec(step.result)?.[1]) ||
    (step.kind === 'open' && step.state === 'done' ? 1 : 0)
  const notes = steps.reduce((sum, step) => sum + count(step), 0)
  if (ru)
    return notes > 0
      ? `Просмотрел ${notes} ${plural(notes, 'заметку', 'заметки', 'заметок')}`
      : `${steps.length} ${plural(steps.length, 'шаг', 'шага', 'шагов')}`
  if (notes > 0) return `Looked through ${notes} ${notes === 1 ? 'note' : 'notes'}`
  return `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`
}

/** Russian plural: 1 заметку, 2 заметки, 5 заметок. */
export const plural = (n: number, one: string, few: string, many: string): string => {
  const d = n % 10
  const dd = n % 100
  return d === 1 && dd !== 11 ? one : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many
}
