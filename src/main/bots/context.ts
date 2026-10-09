import type { AiMessage } from '../../shared/ai'
import { isEvalsPath, type BotSource } from '../../shared/bots'

/**
 * What a bot reads before it answers: the parts of the vault that best match
 * the question. Version 0, kept simple on purpose - the search index the app
 * already has, then the best heading sections of the notes it finds. Pure, so
 * every step can be tested without a vault or a model.
 */

/** Words a question is made of that say nothing about what it is asking. English and Russian. */
const STOPWORDS = new Set(
  `a an and are as at be but by can could did do does for from had has have how i if in into is it its me my
  no not of on or our so than that the their them then there these they this to was we were what when where
  which who why will with would you your about did does done just also any some more most very much
  и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от
  меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж
  вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без
  будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один
  почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть после
  над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед
  иногда лучше чуть том нельзя такой им более всегда конечно всю между мои мой моё моих
  hi hey hei hello hallo hej yo thanks thank thx please cool nice great good morning evening night bye
  okay yeah yep nope sure
  привет приветик здравствуй здравствуйте спасибо пожалуйста пока хорошо отлично ок окей ага угу ладно
  доброе добрый утро вечер ночи
  note notes help try itself based use using future currently current suggest improve would could should give tell
  заметка заметки заметок заметках заметку помоги дай расскажи посмотри исходя опираясь`.split(/\s+/),
)

const WORD = /[\p{L}\p{N}]+/gu

/**
 * The words worth searching for. Long words are cut back to a stem, so the
 * index's prefix search finds "decided" from "decide" and "заметках" from
 * "заметки" - crude, and much better than matching nothing.
 */
export function queryTerms(question: string, max = 8): string[] {
  const terms: string[] = []
  for (const match of question.toLowerCase().matchAll(WORD)) {
    const word = match[0]
    if (word.length < 3 || STOPWORDS.has(word)) continue
    const stem = word.length >= 7 ? word.slice(0, word.length - 2) : word
    if (!terms.includes(stem)) terms.push(stem)
    if (terms.length === max) break
  }
  return terms
}

/**
 * Is `path` inside one of `folders` (vault-relative, compared case-insensitively)?
 * The eval runner's reports always are: a bot never reads its own old answers.
 */
export function isExcluded(path: string, folders: readonly string[]): boolean {
  if (isEvalsPath(path)) return true
  const lower = path.toLowerCase()
  return folders.some((folder) => {
    const f = folder.toLowerCase().replace(/^\/+|\/+$/g, '')
    return f !== '' && (lower === f || lower.startsWith(`${f}/`))
  })
}

/**
 * Notes ranked across the per-term searches: first by how many of the
 * question's words they contain, then by how high each search ranked them.
 */
export function rankNotes(
  hitsByTerm: readonly (readonly { path: string }[])[],
  exclude: readonly string[],
): { path: string; score: number }[] {
  const scores = new Map<string, number>()
  for (const hits of hitsByTerm) {
    hits.forEach((hit, rank) => {
      if (isExcluded(hit.path, exclude)) return
      scores.set(hit.path, (scores.get(hit.path) ?? 0) + 1 + 1 / (rank + 2))
    })
  }
  return [...scores].map(([path, score]) => ({ path, score })).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
}

export type Section = { heading: string | null; text: string }

/**
 * How well a section matches: each term in its text counts, more if it comes
 * up often; a term in its heading adds a little. Text outweighs headings on
 * purpose - "Topics run" is not about topics naming because of its title.
 */
export function scoreSection(section: Section, terms: readonly string[]): number {
  const text = section.text.toLowerCase()
  const heading = (section.heading ?? '').toLowerCase()
  let score = 0
  for (const term of terms) {
    const hits = (where: string): number => where.match(termPattern(term))?.length ?? 0
    if (hits(heading) > 0) score += 0.5
    const inText = hits(text)
    if (inText > 0) score += 1 + Math.min(2, (inText - 1) * 0.25)
  }
  return score
}

/**
 * Where a term counts: at the start of a word, as the index's prefix search
 * finds it - "decid" in "decided", never in "undecided". A term of three
 * letters must be the whole word, or "hei" is found in every "height".
 */
function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}${term.length <= 3 ? '(?![\\p{L}\\p{N}])' : ''}`, 'gu')
}

/**
 * The least a section must score to be read: one of the question's words in
 * its text. A word only in its heading is not enough to answer from.
 */
export const MIN_SECTION_SCORE = 1

/**
 * How many of the question's words must be in a section's text for it to be
 * read: two, when the question has two or more. One stray word is chance -
 * "capital of France" found "capitalise" in a log - and a bot answering "your
 * vault doesn't cover it" should not list notes under it.
 */
export function enoughTerms(section: Section, terms: readonly string[], title = ''): boolean {
  // The note's title counts: "where did we eat?" about the note «Тбилиси» names the city only in its title.
  const text = `${title}\n${section.text}`.toLowerCase()
  const found = terms.filter((term) => termPattern(term).test(text)).length
  return found >= Math.min(2, terms.length)
}

/** A piece of a note given to the model. `idx`: its place among the note's search pieces (chunks.ts), when it is one. */
export type Chunk = BotSource & { text: string; title: string; idx?: number }

/** The bot's own instructions, then what it found in the vault - or a plain statement that it found nothing. */
export function buildSystem(botSystem: string, chunks: readonly Chunk[] | null): string {
  // Small talk ("hei", "thanks") asks nothing of the vault: no notes, and no
  // line saying none matched, or the bot answers a greeting with an apology.
  if (chunks === null) return botSystem.trim()
  const notes =
    chunks.length === 0
      ? "No notes in the vault matched this question. Say so in one line, and don't answer it from general knowledge - the user asked about their notes."
      : chunks.map((c) => `### ${c.title} (${c.path}${c.heading === null ? '' : ` › ${c.heading}`})\n${c.text}`).join('\n\n')
  return `${botSystem.trim()}\n\n## Notes from the vault\n\n${notes}`
}

/** Tokens, roughly: three characters each, which over-counts English and is about right for Russian. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3)

/**
 * The conversation, newest last, cut from the front to fit what is left of
 * the context window. The question being asked always stays.
 */
export function fitHistory(messages: readonly AiMessage[], budgetTokens: number): AiMessage[] {
  const kept: AiMessage[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    const cost = estimateTokens(message.content)
    if (kept.length > 0 && used + cost > budgetTokens) break
    kept.unshift(message)
    used += cost
  }
  // A thread must start with the user's turn, never mid-answer.
  while (kept.length > 1 && kept[0]!.role !== 'user') kept.shift()
  return kept
}
