import type { BotMessage } from '@shared/bots'

/**
 * A topic's messages in groups, the way a messenger shows them: consecutive
 * messages from the same side within three minutes sit together, tightly, and
 * the bot's face appears once, at the bottom of each of its groups. A message
 * with no time (older files have none) joins its neighbour.
 *
 * Between groups, a marker where the model that answered changed.
 */

export const GROUP_GAP_MS = 3 * 60_000

export type Group = {
  role: BotMessage['role']
  /** Indexes into the topic's messages, in order. */
  indexes: number[]
  /** The model that wrote this group's answers, when it differs from the one before: "Switched to …". */
  switchedTo: string | null
}

const time = (at: string | undefined): number | null => {
  if (at === undefined) return null
  const ms = new Date(at).getTime()
  return Number.isNaN(ms) ? null : ms
}

export function groupMessages(messages: readonly Pick<BotMessage, 'role' | 'at' | 'model'>[]): Group[] {
  const groups: Group[] = []
  let lastModel: string | null = null
  messages.forEach((message, index) => {
    // A change of model starts a group of its own, under its marker.
    let switchedTo: string | null = null
    if (message.role === 'assistant' && message.model !== undefined) {
      if (lastModel !== null && message.model !== lastModel) switchedTo = message.model
      lastModel = message.model
    }
    const group = groups.at(-1)
    const previous = group === undefined ? undefined : messages[group.indexes.at(-1)!]
    const a = time(previous?.at)
    const b = time(message.at)
    const close = a === null || b === null || Math.abs(b - a) <= GROUP_GAP_MS
    if (group !== undefined && previous !== undefined && previous.role === message.role && close && switchedTo === null) {
      group.indexes.push(index)
    } else {
      groups.push({ role: message.role, indexes: [index], switchedTo })
    }
  })
  return groups
}
