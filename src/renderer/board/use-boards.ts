import { useSyncExternalStore } from 'react'
import { api } from '../api'
import { DEFAULT_BOARDS, parseBoards, type BoardsFile } from './boards'

/**
 * Board and column definitions, from `.recto/boards.json`.
 *
 * A module-level store rather than component state, because two things read it
 * - the sidebar list and the board itself - and they must not be able to
 * disagree about which boards exist. Same shape as `core/note-bus`: a value
 * outside React, read through `useSyncExternalStore`.
 */

let file: BoardsFile = DEFAULT_BOARDS
let loaded = false
const listeners = new Set<() => void>()

function emit(next: BoardsFile): void {
  file = next
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  // Load once, on the first subscriber: nothing needs boards until something
  // renders them.
  if (!loaded) {
    loaded = true
    void api.invoke('state:read', 'boards').then((raw) => emit(parseBoards(raw)))
  }
  return () => listeners.delete(listener)
}

/** Structural edits - adding a column, renaming a board - so no debounce. */
export function updateBoards(next: BoardsFile): void {
  emit(next)
  void api.invoke('state:write', 'boards', next)
}

export function useBoards(): BoardsFile {
  return useSyncExternalStore(subscribe, () => file, () => file)
}

/** Read without subscribing, for code that runs outside a render. */
export const currentBoards = (): BoardsFile => file

/** Test seam - the module is a singleton. */
export function resetBoards(): void {
  file = DEFAULT_BOARDS
  loaded = false
  listeners.clear()
}
