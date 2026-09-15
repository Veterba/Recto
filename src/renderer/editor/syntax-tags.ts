import nlp from 'compromise'

/**
 * Parts of speech, for iA Writer's syntax highlight: adjectives, nouns,
 * adverbs, verbs and conjunctions, each in its own colour.
 *
 * English goes through `compromise`, a small offline tagger - nothing leaves
 * the machine. Russian has no tagger that small, so it is tagged by rules:
 * conjunctions from a closed list (exact), adjectives, verbs and adverbs by
 * their endings, which in Russian carry the part of speech far more reliably
 * than in English, and nouns only where a word is long enough and matched
 * nothing else. It gets most of a sentence right and some of it wrong, and says
 * so in Settings.
 *
 * Tagged a paragraph at a time and cached by the paragraph's text: typing
 * re-tags one paragraph, and scrolling back to one already seen costs nothing.
 */

export type PartOfSpeech = 'adjective' | 'noun' | 'adverb' | 'verb' | 'conjunction'

export type Tag = { from: number; to: number; pos: PartOfSpeech }

const CACHE_LIMIT = 800
const cache = new Map<string, Tag[]>()

export function tagText(text: string): Tag[] {
  const hit = cache.get(text)
  if (hit !== undefined) return hit
  const tags = [...tagLatin(text), ...tagCyrillic(text)].sort((a, b) => a.from - b.from)
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(text, tags)
  return tags
}

// --- English ---------------------------------------------------------------------

type Term = { text: string; tags: string[]; offset: { start: number; length: number } }

/** Words iA leaves plain: articles, pronouns and the infinitive "to" are not the parts it colours. */
const ENGLISH_PLAIN = new Set(['to', 'not', 'no'])

function posOf(tags: readonly string[]): PartOfSpeech | null {
  const has = (tag: string): boolean => tags.includes(tag)
  if (has('Pronoun') || has('Possessive') || has('Determiner') || has('Value')) return null
  if (has('Conjunction')) return 'conjunction'
  if (has('Adverb')) return 'adverb'
  if (has('Verb') || has('Modal') || has('Copula') || has('Auxiliary')) return 'verb'
  if (has('Adjective') || has('Comparable')) return 'adjective'
  if (has('Noun')) return 'noun'
  return null
}

function tagLatin(text: string): Tag[] {
  if (!/[A-Za-z]/.test(text)) return []
  const out: Tag[] = []
  let sentences: { terms: Term[] }[]
  try {
    sentences = nlp(text).json({ offset: true, terms: { offset: true } }) as { terms: Term[] }[]
  } catch {
    return []
  }
  for (const sentence of sentences) {
    for (const term of sentence.terms) {
      if (!/[A-Za-z]/.test(term.text) || ENGLISH_PLAIN.has(term.text.toLowerCase())) continue
      const pos = posOf(term.tags)
      if (pos === null) continue
      // `term.text` is the word without its punctuation; find it inside the
      // offset span so "(friend)." colours only "friend".
      const span = text.slice(term.offset.start, term.offset.start + term.offset.length)
      const at = span.indexOf(term.text)
      const from = term.offset.start + Math.max(0, at)
      out.push({ from, to: from + term.text.length, pos })
    }
  }
  return out
}

// --- Russian ---------------------------------------------------------------------

const RU_CONJUNCTIONS = new Set([
  'и', 'а', 'но', 'или', 'либо', 'да', 'зато', 'однако', 'что', 'чтобы', 'если', 'когда', 'пока', 'хотя', 'потому',
  'поэтому', 'так', 'также', 'тоже', 'как', 'будто', 'словно', 'точно', 'ибо', 'причём', 'причем', 'притом',
  'ни', 'то', 'ли', 'раз', 'лишь', 'едва', 'чем', 'нежели', 'итак', 'затем', 'следовательно',
])

/** Words no rule should colour: pronouns, prepositions, particles. */
const RU_PLAIN = new Set([
  'я', 'ты', 'он', 'она', 'оно', 'мы', 'вы', 'они', 'меня', 'тебя', 'его', 'её', 'ее', 'нас', 'вас', 'их', 'мне',
  'тебе', 'ему', 'ей', 'нам', 'вам', 'им', 'мной', 'тобой', 'ним', 'ней', 'ними', 'себя', 'себе', 'собой',
  'в', 'во', 'на', 'с', 'со', 'к', 'ко', 'по', 'о', 'об', 'обо', 'от', 'до', 'из', 'за', 'под', 'над', 'при', 'про',
  'для', 'без', 'через', 'между', 'перед', 'у', 'не', 'же', 'бы', 'вот', 'уже', 'ещё', 'еще', 'это', 'этот', 'эта',
  'эти', 'тот', 'та', 'те', 'кто', 'где', 'куда', 'откуда', 'весь', 'вся', 'все', 'всё', 'сам', 'сама', 'само',
  'мой', 'моя', 'моё', 'мое', 'мои', 'твой', 'твоя', 'наш', 'наша', 'ваш', 'ваша', 'свой', 'своя', 'свои',
])

const RU_ADVERBS = new Set([
  'очень', 'уже', 'сейчас', 'теперь', 'всегда', 'никогда', 'иногда', 'часто', 'редко', 'здесь', 'там', 'тут',
  'туда', 'сюда', 'вчера', 'сегодня', 'завтра', 'потом', 'сразу', 'снова', 'опять', 'вместе', 'почти', 'совсем',
  'слишком', 'немного', 'много', 'мало', 'быстро', 'медленно', 'хорошо', 'плохо', 'легко', 'трудно', 'рано',
  'поздно', 'долго', 'вдруг', 'наверное', 'просто', 'действительно', 'конечно', 'обязательно', 'далеко', 'близко',
])

const ADJECTIVE = /(?:ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|ых|ую|юю|ыми|ими|ейш[а-я]+|айш[а-я]+)$/
const VERB = /(?:ть|ться|чь|ешь|ишь|ёшь|ете|ите|ет|ит|ют|ят|ут|ат|ем|им|ал|ял|ил|ел|ул|ала|яла|ила|ела|ало|или|али|ели|ыли|ся|сь)$/
const ADVERB = /(?:ски|цки|ьно|енно|онно|ально|ично|ательно|ительно)$/

function ruPos(word: string): PartOfSpeech | null {
  const w = word.toLowerCase()
  if (RU_CONJUNCTIONS.has(w)) return 'conjunction'
  if (RU_PLAIN.has(w)) return null
  if (RU_ADVERBS.has(w) || (w.length >= 5 && ADVERB.test(w))) return 'adverb'
  if (w.length >= 4 && /(?:ться|тся|ть|чь|ешь|ишь)$/.test(w)) return 'verb'
  if (w.length >= 4 && ADJECTIVE.test(w)) return 'adjective'
  if (w.length >= 4 && VERB.test(w)) return 'verb'
  if (w.length >= 3) return 'noun'
  return null
}

function tagCyrillic(text: string): Tag[] {
  if (!/[а-яё]/i.test(text)) return []
  const out: Tag[] = []
  for (const match of text.matchAll(/[а-яё]+(?:-[а-яё]+)*/gi)) {
    const pos = ruPos(match[0])
    if (pos === null) continue
    const from = match.index ?? 0
    out.push({ from, to: from + match[0].length, pos })
  }
  return out
}
