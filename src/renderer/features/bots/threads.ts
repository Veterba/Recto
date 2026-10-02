import { botThreadFolder, type BotMessage, type BotSource } from '@shared/bots'
import type { FileNode } from '@shared/vault'
import { parseConversation, serialiseConversation } from '../ai'

/**
 * A bot's thread is a note, like any chat: `chats/<bot id>/<timestamp>.md`,
 * `## You` and `## <Bot name>` turns, readable without the app.
 *
 * What the bot read for an answer is kept under that answer as an HTML
 * comment - not as wikilinks, which would add links to the graph and
 * backlinks that the user never wrote.
 */

const SOURCES = /\n*<!-- recto:sources (.*) -->\s*$/

/** Sources as a comment: JSON, with `--` escaped so it cannot close the comment early. */
const sourcesComment = (sources: readonly BotSource[]): string =>
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

export function parseThread(text: string, botName: string): { title: string; messages: BotMessage[] } {
  const { title, messages } = parseConversation(text, botName)
  return {
    title,
    messages: messages.map((message) => {
      const match = message.role === 'assistant' ? SOURCES.exec(message.content) : null
      if (match === null) return message
      return { ...message, content: message.content.slice(0, match.index).trimEnd(), sources: sourcesFrom(match[1]!) }
    }),
  }
}

export function serialiseThread(thread: { title: string; messages: readonly BotMessage[] }, botName: string): string {
  return serialiseConversation(
    {
      title: thread.title,
      model: null,
      messages: thread.messages.map(({ role, content, sources }) => ({
        role,
        content: sources !== undefined && sources.length > 0 ? `${content.trim()}\n\n${sourcesComment(sources)}` : content,
      })),
    },
    botName,
  )
}

/** A bot's threads in the tree, newest first (the filename is the timestamp). */
export function threadsOf(tree: readonly FileNode[], botId: string): FileNode[] {
  const [chats, folder] = botThreadFolder(botId).split('/')
  const bot = tree.find((n) => n.path === chats)?.children?.find((n) => n.kind === 'folder' && n.name === folder)
  return (bot?.children ?? [])
    .filter((n) => n.kind === 'file' && n.name.toLowerCase().endsWith('.md'))
    .sort((a, b) => b.name.localeCompare(a.name))
}

/** The last thing said, on one line, for the sidebar: "You: …" when it was the user. */
export function previewOf(messages: readonly BotMessage[]): string {
  const last = messages[messages.length - 1]
  if (last === undefined) return ''
  const line = last.content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return last.role === 'user' ? `You: ${line}` : line
}

/** "14:05" today, "Tue" this week, "28 Sep" before that. */
export function shortTime(at: number, now: number = Date.now()): string {
  const date = new Date(at)
  const today = new Date(now)
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const days = (new Date(today.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86_400_000
  if (days > 0 && days < 7) return date.toLocaleDateString('en-GB', { weekday: 'short' })
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
