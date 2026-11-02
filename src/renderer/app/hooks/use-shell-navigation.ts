import { useCallback } from 'react'
import type { SectionId } from '../sections'
import type { WorkspaceApi } from './use-workspace'
import { focusEditorOnOpen } from '../../features/editor'
import { openChats } from '../../features/chats'
import type { Bot } from '@shared/bots'
import { boardOfCard, isBoardPath } from '../../features/boards'
import { metaHeld } from '../../ui/meta-key'
import { placeOf } from '../tab-history'
import type { HistoryEntry } from '../workspace'

/**
 * What a tab can be moved on from to something else, keeping it as a step
 * back. A chat, the graph or Settings are not: a link clicked there opens a
 * tab of its own.
 */
const NAVIGABLE = new Set(['markdown', 'board', 'overview', 'new-tab'])

/** Where things open: notes in Data, chats in the Chats panel, boards and cards in Tasks. */
export function useShellNavigation(
  sections: WorkspaceApi['sections'],
  activeSection: SectionId,
  setActiveSection: (id: SectionId) => void,
): {
  /** `via` is a step to keep between where the tab was and the note: the overview it was opened from. */
  openFile: (path: string, heading?: string | null, via?: HistoryEntry) => void
  /** A board note in the Tasks workspace, with a card open beside it when given. */
  openBoard: (path: string, card?: string) => void
  openBoardCard: (path: string) => void
  openBot: (bot: Bot) => Promise<void>
} {
  /**
   * Show something in the tab you are in, keeping what it showed as a step
   * back - unless ⌘ is held (a new tab), the tab is pinned, or it shows
   * something that is not moved on from. Returns false when it did not, so
   * the caller opens a tab the way it always has.
   */
  const showHere = useCallback(
    (section: SectionId, type: string, state: Record<string, unknown>, via?: HistoryEntry): boolean => {
      const workspace = sections?.[section]
      const leaf = workspace?.activeLeaf
      if (workspace == null || leaf == null || metaHeld() || leaf.pinned || !NAVIGABLE.has(leaf.type)) return false
      const at = placeOf(leaf.id)
      workspace.navigate(leaf.id, { type, state }, { ...(at === undefined ? {} : { at }), ...(via === undefined ? {} : { via }) })
      return true
    },
    [sections],
  )

  const openBoard = useCallback(
    (path: string, card?: string) => {
      setActiveSection('tasks')
      const state = card === undefined ? { path } : { path, card }
      if (!showHere('tasks', 'board', state)) sections?.tasks.openView('board', state)
    },
    [sections, setActiveSection, showHere],
  )

  const openFile = useCallback(
    (path: string, heading?: string | null, via?: HistoryEntry) => {
      // A board note - a [[link]] to a board, say - opens as the board; a card
      // note opens beside its (first) board, not as Markdown. In the tab you
      // are in, wherever that is, so ← comes back; otherwise in Tasks.
      const board = isBoardPath(path) ? path : boardOfCard(path)
      if (board !== null) {
        const state = board === path ? { path } : { path: board, card: path }
        if (showHere(activeSection, 'board', state, via)) return
        setActiveSection('tasks')
        sections?.tasks.openView('board', state)
        return
      }
      // You opened it to read or write in it, so the keyboard goes there too.
      focusEditorOnOpen()
      // The heading is part of the leaf state, so reopening the tab from a
      // saved layout lands in the same place.
      const state = heading ? { path, heading } : { path }
      if (showHere(activeSection, 'markdown', state, via)) return
      // Not in the tab you are in: in a tab of its own, in Data.
      setActiveSection('data')
      sections?.data.openView('markdown', state)
    },
    [sections, activeSection, setActiveSection, showHere],
  )

  /**
   * A card opens in the Tasks workspace, not in Data.
   *
   * Sending you to another section to read the task you just clicked would
   * throw away the board you were looking at - and it is the same editor either
   * way, because a card is a note.
   */
  const openBoardCard = useCallback(
    (path: string) => {
      if (!showHere(activeSection, 'markdown', { path })) sections?.tasks.openView('markdown', { path })
    },
    [sections, activeSection, showHere],
  )

  /** A bot opens on its conversation, where its current topic is, in the Chats panel. */
  const openBot = useCallback(async (bot: Bot) => openChats(bot.id), [])

  return { openFile, openBoard, openBoardCard, openBot }
}
