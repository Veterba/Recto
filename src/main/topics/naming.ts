/**
 * Naming a topic: two nouns, in their base form, in the vault's one language.
 *
 *  1. Only prose: code, inline code, URLs, file paths, frontmatter and link
 *     targets are stripped before a word is looked at.
 *  2. Only nouns, lemmatized (see lemma), minus stopwords - including the
 *     verbs and filler nouns every plan and to-do list is full of.
 *  3. Nothing most of the vault says: a noun in more than half the eligible
 *     notes names no topic in particular.
 *  4. Something the topic's notes share: a noun most of them use.
 *  5. c-TF-IDF: a noun's weight in a topic is how often its notes use it,
 *     scaled by how rare it is in the vault. The best 15 go on.
 *  6. The embedding decides: the two candidates whose own vector is closest
 *     to the topic's centroid are the name.
 *
 * The name is always in the vault's language. A cluster written in another
 * one takes its candidates from its own language and translates them (see
 * dictionary); each candidate's translation is the one closest to the
 * centroid, and must clear TRANSLATION_FLOOR and mean what the word it
 * translates means (SAME_MEANING). A proper name ("Rust") is not translated.
 *
 * A cluster that leaves fewer than two words is not a topic.
 */

import { cosine } from './vectors'


export type Lang = 'en' | 'ru' | 'no'

const words = (list: string): Set<string> => new Set(list.split(/\s+/).filter((w) => w !== ''))

const STOP: Record<Lang, Set<string>> = {
  en: words(`
    a about above after again against all also am an and any are as at be because been before being below
    between both but by can could did do does doing down during each few for from further had has have having
    he her here hers herself him himself his how i if in into is it its itself just let like make many may me
    might more most much must my myself new no nor not now of off often on once one only or other our ours
    ourselves out over own really same see she should so some such than that the their theirs them themselves
    then there these they thing things this those through to too two under until up use used using very want
    was way we well were what when where which while who whom why will with would yes yet you your yours
    yourself yourselves get got good also still even every need needs note notes etc via lot lots something
    try tries tried trying return returns returned returning make makes made go goes went do done work works
    learn learned study studied write wrote written read run runs set sets call calls take took give gave find
    found look see saw know knew think thought create created build built start started show shows add added
    thing way time example part kind point case question problem idea people person day year step lot bit end
    today tomorrow yesterday week month plan plans task tasks todo list lists page pages file files text stuff
    link links article video source sources info information
  `),
  ru: words(`
    а без более бы был была были было быть в вам вас весь во вот все всё всего всех вы где да даже для до его
    ее её ей ему если есть еще ещё же за здесь и из или им их к как какой когда кто ли либо мне может мы на
    над надо наш не него нее неё нет ни них но ну о об однако он она они оно от очень по под при с со так
    также такой там те тем то того тоже той только том ты у уже хотя чего чей чем что чтобы чье эта эти это
    этого этой этом этот я можно нужно будет было есть свой своей свою себя себе всегда просто очень потом
    почему потому раз сейчас теперь тогда через между после перед много мало который которая которые
    изучить изучать попробовать пробовать возвращать вернуть использовать делать сделать работать мочь хотеть
    понять понимать знать писать написать читать прочитать говорить начать начинать получить получать дать
    давать взять брать найти искать смотреть посмотреть решить решать нужный важный разобраться научиться
    вещь время раз день год неделя месяц пример случай способ вопрос проблема тема часть штука человек дело
    момент заметка задача план список цель идея итог ссылка видео статья источник информация страница файл
    текст конец начало вид тип образ сторона место слово
  `),
  no: words(`
    alle andre at av bare begge ble blei bli blir blitt bort da de deg dei deim deira deires dem den denne der
    dere deres det dette di din disse ditt du dykk dykkar då eg ein eit eitt eller elles en enn er et ett
    etter for fordi fra før ha hadde han hans har hennar henne hennes her hjå ho hoe honom hoss hossen hun
    hva hvem hver hvilke hvilken hvis hvor hvordan hvorfor i ikke ikkje ingen ingi inkje inn inni ja jeg kan
    kom korleis korso kun kunne kva kvar kvarhelst kven kvi kvifor man mange me med medan meg meget mellom men
    mi min mine mitt mot mykje ned no noe noen noka noko nokon nokor nokre nå når og også om opp oss over på
    samme seg selv si sia sidan siden sin sine sitt sjøl skal skulle slik so som somme somt så sånn til um
    upp ut uten var vart varte ved vere verte vi vil ville vore vors vort være vært å
  `),
}

