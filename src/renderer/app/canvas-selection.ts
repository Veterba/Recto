import { useSyncExternalStore } from 'react'

/**
 * What is selected on each open canvas, for what goes with a Quick ask
 * question there: the canvas view says it, Quick ask reads it. Node ids, by
 * the canvas's path; none selected is the whole canvas.
 */

const selected = new Map<string, readonly string[]>()
const listeners = new Set<() => void>()
const NONE: readonly string[] = []

export function setCanvasSelection(path: string, ids: readonly string[]): void {
  const now = selected.get(path) ?? NONE
  if (now.length === ids.length && now.every((id, i) => id === ids[i])) return
  if (ids.length === 0) selected.delete(path)
  else selected.set(path, ids)
  for (const l of listeners) l()
}

export const canvasSelection = (path: string): readonly string[] => selected.get(path) ?? NONE

export const useCanvasSelection = (path: string | null): readonly string[] =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => (path === null ? NONE : canvasSelection(path)),
  )
