import { useCallback } from 'react'
import { api } from '../api'
import { IPC } from '@shared/ipc'
import type { SectionId } from '../sections'
import type { WorkspaceApi } from './use-workspace'
import { createCard, type useBoards } from '../../features/boards'

/** Making things: a note or folder in the tree, and the sidebar's New button per section. */
export function useShellCreate({
  refresh,
  setExpanded,
  openFile,
  activeSection,
  newChat,
  boards,
  activeBoard,
  openBoardCard,
  active,
  viewType,
}: {
  refresh: () => Promise<void>
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>
  openFile: (path: string) => void
  activeSection: SectionId
  newChat: () => Promise<void>
  boards: ReturnType<typeof useBoards>
  activeBoard: string | null
  openBoardCard: (path: string) => void
  active: WorkspaceApi['active']
  viewType: string
}): {
  createAt: (parent: string, kind: 'file' | 'folder') => Promise<void>
  createIn: (kind: 'file' | 'folder') => Promise<void>
  onNew: () => void
} {
  const createAt = useCallback(
    async (parent: string, kind: 'file' | 'folder') => {
      const name = kind === 'file' ? 'Untitled.md' : 'New folder'
      const result = await api.invoke(IPC.fsCreate, parent, name, kind)
      if (!result.ok) return
      await refresh()
      // Expand the folder it went into, or the new thing is created somewhere
      // you cannot see.
      if (parent !== '') setExpanded((prev) => new Set(prev).add(parent))
      if (kind === 'file') openFile(result.path)
      else setExpanded((prev) => new Set(prev).add(result.path))
    },
    [refresh, openFile],
  )

  /**
   * New note / new folder from the sidebar button, ⌘N or the palette: always
   * at the top of the vault.
   *
   * It used to go into the folder of whatever note was open - an invisible
   * rule that dropped new notes into some folder you had last been reading in.
   * The top level is where loose notes belong until they are filed, and Tidy
   * files them. Creating inside a specific folder is its right-click menu.
   */
  const createIn = useCallback((kind: 'file' | 'folder') => createAt('', kind), [createAt])

  /** The sidebar's bottom-left button means something different per section. */
  const onNew = useCallback(() => {
    if (activeSection === 'data') {
      void createIn('file')
      return
    }
    if (activeSection === 'ai') {
      void newChat()
      return
    }
    if (activeSection === 'tasks') {
      // It used to open another copy of the board, which is not what a button
      // labelled "Task" promises. Now it makes a card on the board you are
      // looking at and opens it, so you can start typing.
      const board = boards.boards.find((entry) => entry.id === activeBoard) ?? boards.boards[0]
      const column = board?.columns[0]
      if (board === undefined || column === undefined) return
      void createCard(board.id, column.id, 'New task').then((created) => {
        if (created.ok) openBoardCard(created.path)
      })
      return
    }
    active?.openView(viewType, { draft: Date.now() }, { reuse: false })
  }, [activeSection, createIn, active, viewType, boards, activeBoard, openBoardCard, newChat])

  return { createAt, createIn, onNew }
}
