import { useCallback } from 'react'
import type { SectionId } from '../sections'
import type { WorkspaceApi } from './use-workspace'
import { focusEditorOnOpen } from '../../features/editor'
import { MAIN_BOT, requestNewTopic } from '../../features/bots'
import type { Bot } from '@shared/bots'
import { boardOfCard, isBoardPath } from '../../features/boards'

/** Where things open: notes in Data, chats in AI, boards and cards in Tasks. */
export function useShellNavigation(
  sections: WorkspaceApi['sections'],
  setActiveSection: (id: SectionId) => void,
): {
  openFile: (path: string, heading?: string | null) => void
  newChat: () => Promise<void>
  /** A board note in the Tasks workspace, with a card open beside it when given. */
  openBoard: (path: string, card?: string) => void
  openBoardCard: (path: string) => void
  openBot: (bot: Bot) => Promise<void>
} {
  /**
   * "New" in the AI section, and ⌘N there: a new topic with Recto, the main
   * chat - opened first if it is not on screen. Nothing is written until the
   * first message.
   */
  const newChat = useCallback(async () => {
    setActiveSection('ai')
    sections?.ai.openView('bot', { bot: MAIN_BOT })
    requestNewTopic(MAIN_BOT)
  }, [sections, setActiveSection])

  const openBoard = useCallback(
    (path: string, card?: string) => {
      setActiveSection('tasks')
      sections?.tasks.openView('board', card === undefined ? { path } : { path, card })
    },
    [sections, setActiveSection],
  )

  const openFile = useCallback(
    (path: string, heading?: string | null) => {
      // A board note - a [[link]] to a board, say - opens as the board, in Tasks;
      // a card note opens beside its (first) board there, not as Markdown in Data.
      const board = isBoardPath(path) ? path : boardOfCard(path)
      if (board !== null) {
        setActiveSection('tasks')
        sections?.tasks.openView('board', board === path ? { path } : { path: board, card: path })
        return
      }
      // Opening a note always lands in Data, even if you clicked from elsewhere.
      setActiveSection('data')
      // You opened it to read or write in it, so the keyboard goes there too.
      focusEditorOnOpen()
      // The heading is part of the leaf state, so reopening the tab from a
      // saved layout lands in the same place.
      sections?.data.openView('markdown', heading ? { path, heading } : { path })
    },
    [sections, setActiveSection],
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
      sections?.tasks.openView('markdown', { path })
    },
    [sections],
  )

  /** A bot opens on its conversation, where its current topic is. */
  const openBot = useCallback(
    async (bot: Bot) => {
      setActiveSection('ai')
      sections?.ai.openView('bot', { bot: bot.id })
    },
    [sections, setActiveSection],
  )

  return { openFile, newChat, openBoard, openBoardCard, openBot }
}