const ALL_STOP = new Set([...STOP.en, ...STOP.ru, ...STOP.no])
const CYRILLIC = /\p{Script=Cyrillic}/u

/**
 * A translated name word must be at least this close to the topic's centroid.
 * Low, because a word in another language than the notes sits ~0.1 lower
 * against them than the word it translates.
 */
export const TRANSLATION_FLOOR = 0.05
/** And this close to the word it translates: the same meaning, not another sense of it. */
export const SAME_MEANING = 0.8

/** A vault's language changes only when another leads it by this many notes. */
export const LANGUAGE_MARGIN = 5

/** A noun in more than this share of the vault's eligible notes names nothing in particular. */
export const VAULT_SHARE_CAP = 0.5

/** How many c-TF-IDF candidates the embedding reranks. */
export const CANDIDATES = 15

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/
const FENCED = /^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(^[ \t]*\1[ \t]*$|(?![\s\S]))/gm
const INLINE_CODE = /`[^`\n]*`/g
const WIKILINK = /!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g
const MD_LINK = /(!?)\[([^\]]*)\]\([^)\n]*\)/g
const URL = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi
const EMAIL = /\S+@\S+\.\S+/g
const HTML_TAG = /<\/?[a-z][^>\n]*>/gi
/** Anything with a slash or backslash in it, or a dotted name with an extension: `src/main`, `~/x`, `app.js`. */
const PATH = /(?:^|\s)\S*[\\/]\S*|\b[\w-]+\.(?:[a-z]{1,5})\b/gi

/** What a topic may be named from: prose only. */
export function nameText(raw: string): string {
  return raw
    .replace(FRONTMATTER, '')
    .replace(FENCED, ' ')
    .replace(INLINE_CODE, ' ')
    .replace(WIKILINK, (_m, _target: string, alias?: string) => ` ${alias ?? ''} `)
    .replace(MD_LINK, (_m, bang: string, text: string) => (bang === '!' ? ' ' : ` ${text} `))
    .replace(URL, ' ')
    .replace(EMAIL, ' ')
    .replace(HTML_TAG, ' ')
    .replace(PATH, ' ')
}

/** The language a text is mostly in: Cyrillic is Russian; among Latin text, Norwegian stopwords and letters decide. */
export function language(text: string): Lang {
  const all = text.toLowerCase().match(/\p{L}+/gu) ?? []
  const cyrillic = all.filter((w) => CYRILLIC.test(w)).length
  if (cyrillic > all.length / 2) return 'ru'
  let no = 0
  let en = 0
  for (const w of all) {
    if (/[æøå]/.test(w) || (STOP.no.has(w) && !STOP.en.has(w))) no++
    else if (STOP.en.has(w) && !STOP.no.has(w)) en++
  }
  return no > en ? 'no' : 'en'
}

/**
 * The vault's one naming language: the language most eligible notes are in.
 * It changes only when another leads the current one by LANGUAGE_MARGIN notes,
 * so a vault that is half and half does not flip back and forth - and never to
 * `declined`, a switch the user undid.
 */
export function vaultLanguage(
  counts: Partial<Record<Lang, number>>,
  current: Lang | null,
  declined: Lang | null = null,
): Lang | null {
  const n = (l: Lang | null): number => (l === null ? 0 : (counts[l] ?? 0))
  const leader = (Object.keys(counts) as Lang[])
    .filter((l) => n(l) > 0)
    .sort((a, b) => n(b) - n(a) || (a === current ? -1 : b === current ? 1 : a.localeCompare(b)))[0]
  if (leader === undefined) return current
  if (current === null) return leader
  if (leader === current || leader === declined) return current
  return n(leader) - n(current) >= LANGUAGE_MARGIN ? leader : current
}

/** A word written in the language's own script, and nothing else: no Latin in a Russian name, no Cyrillic in an English one. */
export function inScript(word: string, lang: Lang): boolean {
  if (lang === 'ru') return /^\p{Script=Cyrillic}+(-\p{Script=Cyrillic}+)*$/u.test(word)
  if (lang === 'no') return /^[a-zæøå]+(-[a-zæøå]+)*$/.test(word)
  return /^[a-z]+(-[a-z]+)*$/.test(word)
}

/** A lemma that may name a topic: three letters or more, in the script, not a stopword. */
export const nameable = (lemma: string, lang: Lang): boolean =>
  [...lemma].length >= 3 && inScript(lemma, lang) && !ALL_STOP.has(lemma)

/**
 * The best CANDIDATES nouns for a topic, by c-TF-IDF. `members` and `vault`
 * are notes as their nameable lemmas; `members` only the topic's notes in the
 * vault's language, of `size` in all. A noun must occur in more than half of
 * all `size` - a name most of the topic's own notes do not use describes a
 * genre, not a subject - and in no more than VAULT_SHARE_CAP of the vault.
 */
export function candidates(
  members: readonly (readonly string[])[],
  size: number,
  vault: readonly (readonly string[])[],
  count = CANDIDATES,
): string[] {
  const vaultFreq = new Map<string, number>()
  const vaultDocs = new Map<string, number>()
  let vaultWords = 0
  for (const terms of vault) {
    for (const w of terms) vaultFreq.set(w, (vaultFreq.get(w) ?? 0) + 1)
    for (const w of new Set(terms)) vaultDocs.set(w, (vaultDocs.get(w) ?? 0) + 1)
    vaultWords += terms.length
  }
  const tf = new Map<string, number>()
  const df = new Map<string, number>()
  let topicWords = 0
  for (const terms of members) {
    for (const w of terms) tf.set(w, (tf.get(w) ?? 0) + 1)
    for (const w of new Set(terms)) df.set(w, (df.get(w) ?? 0) + 1)
    topicWords += terms.length
  }
  // Average words per "class", counting the vault as one: the A of c-TF-IDF.
  const average = (vaultWords + topicWords) / 2 || 1
  const needed = Math.floor(size / 2) + 1
  return [...tf.entries()]
    .filter(([w]) => (df.get(w) ?? 0) >= needed && (vaultDocs.get(w) ?? 0) <= VAULT_SHARE_CAP * vault.length)
    .map(([w, n]) => ({ w, score: (n / (topicWords || 1)) * Math.log(1 + average / (vaultFreq.get(w) ?? n)) }))
    .sort((a, b) => b.score - a.score || a.w.localeCompare(b.w))
    .slice(0, count)
    .map(({ w }) => w)
}

/**
 * The name's two words: the candidates closest to the centroid, best first.
 * Null when fewer than two remain - and then there is no topic.
 */
export function pickKeywords(ranked: readonly { term: string; sim: number }[]): string[] | null {
  const picked: string[] = []
  for (const { term } of [...ranked].sort((a, b) => b.sim - a.sim || a.term.localeCompare(b.term))) {
    if (picked.length === 3) break
    if (!picked.some((p) => sameStem(p, term))) picked.push(term)
  }
  return picked.length >= 2 ? picked : null
}

/** Crude but language-blind: two words sharing their first five letters (or all of the shorter one) are one word. */
const sameStem = (a: string, b: string): boolean => {
  const n = Math.min(5, [...a].length, [...b].length)
  return [...a].slice(0, n).join('') === [...b].slice(0, n).join('')
}

/** The language most of a cluster's notes are in; a tie goes to the vault's. */
export function clusterLanguage(langs: readonly Lang[], vault: Lang): Lang {
  const counts = new Map<Lang, number>()
  for (const l of langs) counts.set(l, (counts.get(l) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] === vault ? -1 : b[0] === vault ? 1 : a[0].localeCompare(b[0])))[0]?.[0] ?? vault
}

/** A word written capitalised in most of its occurrences is a name: "Rust" the language, not rust. */
export function isProperName(word: string, texts: readonly string[]): boolean {
  let upper = 0
  let all = 0
  const pattern = new RegExp(`(?<![\\p{L}])(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{L}])`, 'giu')
  for (const text of texts) {
    for (const m of text.matchAll(pattern)) {
      all++
      if (m[1]![0] !== m[1]![0]!.toLowerCase()) upper++
    }
  }
  return all > 0 && upper * 2 > all
}

export type NamingInput = {
  /** The cluster's notes: their language, nameable lemmas and prose. */
  members: readonly { lang: Lang; terms: readonly string[]; prose: string }[]
  /** Every eligible note's nameable lemmas, for rarity. */
  vault: readonly (readonly string[])[]
  vaultLang: Lang
  center: ArrayLike<number>
  taken: ReadonlySet<string>
  /** Words as vectors comparable with the centroid (EmbeddingGemma, centred). */
  embed: (terms: string[]) => Promise<ArrayLike<number>[]>
  translate: (word: string, from: Lang, to: Lang) => string[]
  /** Whether a word in the vault language is a noun, for translations (the dictionary knows only glosses). */
  isNoun: (word: string, lang: Lang) => boolean
}

export type Naming = { name: string | null; from: Lang; failed?: 'candidates' | 'translation' }

/** A cluster's name in the vault's language, or null - then it is not a topic. */
export async function nameCluster(input: NamingInput): Promise<Naming> {
  const from = clusterLanguage(input.members.map((m) => m.lang), input.vaultLang)
  const own = input.members.filter((m) => m.lang === from).map((m) => m.terms)
  const terms = candidates(own, input.members.length, input.vault)
  if (terms.length < 2) return { name: null, from, failed: 'candidates' }
  let ranked: { term: string; sim: number }[]
  if (from === input.vaultLang) {
    const vectors = await input.embed(terms)
    ranked = terms.map((term, i) => ({ term, sim: cosine(vectors[i]!, input.center) }))
  } else {
    const prose = input.members.filter((m) => m.lang === from).map((m) => m.prose)
    const sources = terms.filter((t) => !isProperName(t, prose))
    const options = sources.map((t) =>
      [...new Set(input.translate(t, from, input.vaultLang))].filter((w) => nameable(w, input.vaultLang) && input.isNoun(w, input.vaultLang)),
    )
    const flat = [...new Set(options.flat())]
    const vectors = flat.length === 0 ? [] : await input.embed([...sources, ...flat])
    const vectorOf = new Map([...sources, ...flat].map((w, i) => [w, vectors[i]!]))
    ranked = []
    sources.forEach((source, k) => {
      const best = options[k]!
        .filter((w) => cosine(vectorOf.get(w)!, vectorOf.get(source)!) >= SAME_MEANING)
        .map((w) => ({ term: w, sim: cosine(vectorOf.get(w)!, input.center) }))
        .sort((a, b) => b.sim - a.sim)[0]
      if (best !== undefined && best.sim >= TRANSLATION_FLOOR && !ranked.some((r) => r.term === best.term)) ranked.push(best)
    })
  }
  const keys = pickKeywords(ranked)
  if (keys === null) return { name: null, from, failed: from === input.vaultLang ? 'candidates' : 'translation' }
  return { name: topicName(keys, input.taken), from }
}

const capitalise = (w: string): string => w.charAt(0).toLocaleUpperCase() + w.slice(1)

/**
 * "Processor · memory": the top two keywords, the first capitalised. Unique
 * among `taken` (case-insensitive): a collision takes the third keyword, and
 * a number if even that is taken.
 */
export function topicName(keys: readonly string[], taken: ReadonlySet<string>): string {
  const free = (name: string): boolean => !taken.has(name.toLowerCase())
  const base = keys.length === 0 ? 'Topic' : [capitalise(keys[0]!), ...keys.slice(1, 2)].join(' · ')
  if (free(base)) return base
  if (keys.length >= 3) {
    const longer = `${base} · ${keys[2]}`
    if (free(longer)) return longer
  }
  for (let n = 2; ; n++) if (free(`${base} ${n}`)) return `${base} ${n}`
}
