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
