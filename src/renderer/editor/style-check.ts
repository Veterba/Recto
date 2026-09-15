/**
 * Style check, after iA Writer: fillers, clichés and redundancies, struck
 * through so you see them without being told off.
 *
 * Word lists, not a model. That is the point of the feature as iA designed it:
 * it does not rewrite anything or claim a word is wrong - a filler is sometimes
 * exactly the right word - it only makes the habit visible. English and
 * Russian, since those are the languages these notes are written in, plus
 * whatever the writer adds as their own.
 */

export type StyleKind = 'filler' | 'cliche' | 'redundancy' | 'custom'

export type StyleIssue = { from: number; to: number; kind: StyleKind; text: string }

export type StyleOptions = {
  fillers: boolean
  cliches: boolean
  redundancies: boolean
  custom: boolean
  customWords: readonly string[]
}

const FILLERS = [
  // English
  'actually', 'basically', 'really', 'very', 'just', 'quite', 'rather', 'somewhat', 'literally', 'totally',
  'completely', 'absolutely', 'definitely', 'certainly', 'probably', 'simply', 'anyway', 'anyways', 'also',
  'pretty much', 'kind of', 'sort of', 'a bit', 'a little bit', 'more or less', 'you know', 'i mean',
  'honestly', 'seriously', 'essentially', 'practically', 'virtually', 'obviously', 'clearly', 'surely',
  'extremely', 'incredibly', 'truly', 'highly', 'fairly', 'perhaps', 'maybe', 'somehow', 'overall',
  'in fact', 'of course', 'needless to say', 'at the moment', 'for the most part',
  // Russian
  'как бы', 'типа', 'короче', 'вообще', 'вообще-то', 'в общем', 'в принципе', 'собственно', 'на самом деле',
  'реально', 'буквально', 'практически', 'просто', 'конечно', 'определённо', 'определенно', 'абсолютно',
  'совершенно', 'довольно', 'достаточно', 'немного', 'чуть-чуть', 'как-то', 'значит', 'так сказать',
  'в каком-то смысле', 'по сути', 'по большому счёту', 'по большому счету', 'скорее всего', 'вроде',
  'вроде бы', 'наверное', 'очень', 'действительно', 'фактически', 'ну',
]

const CLICHES = [
  // English
  'at the end of the day', 'in a nutshell', 'think outside the box', 'low-hanging fruit', 'move the needle',
  'game changer', 'game-changer', 'paradigm shift', 'best practices', 'at this point in time', 'in this day and age',
  'last but not least', 'the bottom line', 'it goes without saying', 'only time will tell', 'avoid like the plague',
  'easier said than done', 'a perfect storm', 'push the envelope', 'circle back', 'touch base', 'take it to the next level',
  'in the grand scheme of things', 'when all is said and done', 'the tip of the iceberg', 'a double-edged sword',
  'the elephant in the room', 'hit the ground running', 'on the same page', 'a win-win', 'deep dive', 'think big',
  'cutting edge', 'cutting-edge', 'state of the art', 'state-of-the-art', 'at the speed of light', 'crystal clear',
  'few and far between', 'in the nick of time', 'lost track of time', 'read between the lines',
  // Russian
  'на сегодняшний день', 'в данный момент', 'играет важную роль', 'играет ключевую роль', 'не секрет, что',
  'ни для кого не секрет', 'в наше время', 'в современном мире', 'как известно', 'стоит отметить', 'следует отметить',
  'необходимо отметить', 'нельзя не отметить', 'в рамках', 'на данном этапе', 'по-своему уникальный',
  'имеет место быть', 'вне всякого сомнения', 'последнее, но не менее важное', 'выйти из зоны комфорта',
  'зона комфорта', 'точка роста', 'на постоянной основе', 'в режиме реального времени', 'широкий спектр',
]

