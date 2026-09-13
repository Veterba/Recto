import type { AiMessage } from '@shared/ipc-contract'

/**
 * A conversation IS a note.
 *
 * The same call the board makes for cards and the template picker makes for
 * templates, and for the same reason: your chat history becomes searchable,
 * linkable, backlinked knowledge in the vault instead of a second opaque
 * database that only this app can read. Open one in the editor and it is a
 * markdown file with headings.
 *
 * The format is chosen so a human reading the raw file sees a transcript, not a
 * serialisation: `## You` and `## Claude` and the text underneath. There is no
 * JSON anywhere, which also means a conversation survives this app.
 */

/** Where conversations live. A real folder, hidden from the file tree. */
export const CHAT_FOLDER = 'chats'

const USER_HEADING = '## You'
const ASSISTANT_HEADING = '## Claude'

export type Conversation = {
  title: string
  model: string | null
  messages: AiMessage[]
}

const FENCE = /^\s*(```|~~~)/
const FRONTMATTER = /^---\s*$/

/** Strip a leading `---` block and return the rest, plus its raw lines. */
function splitFrontmatter(lines: readonly string[]): { head: string[]; body: string[] } {
  if (!FRONTMATTER.test(lines[0] ?? '')) return { head: [], body: [...lines] }
  for (let i = 1; i < lines.length; i++) {
    if (FRONTMATTER.test(lines[i] ?? '')) {
      return { head: lines.slice(1, i), body: lines.slice(i + 1) }
    }
  }
  // An unterminated block is not frontmatter; treat the whole thing as body.
  return { head: [], body: [...lines] }
}

/**
 * Read a conversation back out of its note.
 *
 * Fence-aware: a reply containing a code block that itself contains `## You`
 * must not be chopped in half by it. This is the one piece of parsing here that
 * is not obvious, and the one that would silently corrupt history.
 */
export function parseConversation(text: string): Conversation {
  const lines = text.split(/\r?\n/)
  const { head, body } = splitFrontmatter(lines)

  const model = head
    .map((line) => /^model:\s*(.+)$/.exec(line.trim()))
    .find((match) => match !== null)?.[1]
    ?.trim()

  let title = ''
  const messages: AiMessage[] = []
  let role: AiMessage['role'] | null = null
  let buffer: string[] = []
  let inFence = false

  const flush = (): void => {
    if (role === null) return
    const content = buffer.join('\n').trim()
    if (content !== '') messages.push({ role, content })
    buffer = []
  }

  for (const line of body) {
    if (FENCE.test(line)) inFence = !inFence

    if (!inFence && (line.trim() === USER_HEADING || line.trim() === ASSISTANT_HEADING)) {
      flush()
      role = line.trim() === USER_HEADING ? 'user' : 'assistant'
      continue
    }
    if (!inFence && role === null && title === '' && line.startsWith('# ')) {
      title = line.slice(2).trim()
      continue
    }
    if (role !== null) buffer.push(line)
  }
  flush()

  return { title, model: model ?? null, messages }
}

/**
 * Write one back. Round-trips with `parseConversation`.
 *
 * No `created:` field: the filename is the timestamp, and two records of one
 * fact drift apart the first time anything touches either.
 */
export function serialiseConversation(conversation: Conversation): string {
  const out: string[] = ['---', 'recto: chat']
  if (conversation.model !== null) out.push(`model: ${conversation.model}`)
  out.push('---', '')
  out.push(`# ${conversation.title === '' ? 'New chat' : conversation.title}`, '')

  for (const message of conversation.messages) {
    out.push(message.role === 'user' ? USER_HEADING : ASSISTANT_HEADING, '')
    out.push(message.content.trim(), '')
  }
  return `${out.join('\n').trimEnd()}\n`
}

/**
 * A name for the conversation, from what was actually asked.
 *
 * First user message, first line, clipped. "Untitled chat 4" is what a list of
 * conversations looks like when nobody solved this; the first thing you typed
 * is almost always what you would have called it anyway.
 */
export function titleFrom(messages: readonly AiMessage[]): string {
  const first = messages.find((message) => message.role === 'user')
  if (first === undefined) return 'New chat'
  const line = first.content.split('\n').find((text) => text.trim() !== '')?.trim() ?? ''
  if (line === '') return 'New chat'
  const clipped = line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line
  // A title becomes an H1 in the note, so markdown in it would render as
  // markup rather than as the words that were typed.
  return clipped.replace(/[#*_`[\]]/g, '').trim() || 'New chat'
}

/** A stable, sortable filename. Conversations are never renamed. */
export function chatFileName(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(
    now.getMinutes(),
  )}-${pad(now.getSeconds())}.md`
}
