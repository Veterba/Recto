/**
 * "New topic" from outside a bot's chat - ⌘N or the sidebar's New button in
 * the AI section - reaches the open conversation through here. Inside the
 * chat, ⌘N is handled by the view itself (the composer keeps its keys).
 */

const listeners = new Map<string, Set<() => void>>()

export function onNewTopicRequest(botId: string, listener: () => void): () => void {
  const set = listeners.get(botId) ?? new Set()
  set.add(listener)
  listeners.set(botId, set)
  return () => set.delete(listener)
}

export function requestNewTopic(botId: string): void {
  for (const listener of listeners.get(botId) ?? []) listener()
}

/**
 * "Open this topic" from outside the chat (a notification was clicked). Kept
 * until the bot's conversation takes it: it may mount only after the click.
 */
const wanted = new Map<string, string>()
const topicListeners = new Map<string, (path: string) => void>()

export function requestTopic(botId: string, path: string): void {
  const listener = topicListeners.get(botId)
  if (listener !== undefined) listener(path)
  else wanted.set(botId, path)
}

export function onTopicRequest(botId: string, listener: (path: string) => void): () => void {
  topicListeners.set(botId, listener)
  const waiting = wanted.get(botId)
  if (waiting !== undefined) {
    wanted.delete(botId)
    listener(waiting)
  }
  return () => {
    if (topicListeners.get(botId) === listener) topicListeners.delete(botId)
  }
}
