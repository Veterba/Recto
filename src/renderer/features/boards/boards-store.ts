import { useSyncExternalStore } from 'react'
import { IPC } from '@shared/ipc'
import type { BoardSummaryInfo, CardPlaceInfo } from '@shared/index-results'
import { linkStage } from '@shared/kanban'
import { api } from '../../app/api'
import { setLinkKinds, type LinkKind } from '../../app/link-kinds'
import { CARD_FOLDER } from './create-card'

/**
 * The vault's boards and where each card stands, from the index.
 *
 * A board is any note in the Obsidian Kanban format, so the list is asked of
 * the index and asked again whenever the vault changes (`refreshBoards`, from
 * the shell's note bus). A module-level store rather than component state,
 * because the sidebar, the board, the editor's link icons and the graph all
 * read it and must not disagree.
 */

let boards: BoardSummaryInfo[] = []
let places: CardPlaceInfo[] = []
/** Boards made here that the index has not listed yet. */
const fresh = new Map<string, { board: BoardSummaryInfo; at: number }>()
const FRESH_MS = 15_000
const listeners = new Set<() => void>()
let asked = 0

const emit = (): void => {
  for (const listener of listeners) listener()
}

/** Ask the index again: after a vault change, a rename, a write of ours. */
export function refreshBoards(): void {
  const ticket = ++asked
  void Promise.all([api.invoke(IPC.indexBoards), api.invoke(IPC.indexCardPlaces)]).then(([listed, found]) => {
    // A later ask has gone out; its answer is the one that counts.
    if (ticket !== asked) return
    const now = Date.now()
    for (const [path, entry] of fresh) if (now - entry.at > FRESH_MS || listed.some((b) => b.path === path)) fresh.delete(path)
    const nextBoards = [...listed, ...[...fresh.values()].map((entry) => entry.board)].sort((a, b) => a.name.localeCompare(b.name))
    // The same answer keeps the same values: everything that reads them (the shell's commands among them) stays put.
    const same = JSON.stringify(nextBoards) === JSON.stringify(boards) && JSON.stringify(found) === JSON.stringify(places)
    if (same) return
    boards = nextBoards
    places = found
    publishLinkKinds()
    emit()
  })
}

/** A board just made: listed at once, before the index has read it. */
export function boardMade(path: string): void {
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  fresh.set(path, { board: { path, name, cards: 0 }, at: Date.now() })
  if (!boards.some((b) => b.path === path)) boards = [...boards, { path, name, cards: 0 }].sort((a, b) => a.name.localeCompare(b.name))
  publishLinkKinds()
  emit()
}

/**
 * What a link to each note looks like in the editor: a board, or a card's
 * stage - one when its boards agree, `mixed` when not. Keyed by the names a
 * link can use: the note's name and its path, without `.md`.
 */
function publishLinkKinds(): void {
  const kinds = new Map<string, LinkKind>()
  const keys = (path: string): string[] => {
    const bare = path.replace(/\.md$/i, '').normalize('NFC').toLowerCase()
    return [bare, bare.slice(bare.lastIndexOf('/') + 1)]
  }
  const stages = new Map<string, CardPlaceInfo['stage'][]>()
  for (const place of places) stages.set(place.path, [...(stages.get(place.path) ?? []), place.stage])
  for (const [path, list] of stages) for (const key of keys(path)) kinds.set(key, linkStage(list)!)
  for (const board of boards) for (const key of keys(board.path)) kinds.set(key, 'board')
  setLinkKinds(kinds)
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useBoards(): BoardSummaryInfo[] {
  return useSyncExternalStore(subscribe, () => boards, () => boards)
}

export function useCardPlaces(): CardPlaceInfo[] {
  return useSyncExternalStore(subscribe, () => places, () => places)
}

/** Read without subscribing, for code that runs outside a render. */
export const currentBoards = (): BoardSummaryInfo[] => boards
export const isBoardPath = (path: string): boolean => boards.some((b) => b.path === path)

/** The first board a card note is on, or null for a note no board lists. */
export const boardOfCard = (path: string): string | null => places.find((p) => p.path === path)?.board ?? null

/**
 * What the Data tree leaves to the Tasks tab, in one rule: the tasks/ folder,
 * and any board note or card note wherever it is - so a board or a card moved
 * out of tasks/ does not turn up among the notes.
 */
export function isTaskPath(path: string): boolean {
  return (
    path === CARD_FOLDER ||
    path.startsWith(`${CARD_FOLDER}/`) ||
    boards.some((b) => b.path === path) ||
    places.some((p) => p.path === path)
  )
}

/**
 * "New card" from the command palette: a request the board on screen takes
 * up. Pending rather than an event, because the command may have to open the
 * board first and the board is not listening yet.
 */
let newCardPending = false
let newCardTick = 0
const newCardListeners = new Set<() => void>()

export function requestNewCard(): void {
  newCardPending = true
  newCardTick++
  for (const listener of newCardListeners) listener()
}

/** Changes whenever a request is made; read it, then `takeNewCardRequest`. */
export function useNewCardRequest(): number {
  return useSyncExternalStore(
    (listener) => {
      newCardListeners.add(listener)
      return () => newCardListeners.delete(listener)
    },
    () => newCardTick,
    () => newCardTick,
  )
}

/** True once per request: the first board to ask gets it. */
export function takeNewCardRequest(): boolean {
  const pending = newCardPending
  newCardPending = false
  return pending
}
