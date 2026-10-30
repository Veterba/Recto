import { useSyncExternalStore } from 'react'

/**
 * Whether ⌘ is held right now. Tooltips and hover info show only while it is
 * (Tip, attachTip, title-tips): sweeping the pointer across the window shows
 * nothing, and ⌘ over anything says what it is.
 *
 * The pointer's own events carry the key too, so ⌘ pressed while another app
 * had focus is caught as soon as the pointer moves here; losing the window
 * counts as letting go.
 */

let held = false
const listeners = new Set<() => void>()

const set = (next: boolean): void => {
  if (held === next) return
  held = next
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  const fromEvent = (event: KeyboardEvent | PointerEvent): void => set(event.metaKey)
  window.addEventListener('keydown', fromEvent, true)
  window.addEventListener('keyup', fromEvent, true)
  window.addEventListener('pointermove', fromEvent, true)
  window.addEventListener('blur', () => set(false))
}

export const metaHeld = (): boolean => held

export function subscribeMeta(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useMetaHeld(): boolean {
  return useSyncExternalStore(subscribeMeta, metaHeld)
}
