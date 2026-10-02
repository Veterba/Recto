import type { BotMessage } from '@shared/bots'

/** What the sidebar shows of a bot's newest topic. */

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
