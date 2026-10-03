import type { BotMessage, BotSource, MessageMeta } from './bots'
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
 *   <!-- recto:meta {"at":"2026-10-02T15:30:12","model":"qwen3.5:9b","sources":[...]} -->
 *
 * The title lives in the frontmatter and the file name, nowhere else. The body
 * is kept as the text it is: a new turn is appended to it, never rewritten, so
 * an old conversation stays byte for byte what it was - including one migrated
 * from the main chat, whose turns say `## Claude`. What is known about a
 * message besides its text is one HTML comment after it (older files have a
 * `recto:sources` comment instead, still read).
 *
 * Shared because main writes topics (the migration) and the renderer reads and
 * appends to them.
 */

export type ChatTopicMeta = { bot: string; created: string; title: string }

/**
 * A turn as read back: its role, its text, its meta, the heading it was written
 * under, and where it sits in the body (`[start, end)`), so it can be rewritten
 * alone.
 */
export type TopicMessage = BotMessage & { label?: string }

export type ParsedTopic = {
  meta: Partial<ChatTopicMeta>
  /** Frontmatter lines that are not bot, created or title, kept as they are. */
  extra: string[]
  /** Everything after the frontmatter, exactly. */
  body: string
  messages: TopicMessage[]
}

/** The comment after a message, either kind: `recto:meta {...}`, or the older `recto:sources [...]`. */
const TRAILER = /\n*<!-- recto:(meta|sources) (.*) -->\s*$/

/** JSON inside an HTML comment, with `--` escaped so it cannot close the comment early. */
const commentJson = (value: unknown): string => JSON.stringify(value).replace(/--/g, '-\\u002d')

const META_FIELDS = ['at', 'model', 'sources', 'steps', 'ttftMs', 'totalMs'] as const

/** A message's meta as its comment; empty when there is nothing to say. */
export function metaComment(message: MessageMeta): string {
  const meta: Record<string, unknown> = {}
  for (const key of META_FIELDS) {
    const value = message[key]
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue
    meta[key] = value
  }
  return Object.keys(meta).length === 0 ? '' : `<!-- recto:meta ${commentJson(meta)} -->`
}

/** What a comment holds, whichever kind it is. Anything malformed is dropped, never thrown. */
export function metaFrom(kind: string, json: string): MessageMeta {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return {}
  }
  if (kind === 'sources') return Array.isArray(parsed) ? { sources: sourcesFrom(parsed) } : {}
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const raw = parsed as Record<string, unknown>
  const meta: MessageMeta = {}
  const text = (key: 'at' | 'model'): void => {
    if (typeof raw[key] === 'string') meta[key] = raw[key]
  }
  text('at')
  text('model')
  if (typeof raw['ttftMs'] === 'number') meta.ttftMs = raw['ttftMs']
  if (typeof raw['totalMs'] === 'number') meta.totalMs = raw['totalMs']
  if (Array.isArray(raw['sources'])) meta.sources = sourcesFrom(raw['sources'])
  if (Array.isArray(raw['steps'])) {
    meta.steps = raw['steps']
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .filter((s) => typeof s['action'] === 'string' && typeof s['result'] === 'string')
      .map((s) => ({
        action: s['action'] as string,
        result: s['result'] as string,
        state: s['state'] === 'failed' ? 'failed' : s['state'] === 'running' ? 'running' : 'done',
      }))
  }
  return meta
}

function sourcesFrom(parsed: unknown[]): BotSource[] {
  return parsed
    .filter(
      (s): s is { path: string; heading?: unknown } =>
        typeof s === 'object' && s !== null && typeof (s as { path?: unknown }).path === 'string',
    )
    .map((s) => ({ path: s.path, heading: typeof s.heading === 'string' ? s.heading : null }))
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
    let trailer: MessageMeta = {}
    const match = TRAILER.exec(content)
    if (match !== null) {
      trailer = metaFrom(match[1]!, match[2]!)
      content = content.slice(0, match.index).trimEnd()
    }
    if (content !== '') {
      messages.push({
        role: current.role,
        content,
        ...trailer,
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
    } else {
      current?.lines.push(line)
    }
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

/** One turn as text: its heading, its text, and its meta comment if it has any. `label` overrides the heading's name. */
export function turnText(message: BotMessage & { label?: string }, botName: string): string {
  const heading = message.role === 'user' ? '## You' : `## ${message.label ?? botName}`
  const comment = metaComment(message)
  return `${heading}\n\n${message.content.trim()}${comment === '' ? '' : `\n\n${comment}`}\n`
}

/** A body with turns added at the end; what was there is left untouched. */
export function appendTurns(body: string, turns: readonly BotMessage[], botName: string): string {
  const base = body.replace(/\s+$/, '')
  const added = turns.map((turn) => turnText(turn, botName)).join('\n')
  return base === '' ? added : `${base}\n\n${added}`
}

/**
 * `2026-10-02T15:30:12`: local time, to the second, so topics begun in the
 * same minute still sort (file names only go to the minute). `withSeconds:
 * false` gives the minute alone, for names and for older topics.
 */
export function createdStamp(date: Date, withSeconds = true): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const minute = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  return withSeconds ? `${minute}:${pad(date.getSeconds())}` : minute
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
