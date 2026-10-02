import { useCallback } from 'react'
import { api } from '../api'
import { IPC } from '@shared/ipc'
import type { SectionId } from '../sections'
import type { WorkspaceApi } from './use-workspace'
import { focusEditorOnOpen } from '../../features/editor'
import { CHAT_FOLDER, chatFileName, serialiseConversation } from '../../features/ai'
import { botThreadFolder, type Bot } from '@shared/bots'

/** Where things open: notes in Data, chats in AI, boards and cards in Tasks. */
export function useShellNavigation(
  sections: WorkspaceApi['sections'],
  setActiveSection: (id: SectionId) => void,
  refresh: () => Promise<void>,
  aiModel: () => string,
): {
  openFile: (path: string, heading?: string | null) => void
  openChat: (path: string) => void
  newChat: () => Promise<void>
  openBoard: (id: string) => void
  openBoardCard: (path: string) => void
  openBot: (bot: Bot, threadPath: string | null) => Promise<void>
} {
  const openChat = useCallback(
    (path: string) => {
      setActiveSection('ai')
      sections?.ai.openView('chat', { path })
    },
    [sections, setActiveSection],
  )

  /**
   * A new conversation is a new note, created up front rather than on the first
   * message. It costs one empty file and buys the invariant the whole feature
   * rests on: the thing on screen always has somewhere on disk to be.
   */
  const newChat = useCallback(async () => {
    const created = await api.invoke(IPC.fsCreate, CHAT_FOLDER, chatFileName(new Date()), 'file')
    if (!created.ok) return
    await api.invoke(
      IPC.fsWrite,
      created.path,
      // No `created:` field: the filename IS the timestamp, and two records of
      // the same fact drift.
      serialiseConversation({ title: 'New chat', model: aiModel(), messages: [] }),
    )
    await refresh()
    openChat(created.path)
  }, [refresh, openChat])

  const openBoard = useCallback(
    (id: string) => {
      setActiveSection('tasks')
      sections?.tasks.openView('board', { board: id })
    },
    [sections, setActiveSection],
  )

  const openFile = useCallback(
    (path: string, heading?: string | null) => {
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

  /**
   * A bot opens on its newest thread. A bot that has none gets one, created
   * as an empty note up front - like a new chat, so what is on screen always
   * has somewhere on disk to be.
   */
  const openBot = useCallback(
    async (bot: Bot, threadPath: string | null) => {
      let path = threadPath
      if (path === null) {
        const created = await api.invoke(IPC.fsCreate, botThreadFolder(bot.id), chatFileName(new Date()), 'file')
        if (!created.ok) return
        await api.invoke(IPC.fsWrite, created.path, serialiseConversation({ title: 'New chat', model: null, messages: [] }, bot.name))
        await refresh()
        path = created.path
      }
      setActiveSection('ai')
      sections?.ai.openView('bot', { bot: bot.id, path })
    },
    [sections, setActiveSection, refresh],
  )

  return { openFile, openChat, newChat, openBoard, openBoardCard, openBot }
}
