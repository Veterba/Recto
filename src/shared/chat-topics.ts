import type { BotMessage, BotSource } from './bots'
import { frontmatterClose } from './frontmatter'
import { CODE_FENCE } from './parse'

/**
 * A conversation with a bot is split into chat topics, and each topic is a
 * markdown file of its own: `chats/<bot>/YYYY-MM-DD HH-mm — <title>.md`.
 * (Chat topics are not the vault's topics feature - the clustering one - and
 * the code says "chat topic" to keep the two apart.)
 *
 *   ---
 *   bot: recto
 *   created: 2026-10-02T15:30
 *   title: Soil mix
 *   ---
 *
 *   ## You
 *
 *   What goes in the soil mix?
 *
 *   ## Recto
 *
 *   Compost, loam and grit.
 *
 *   <!-- recto:sources [...] -->
 *
 * The title lives in the frontmatter and the file name, nowhere else. The body
 * is kept as the text it is: a new turn is appended to it, never rewritten, so
 * an old conversation stays byte for byte what it was - including one migrated
 * from the main chat, whose turns say `## Claude`.
 *
 * Shared because main writes topics (the migration) and the renderer reads and
 * appends to them.
 */

export type ChatTopicMeta = { bot: string; created: string; title: string }

/** A turn as read back: its role, its text, what the bot read for it, and the heading it was written under. */
export type TopicMessage = BotMessage & { label?: string }

export type ParsedTopic = {
  meta: Partial<ChatTopicMeta>
  /** Frontmatter lines that are not bot, created or title, kept as they are. */
  extra: string[]
  /** Everything after the frontmatter, exactly. */
  body: string
  messages: TopicMessage[]
}

const SOURCES = /\n*<!-- recto:sources (.*) -->\s*$/

/** Sources as a comment: JSON, with `--` escaped so it cannot close the comment early. */
export const sourcesComment = (sources: readonly BotSource[]): string =>
  `<!-- recto:sources ${JSON.stringify(sources).replace(/--/g, '-\\u002d')} -->`

function sourcesFrom(json: string): BotSource[] {
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (s): s is { path: string; heading?: unknown } =>
          typeof s === 'object' && s !== null && typeof (s as { path?: unknown }).path === 'string',
      )
      .map((s) => ({ path: s.path, heading: typeof s.heading === 'string' ? s.heading : null }))
  } catch {
    return []
  }
}

const META_KEYS = ['bot', 'created', 'title'] as const

/**
 * Read a topic. `assistants` are the headings that start an assistant's turn:
 * the bot's name, and for Recto also `Claude` (the old main chat's).
 * Fence-aware: a heading inside a code block in an answer is not a new turn.
 */
export function parseTopic(text: string, assistants: readonly string[]): ParsedTopic {
  const lines = text.split(/\r?\n/)
  const close = frontmatterClose(lines)
  const head = close === -1 ? [] : lines.slice(1, close)
  const body = close === -1 ? text : lines.slice(close + 1).join('\n')

  const meta: Partial<ChatTopicMeta> = {}
  const extra: string[] = []
  for (const line of head) {
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    const key = match?.[1] as (typeof META_KEYS)[number] | undefined
    if (match !== null && key !== undefined && META_KEYS.includes(key)) meta[key] = unquote(match[2]!.trim())
    else extra.push(line)
  }

  const headings = new Map<string, TopicMessage['role']>([
    ['## You', 'user'],
    ...assistants.map((name) => [`## ${name}`, 'assistant'] as const),
  ])
  const messages: TopicMessage[] = []
  let current: { role: TopicMessage['role']; label: string; lines: string[] } | null = null
  let inFence = false
  const flush = (): void => {
    if (current === null) return
    let content = current.lines.join('\n').trim()
    let sources: BotSource[] | undefined
    const match = current.role === 'assistant' ? SOURCES.exec(content) : null
    if (match !== null) {
      sources = sourcesFrom(match[1]!)
      content = content.slice(0, match.index).trimEnd()
    }
    if (content !== '') {
      messages.push({
        role: current.role,
        content,
        ...(sources === undefined ? {} : { sources }),
        ...(current.role === 'assistant' ? { label: current.label } : {}),
      })
    }
  }
  for (const line of body.split('\n')) {
    if (CODE_FENCE.test(line)) inFence = !inFence
    const role = inFence ? undefined : headings.get(line.trim())
    if (role !== undefined) {
      flush()
      current = { role, label: line.trim().slice(3), lines: [] }
      continue
    }
    current?.lines.push(line)
  }
  flush()
  return { meta, extra, body, messages }
}

