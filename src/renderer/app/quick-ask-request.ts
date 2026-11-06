import { useSyncExternalStore } from 'react'

/**
 * A question for Quick ask from elsewhere in the app - a canvas command such
 * as "Group these" - sent as if typed: the shell opens Quick ask, and Quick
 * ask sends it once its model is ready, then clears it.
 */

let pending: { question: string; at: number } | null = null
const listeners = new Set<() => void>()
const tell = (): void => {
  for (const l of listeners) l()
}

export function askQuickly(question: string): void {
  pending = { question, at: Date.now() }
  tell()
}

/** The question waiting, taken: asked once. */
export function takeQuickAsk(): string | null {
  const question = pending?.question ?? null
  pending = null
  if (question !== null) tell()
  return question
}

export const useQuickAskRequest = (): { question: string; at: number } | null =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => pending,
  )
