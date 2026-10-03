import { useSyncExternalStore } from 'react'

/**
 * Bots that answered while their chat was out of sight: the sidebar shows a
 * dot on their row until the chat is seen again.
 */

const unread = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

function emit(): void {
  version++
  for (const listener of listeners) listener()
}

export function markUnread(botId: string): void {
  if (unread.has(botId)) return
  unread.add(botId)
  emit()
}

export function markRead(botId: string): void {
  if (unread.delete(botId)) emit()
}

export function useUnread(botId: string): boolean {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
  )
  return unread.has(botId)
}
