import { useSyncExternalStore } from 'react'
import type { Place, TabHistory } from './workspace'

/**
 * Each tab's history, for the views: the ← and → buttons read it, a view says
 * where in it you are, and lands back there when you return. The shell, which
 * knows the workspaces, does the travelling (setTabHistoryHandler); the
 * workspace keeps the history itself (Workspace.navigate / travel).
 */

/** What a view reports as where you are in it - a note's scroll and caret. */
const places = new Map<string, () => Place | null>()

export function setPlaceSource(leafId: string, source: (() => Place | null) | null): void {
  if (source === null) places.delete(leafId)
  else places.set(leafId, source)
}

export function placeOf(leafId: string): Place | undefined {
  return places.get(leafId)?.() ?? undefined
}

/** Where a tab should land once its view has drawn the step it went to. */
const restores = new Map<string, Place>()

export function setRestore(leafId: string, at: Place | undefined): void {
  if (at === undefined) restores.delete(leafId)
  else restores.set(leafId, at)
}

/** The place to land on, once: a second call has nothing. */
export function takeRestore(leafId: string): Place | undefined {
  const at = restores.get(leafId)
  restores.delete(leafId)
  return at
}

type Handler = {
  history: (leafId: string) => TabHistory | undefined
  /** Back (negative) or forward (positive); in a new tab, the step is opened there instead. */
  travel: (leafId: string, steps: number, newTab: boolean) => void
  /** The tab moves on to something else, keeping what it showed as a step back. */
  step: (leafId: string, type: string, state: Record<string, unknown>) => void
}

let handler: Handler | null = null

export function setTabHistoryHandler(next: Handler | null): void {
  handler = next
}

const EMPTY: TabHistory = { back: [], forward: [] }

export const historyOf = (leafId: string): TabHistory => handler?.history(leafId) ?? EMPTY

export function travel(leafId: string, steps: number, newTab = false): void {
  handler?.travel(leafId, steps, newTab)
}

/** A view moving its own tab on - a board opening a card - as a step ← comes back from. */
export function step(leafId: string, type: string, state: Record<string, unknown>): void {
  handler?.step(leafId, type, state)
}

/** A count bumped on every layout change, so the buttons redraw with the history. */
let version = 0
const listeners = new Set<() => void>()

export function historyChanged(): void {
  version++
  for (const listener of listeners) listener()
}

export function useHistoryVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
  )
}