const unquote = (value: string): string => (/^".*"$/.test(value) ? (JSON.parse(value) as string) : value)
/** A frontmatter value, quoted when YAML would otherwise misread it. */
const yamlValue = (value: string): string =>
  /^[\p{L}\p{N}][^:#\n]*$/u.test(value) && value.trim() === value ? value : JSON.stringify(value)

export function frontmatterOf(meta: ChatTopicMeta, extra: readonly string[] = []): string {
  return ['---', `bot: ${meta.bot}`, `created: ${meta.created}`, `title: ${yamlValue(meta.title)}`, ...extra, '---', ''].join('\n')
}

/** A whole topic file: its frontmatter, then the body as it is. */
export function topicFile(meta: ChatTopicMeta, extra: readonly string[], body: string): string {
  const rest = body.replace(/^\n+/, '')
  return `${frontmatterOf(meta, extra)}\n${rest === '' ? '' : rest.endsWith('\n') ? rest : `${rest}\n`}`
}

/** One turn as text, to append to a body. */
export function turnText(message: BotMessage, botName: string): string {
  const heading = message.role === 'user' ? '## You' : `## ${botName}`
  const sources =
    message.role === 'assistant' && message.sources !== undefined && message.sources.length > 0
      ? `\n\n${sourcesComment(message.sources)}`
      : ''
  return `${heading}\n\n${message.content.trim()}${sources}\n`
}

/** A body with turns added at the end; what was there is left untouched. */
export function appendTurns(body: string, turns: readonly BotMessage[], botName: string): string {
  const base = body.replace(/\s+$/, '')
  const added = turns.map((turn) => turnText(turn, botName)).join('\n')
  return base === '' ? added : `${base}\n\n${added}`
}

/** `2026-10-02T15:30` - minutes are enough, and it sorts as text. */
export function createdStamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A title made safe as part of a file name: no path separators or characters macOS and Windows refuse. */
export function fileSafeTitle(title: string): string {
  const safe = title
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim()
  return safe === '' ? 'Topic' : safe
}

/** `2026-10-02 15-30 — Soil mix.md`: sorts by when it began, and says what it is about. */
export function topicFileName(created: string, title: string): string {
  const stamp = created.replace('T', ' ').replace(':', '-').slice(0, 16)
  return `${stamp} — ${fileSafeTitle(title)}.md`
}

/** A title from the first question, when the model cannot make one: its first line, five words at most. */
export function fallbackTitle(messages: readonly BotMessage[]): string {
  const first = messages.find((m) => m.role === 'user')?.content ?? ''
  const line = first
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '')
  const words = (line ?? '')
    .replace(/[#*_`[\]]/g, '')
    .split(/\s+/)
    .filter((w) => w !== '')
    .slice(0, 5)
  return words.length === 0 ? 'New topic' : words.join(' ').replace(/[\s.,;:!?…]+$/u, '')
}

/**
 * "Topics Naming Decision" → "Topics naming decision". A small model writes
 * Title Case whatever it is asked; the app's names are sentence case. Only a
 * title whose every word is capitalised is touched, and a word in capitals
 * (API, CSS) is left as it is.
 */
function sentenceCase(words: string[]): string[] {
  const titled = words.length > 1 && words.every((w) => /^\p{Lu}/u.test(w))
  if (!titled) return words
  return words.map((w, i) => (i === 0 || (w.length > 1 && w === w.toUpperCase()) ? w : w.toLowerCase()))
}

/** A model's title, made fit for a file name and a list: one line, at most five words and 60 characters. */
export function cleanTitle(raw: string): string | null {
  const line =
    raw
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '') ?? ''
  const words = line
    .replace(/["'«»“”‘’`*#_[\]]/g, '')
    .replace(/^\s*(title|название|заголовок)\s*:\s*/i, '')
    .replace(/[\s.,;:!?…-]+$/u, '')
    .split(/\s+/)
    .filter((w) => w !== '')
    .slice(0, 5)
  const title = sentenceCase(words).join(' ').slice(0, 60).trim()
  return title === '' ? null : title
}
