import type { PeriodTasks, TaskGroup, TaskRow } from '../../shared/tasks'

/**
 * The answer to a tasks question, written by the harness: a small model drops
 * and invents items when it lists fifteen of them, so the list is put
 * together here and the model only passes it on (and may add a line).
 *
 * Shape: open first, grouped by day or note, at most 15 then "+N more"; open
 * cards with their due dates; then one line with how many got done and a few
 * examples - or, when the question asks what got done, the done list in full.
 * Every item says its note: a daily note is its date.
 */

export type Lang = 'en' | 'ru' | 'no'
export type Intent = 'open' | 'done' | 'overdue'

export const langOf = (text: string): Lang =>
  /[а-яё]/i.test(text) ? 'ru' : /[æøå]|\b(hva|hvilke|jeg|har|oppgaver|gjøremål|ferdig)\b/i.test(text) ? 'no' : 'en'

/** What the question asks for: what is still open (the default), what got done, or what is overdue. */
export function intentOf(question: string): Intent {
  const t = question.toLowerCase()
  if (/overdue|past due|late\b|просроч|forfalt|over fristen/.test(t)) return 'overdue'
  const done = /\b(finish(ed)?|done|complete(d)?|closed)\b|сделал|выполнил|закрыл|завершил|закончил|ferdig|fullført/.test(t)
  const open =
    /\b(open|unfinished|left|not done|haven't|didn't|still|to-?do)\b|не доделал|не сделал|осталось|открыт|недоделан|ikke gjort|gjenstår/.test(
      t,
    )
  return done && !open ? 'done' : 'open'
}

const L = {
  en: {
    open: (n: number) => `Still open (${n}):`,
    noneOpen: 'Nothing open.',
    cards: 'Cards:',
    done: (n: number) => `Done in this period: ${n}`,
    doneList: (n: number) => `Done (${n}):`,
    noneDone: 'Nothing was checked off in this period.',
    more: (n: number) => `+${n} more`,
    andMore: (n: number) => `and ${n} more`,
    due: 'due',
    overdue: 'overdue',
    noBox: 'no checkbox',
    noneOverdue: 'Nothing is overdue.',
    overdueList: (n: number) => `Overdue (${n}):`,
    about: (t: string) => ` about “${t}”`,
    status: (s: string) => ({ todo: 'to do', doing: 'in progress', done: 'done' })[s] ?? s,
  },
  ru: {
    open: (n: number) => `Не доделано (${n}):`,
    noneOpen: 'Открытых задач нет.',
    cards: 'Карточки:',
    done: (n: number) => `Сделано за этот период: ${n}`,
    doneList: (n: number) => `Сделано (${n}):`,
    noneDone: 'За этот период ничего не отмечено сделанным.',
    more: (n: number) => `и ещё ${n}`,
    andMore: (n: number) => `и ещё ${n}`,
    due: 'срок',
    overdue: 'просрочено',
    noBox: 'без чекбокса',
    noneOverdue: 'Просроченного нет.',
    overdueList: (n: number) => `Просрочено (${n}):`,
    about: (t: string) => ` про «${t}»`,
    status: (s: string) => ({ todo: 'не начато', doing: 'в работе', done: 'готово' })[s] ?? s,
  },
  no: {
    open: (n: number) => `Fortsatt åpent (${n}):`,
    noneOpen: 'Ingenting åpent.',
    cards: 'Kort:',
    done: (n: number) => `Gjort i perioden: ${n}`,
    doneList: (n: number) => `Gjort (${n}):`,
    noneDone: 'Ingenting ble krysset av i perioden.',
    more: (n: number) => `+${n} til`,
    andMore: (n: number) => `og ${n} til`,
    due: 'frist',
    overdue: 'forfalt',
    noBox: 'uten avkrysning',
    noneOverdue: 'Ingenting er forfalt.',
    overdueList: (n: number) => `Forfalt (${n}):`,
    about: (t: string) => ` om «${t}»`,
    status: (s: string) => ({ todo: 'ikke startet', doing: 'pågår', done: 'ferdig' })[s] ?? s,
  },
} as const

const MONTHS: Record<Lang, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  no: ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'],
}
const dayName = (iso: string, lang: Lang): string => `${Number(iso.slice(8, 10))} ${MONTHS[lang][Number(iso.slice(5, 7)) - 1]}`

export type Inferred = { path: string; title: string; items: string[] }
export type Found = PeriodTasks & { inferred: Inferred[] }

/** Stems of words that say "tasks", "when" or "show me", not what the tasks are about. */
const GENERIC = [
  'task',
  'todo',
  'open',
  'done',
  'finish',
  'unfinish',
  'still',
  'left',
  'week',
  'last',
  'this',
  'which',
  'what',
  'overdue',
  'show',
  'all',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'yesterday',
  'today',
  'задач',
  'дела',
  'недел',
  'прошл',
  'остал',
  'додел',
  'сдела',
  'просроч',
  'посмот',
  'специфи',
  'тольк',
  'одну',
  'все',
  'всё',
  'ещё',
  'еще',
  'мне',
  'сред',
  'понедел',
  'вторн',
  'четвер',
  'пятниц',
  'суббот',
  'воскрес',
  'вчера',
  'сегодн',
  'oppgav',
  'gjøremål',
  'uke',
  'ferdig',
]

