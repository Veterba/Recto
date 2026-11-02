import { useSyncExternalStore } from 'react'

/**
 * The Chats panel's place in the app: which bot's chat it shows under the
 * list, and a way to open it from anywhere - a notification, ⌘N, Quick ask's
 * "Save as chat". The shell owns whether the panel is open (it is saved with
 * the appearance) and sets the opener.
 */

/** Recto, the main chat, until another bot is picked. */
let shown = 'recto'
const listeners = new Set<() => void>()
let opener: (() => void) | null = null

export function setChatsOpener(next: typeof opener): void {
  opener = next
}

/** Show a bot's chat and open the panel. */
export function openChats(botId: string): void {
  shown = botId
  for (const listener of listeners) listener()
  opener?.()
}

export function useShownChat(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => shown,
  )
}

/** Whether the panel is open, mirrored from the shell for the tab bar's button. */
let open = false
let toggler: (() => void) | null = null
const openListeners = new Set<() => void>()

export function setChatsPanel(next: { open: boolean; toggle: () => void }): void {
  toggler = next.toggle
  if (open === next.open) return
  open = next.open
  for (const listener of openListeners) listener()
}

export function toggleChats(): void {
  toggler?.()
}

export function useChatsOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      openListeners.add(listener)
      return () => openListeners.delete(listener)
    },
    () => open,
  )
}