const REDUNDANCIES = [
  // English
  'added bonus', 'advance planning', 'advance warning', 'basic fundamentals', 'close proximity', 'end result',
  'final outcome', 'free gift', 'past history', 'future plans', 'unexpected surprise', 'join together',
  'repeat again', 'revert back', 'return back', 'each and every', 'first and foremost', 'true fact', 'past experience',
  'completely finished', 'absolutely essential', 'totally unique', 'very unique', 'new innovation', 'still remains',
  'plan ahead', 'combine together', 'merge together', 'collaborate together', 'ask the question', 'personal opinion',
  'general consensus', 'consensus of opinion', 'safe haven', 'sum total', 'over exaggerate', 'exact same',
  'mutual cooperation', 'brief summary', 'honest truth', 'end product', 'actual fact', 'at this time',
  // Russian
  'свободная вакансия', 'памятный сувенир', 'прейскурант цен', 'своя автобиография', 'коллега по работе',
  'моя автобиография', 'впервые знакомиться', 'вернуться обратно', 'подняться вверх', 'спуститься вниз',
  'упасть вниз', 'главная суть', 'основная суть', 'в конечном итоге', 'совместное сотрудничество',
  'взаимное сотрудничество', 'предварительное планирование', 'период времени', 'месяц май', 'ведущий лидер',
  'необычный феномен', 'народный фольклор', 'истинная правда', 'мёртвый труп', 'мертвый труп', 'темный мрак',
  'тёмный мрак', 'первая премьера', 'внутренний интерьер', 'повторить снова', 'ценный подарок', 'в конце концов',
]

/** Letters, digits and the apostrophes inside words: what a word boundary means here. */
const WORD = "\\p{L}\\p{N}'’"

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * One regex per list, longest phrases first so "a little bit" wins over "a bit".
 * Spaces in a phrase match any run of whitespace, so a line break mid-phrase
 * still counts.
 */
function compile(words: readonly string[]): RegExp | null {
  const clean = [...new Set(words.map((word) => word.trim().toLowerCase()).filter((word) => word !== ''))]
  if (clean.length === 0) return null
  clean.sort((a, b) => b.length - a.length)
  const body = clean.map((word) => escape(word).replace(/\s+/g, '\\s+')).join('|')
  return new RegExp(`(?<![${WORD}])(?:${body})(?![${WORD}])`, 'giu')
}

const BUILT_IN: Readonly<Record<Exclude<StyleKind, 'custom'>, RegExp>> = {
  filler: compile(FILLERS)!,
  cliche: compile(CLICHES)!,
  redundancy: compile(REDUNDANCIES)!,
}

let customSource = ''
let customRegex: RegExp | null = null

/**
 * Every issue in `text`, sorted, with no two overlapping.
 *
 * Where two lists match the same words the longer match wins, then the more
 * specific kind: a cliché that contains a filler is one cliché, not a cliché
 * with a filler struck through inside it.
 */
export function findStyleIssues(text: string, options: StyleOptions): StyleIssue[] {
  const found: StyleIssue[] = []
  const run = (regex: RegExp | null, kind: StyleKind): void => {
    if (regex === null) return
    regex.lastIndex = 0
    for (const match of text.matchAll(regex)) {
      const from = match.index ?? 0
      found.push({ from, to: from + match[0].length, kind, text: match[0] })
    }
  }

  if (options.custom) {
    const source = options.customWords.join('\n')
    if (source !== customSource) {
      customSource = source
      customRegex = compile(options.customWords)
    }
    run(customRegex, 'custom')
  }
  if (options.cliches) run(BUILT_IN.cliche, 'cliche')
  if (options.redundancies) run(BUILT_IN.redundancy, 'redundancy')
  if (options.fillers) run(BUILT_IN.filler, 'filler')

  const rank: Record<StyleKind, number> = { custom: 0, cliche: 1, redundancy: 2, filler: 3 }
  found.sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from) || rank[a.kind] - rank[b.kind])
  const out: StyleIssue[] = []
  let end = -1
  for (const issue of found) {
    if (issue.from < end) continue
    out.push(issue)
    end = issue.to
  }
  return out
}

export const STYLE_LABELS: Readonly<Record<StyleKind, string>> = {
  filler: 'Filler',
  cliche: 'Cliché',
  redundancy: 'Redundancy',
  custom: 'Your word',
}