/**
 * The words that say what the tasks are about ("экспорт" in "что осталось
 * доделать по экспорту"), if the question names a topic. Terms are stems.
 */
export function topicWords(terms: readonly string[]): string[] {
  return terms.filter((t) => t.length >= 3 && !GENERIC.some((g) => t.startsWith(g) || g.startsWith(t)))
}

/** The question's own word for a stem, for showing it back ("экспор" → "экспорту"). */
const wordFor = (stem: string, question: string): string =>
  question.match(/[\p{L}\p{N}]+/gu)?.find((w) => w.toLowerCase().startsWith(stem)) ?? stem

const matches = (text: string, words: readonly string[]): boolean => {
  const t = text.toLowerCase()
  return words.some((w) => t.includes(w.slice(0, Math.max(4, w.length - 2))))
}

/** The answer, and the notes it names, in the order it names them (the answer's sources). */
export type TaskAnswer = { text: string; notes: { path: string; title: string }[] }

export function renderTaskAnswer(found: Found, question: string, terms: readonly string[], today: string): TaskAnswer {
  const lang = langOf(question)
  const s = L[lang]
  const intent = intentOf(question)
  const where = (row: TaskRow): string => (/^\d{4}-\d{2}-\d{2}$/.test(row.title) ? dayName(row.title, lang) : row.title)

  // A topic narrows the list - if anything matches it.
  const topic = topicWords(terms)
  const on = (g: TaskGroup, row: TaskRow): boolean => matches(`${g.text} ${row.title} ${row.board ?? ''}`, topic)
  const hasTopic =
    topic.length > 0 &&
    (found.open.some((x) => on(x.group, x.note)) ||
      found.done.some((x) => on(x.group, x.note)) ||
      found.inferred.some((x) => x.items.some((i) => matches(`${i} ${x.title}`, topic))))
  const open = hasTopic ? found.open.filter((x) => on(x.group, x.note)) : found.open
  const done = hasTopic ? found.done.filter((x) => on(x.group, x.note)) : found.done
  const inferred = hasTopic
    ? found.inferred
        .map((x) => ({ ...x, items: x.items.filter((i) => matches(`${i} ${x.title}`, topic)) }))
        .filter((x) => x.items.length > 0)
    : found.inferred

  const card = (g: TaskGroup, row: TaskRow): string => {
    const due = g.due === null ? '' : `, ${s.due} ${dayName(g.due, lang)}${g.open && g.due < today ? ` - ${s.overdue}` : ''}`
    return `${g.text} (${s.status(row.status ?? '')}${due})`
  }
  const lines: string[] = []
  const named: { path: string; title: string }[] = []
  const name = (row: { path: string; title: string }): void => {
    if (!named.some((n) => n.path === row.path)) named.push({ path: row.path, title: row.title })
  }
  const result = (): TaskAnswer => ({ text: lines.join('\n'), notes: named })

  if (intent === 'overdue') {
    const late = found.open.filter((x) => x.group.due !== null && x.group.due < today)
    lines.push(late.length === 0 ? s.noneOverdue : s.overdueList(late.length))
    for (const x of late) {
      lines.push(`• ${card(x.group, x.note)}`)
      name(x.note)
    }
    return result()
  }

  const openItems = open.filter((x) => x.group.source !== 'card')
  const cards = open.filter((x) => x.group.source === 'card')
  const loose = inferred.reduce((n, x) => n + x.items.length, 0)

  if (intent === 'done') {
    lines.push(done.length === 0 ? s.noneDone : s.doneList(done.length))
    for (const x of done) {
      lines.push(`• ${x.group.source === 'card' ? x.group.text : `${where(x.note)} - ${x.group.text}`}`)
      name(x.note)
    }
    if (openItems.length + cards.length > 0) lines.push('', `${s.open(openItems.length + cards.length).replace(/:$/, '')}.`)
    return result()
  }

  const total = openItems.length + cards.length + loose
  if (total === 0) lines.push(s.noneOpen)
  else {
    lines.push(hasTopic ? s.open(total).replace(' (', `${s.about(wordFor(topic[0]!, question))} (`) : s.open(total))
    // Grouped by the note each came from, in order.
    const byNote = new Map<string, { label: string; items: string[] }>()
    for (const x of openItems.slice(0, 15)) {
      name(x.note)
      const key = x.note.path
      const entry = byNote.get(key) ?? { label: where(x.note), items: [] }
      entry.items.push(x.group.text)
      byNote.set(key, entry)
    }
    for (const { label, items } of byNote.values()) lines.push(`• ${label} - ${items.join('; ')}`)
    if (openItems.length > 15) lines.push(`• ${s.more(openItems.length - 15)}`)
    for (const x of inferred) {
      lines.push(`• ${x.title} - ${x.items.join('; ')} (${s.noBox})`)
      name(x)
    }
    if (cards.length > 0) lines.push(`${s.cards} ${cards.map((x) => card(x.group, x.note)).join('; ')}`)
    for (const x of cards) name(x.note)
  }
  if (done.length > 0) {
    const examples = done.slice(0, 4).map((x) => x.group.text)
    lines.push('', `${s.done(done.length)} - ${examples.join(', ')}${done.length > 4 ? `, ${s.andMore(done.length - 4)}` : ''}.`)
    for (const x of done.slice(0, 4)) name(x.note)
  }
  return result()
}
