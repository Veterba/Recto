import type { AiMessage } from '../../shared/ai'
import type { BotSource } from '../../shared/bots'
import { CODE_FENCE } from '../../shared/parse'
import { frontmatterClose } from '../../shared/frontmatter'

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
  иногда лучше чуть том нельзя такой им более всегда конечно всю между мои мой моё моих`.split(/\s+/),
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

/** Is `path` inside one of `folders` (vault-relative, compared case-insensitively)? */
export function isExcluded(path: string, folders: readonly string[]): boolean {
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

/** Longest a section is allowed to be before it is cut into paragraphs-sized pieces. */
const PIECE_CHARS = 1200

/**
 * A note in heading sections, frontmatter dropped. Headings inside code
 * fences are text. A long section comes back as several pieces, each keeping
 * its heading.
 */
export function splitSections(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/)
  const close = frontmatterClose(lines)
  const body = close === -1 ? lines : lines.slice(close + 1)
  const sections: Section[] = []
  let heading: string | null = null
  let buffer: string[] = []
  let inFence = false

  const flush = (): void => {
    const text = buffer.join('\n').trim()
    buffer = []
    if (text === '') return
    let piece = ''
    for (const paragraph of text.split(/\n\s*\n/)) {
      if (piece !== '' && piece.length + paragraph.length > PIECE_CHARS) {
        sections.push({ heading, text: piece })
        piece = ''
      }
      piece = piece === '' ? paragraph : `${piece}\n\n${paragraph}`
    }
    if (piece !== '') sections.push({ heading, text: piece.length > PIECE_CHARS * 2 ? piece.slice(0, PIECE_CHARS * 2) : piece })
  }

  for (const line of body) {
    if (CODE_FENCE.test(line)) inFence = !inFence
    const h = inFence ? null : /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    if (h !== null) {
      flush()
      heading = h[1]!.trim()
      continue
    }
    buffer.push(line)
  }
  flush()
  return sections
}

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
    if (heading.includes(term)) score += 0.5
    if (text.includes(term)) score += 1 + Math.min(2, (text.split(term).length - 2) * 0.25)
  }
  return score
}

export type Chunk = BotSource & { text: string; title: string }

/**
 * What the bot reads, at most `max` sections and `budget` characters, in two
 * passes. First each ranked note's opening section, in rank order, whenever it
 * matches: a note says what it is about - in a log, what was decided - at the
 * top, and a later section can outscore it just by mentioning the words in
 * passing. Then the best other sections fill what is left, at most two from
 * one note so a long note cannot crowd out the rest. A note that matched only
 * by its title still gives its opening.
 */
export function selectChunks(
  notes: readonly { path: string; title: string; score: number; sections: readonly Section[] }[],
  terms: readonly string[],
  { max = 6, budget = 6000 }: { max?: number; budget?: number } = {},
): Chunk[] {
  const openings: Chunk[] = []
  const others: (Chunk & { score: number })[] = []
  for (const note of notes) {
    const [opening, ...rest] = note.sections
    if (opening === undefined) continue
    const chunk = (section: Section): Chunk => ({ path: note.path, heading: section.heading, title: note.title, text: section.text })
    const best = rest
      .map((section) => ({ section, score: scoreSection(section, terms) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
    if (scoreSection(opening, terms) > 0 || best.length === 0) openings.push(chunk(opening))
    for (const { section, score } of best) others.push({ ...chunk(section), score: score + note.score })
  }
  others.sort((a, b) => b.score - a.score)

  // Openings take at most two thirds of the places, so the best sections elsewhere still get in.
  const ordered: Chunk[] = [...openings.slice(0, Math.ceil((max * 2) / 3)), ...others.map(({ score: _score, ...chunk }) => chunk)]
  const chosen: Chunk[] = []
  let used = 0
  for (const chunk of ordered) {
    if (chosen.length === max) break
    const room = budget - used
    if (room < 200) break
    const text = chunk.text.length > room ? `${chunk.text.slice(0, room - 1).trimEnd()}…` : chunk.text
    chosen.push({ ...chunk, text })
    used += text.length
  }
  return chosen
}

/** The bot's own instructions, then what it found in the vault - or a plain statement that it found nothing. */
export function buildSystem(botSystem: string, chunks: readonly Chunk[]): string {
  const notes =
    chunks.length === 0
      ? 'No notes in the vault matched this question.'
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
