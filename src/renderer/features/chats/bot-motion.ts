import { useSyncExternalStore } from 'react'

/**
 * The floating bot on the move: where it is while dragged, and whether it is
 * gliding to its edge after a drop. Quick ask's bubble moves with it. Kept
 * here rather than in the shell's state, so a drag redraws the bubble alone.
 */

export type BotMotion = { drag: { x: number; y: number } | null; gliding: boolean }

let motion: BotMotion = { drag: null, gliding: false }
const listeners = new Set<() => void>()

export function setBotMotion(next: BotMotion): void {
  if (next.drag === motion.drag && next.gliding === motion.gliding) return
  motion = next
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useBotMotion = (): BotMotion => useSyncExternalStore(subscribe, () => motion)
