import { useSyncExternalStore } from 'react'

/**
 * Which note is open, and when the vault last changed.
 *
 * The graph lives outside the editor's React tree - it is a floating window,
 * not a child of the tab - so there is no prop path from the active tab to it.
 * Rather than thread a callback through the view registry, the shell publishes
 * two facts here and anything that cares subscribes.
 *
 * Deliberately not a state library: two numbers and a string do not need one,
 * and `useSyncExternalStore` is the React-blessed way to read a value that
 * lives outside React without tearing during a concurrent render.
 */

type Snapshot = {
  activePath: string | null
  /** Bumped whenever the index may have changed. */
  revision: number
}

let snapshot: Snapshot = { activePath: null, revision: 0 }
const listeners = new Set<() => void>()

function emit(next: Snapshot): void {
  // Reference equality is the subscription contract: a new object every time
  // would re-render every subscriber on every unrelated change.
  if (next.activePath === snapshot.activePath && next.revision === snapshot.revision) return
  snapshot = next
  for (const listener of listeners) listener()
}

export function setActiveNote(path: string | null): void {
  emit({ ...snapshot, activePath: path })
}

/**
 * Call after anything that may have changed the link graph: a save, a rename,
 * an external edit. Cheap - subscribers debounce their own refetch.
 */
export function noteIndexChanged(): void {
  emit({ ...snapshot, revision: snapshot.revision + 1 })
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useNoteBus(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
}

/** Test seam - the module is a singleton, so tests need a way back to zero. */
export function resetNoteBus(): void {
  snapshot = { activePath: null, revision: 0 }
  listeners.clear()
}
