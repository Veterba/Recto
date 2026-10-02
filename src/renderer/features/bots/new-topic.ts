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
