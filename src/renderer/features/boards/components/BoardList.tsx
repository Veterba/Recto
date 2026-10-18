import { useState } from 'react'
import type { BoardSummaryInfo } from '@shared/index-results'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'
import { noteIndexChanged } from '../../../app/note-bus'
import { ContextMenu, useContextMenu, type MenuItem } from '../../../ui/ContextMenu'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { fuzzyMatch } from '../../../ui/fuzzy'
import { boardMade, refreshBoards, useBoards } from '../boards-store'
import { createBoard } from '../create-card'
import { requestBoardDelete } from './DeleteBoardDialog'

/**
 * The Tasks sidebar: the vault's boards, which are notes.
 *
 * Deliberately the same shape as the file tree next door — a list you pick
 * from — because Tasks is a workspace like Data, not a different kind of app.
 * Boards are notes in tasks/, which the Data tree hides, so this list is where
 * they are made, renamed, deleted and opened. A board's name is its note's
 * name: renaming it here renames the note.
 */

type Props = {
  /** The board note on screen. */
  activeBoard: string | null
  /** The sidebar's search box, shared with the file tree next door. */
  query: string
  onOpen: (path: string) => void
  /** A board note was renamed: its tabs follow. */
  onRenamed: (from: string, to: string) => void
}

export function BoardList({ activeBoard, query, onOpen, onRenamed }: Props): React.ReactElement {
  const boards = useBoards()
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const contextMenu = useContextMenu<BoardSummaryInfo>()

  const menuFor = (board: BoardSummaryInfo): MenuItem[] => [
    { kind: 'heading', label: 'This board' },
    { kind: 'item', label: 'Open', icon: 'square-kanban', run: () => onOpen(board.path) },
    { kind: 'item', label: 'Rename', icon: 'pencil', run: () => setRenaming(board.path) },
    { kind: 'item', label: 'Reveal in Finder', icon: 'external-link', run: () => void api.invoke(IPC.fsReveal, board.path) },
    { kind: 'separator' },
    { kind: 'item', label: 'Delete board…', icon: 'trash', danger: true, run: () => requestBoardDelete(board.path) },
  ]

  const add = async (name: string): Promise<void> => {
    const trimmed = name.trim()
    setAdding(false)
    if (trimmed === '') return
    const created = await createBoard(trimmed)
    if (!created.ok) {
      setError(created.error)
      return
    }
    setError(null)
    boardMade(created.path)
    onOpen(created.path)
  }

  const rename = async (board: BoardSummaryInfo, name: string): Promise<void> => {
    setRenaming(null)
    const trimmed = name.trim()
    if (trimmed === '' || trimmed === board.name) return
    const result = await api.invoke(IPC.fsRename, board.path, `${trimmed}.md`)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    onRenamed(board.path, result.path)
    noteIndexChanged()
    refreshBoards()
  }

  const trimmed = query.trim()
  const shown = trimmed === '' ? boards : boards.filter((board) => fuzzyMatch(trimmed, board.name) !== null)

  return (
    <div className="boards">
      {shown.map((board) => (
        <div
          className={`boards__row${board.path === activeBoard ? ' is-active' : ''}`}
          key={board.path}
          onContextMenu={(event) => contextMenu.open(event, board)}
        >
          {renaming === board.path ? (
            <input
              className="boards__rename"
              defaultValue={board.name}
              aria-label="Board name"
              autoFocus
              onBlur={(event) => void rename(board, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') setRenaming(null)
              }}
            />
          ) : (
            <>
              <button className="boards__name" title={board.path} onClick={() => onOpen(board.path)} onDoubleClick={() => setRenaming(board.path)}>
                <Icon name="square-kanban" size={14} />
                {board.name}
              </button>
              <Tip label="Delete this board" hint="Asks about its cards">
                <button className="boards__remove" aria-label={`Delete ${board.name}`} onClick={() => requestBoardDelete(board.path)}>
                  <Icon name="x" size={12} />
                </button>
              </Tip>
            </>
          )}
        </div>
      ))}

      {boards.length === 0 && !adding && <p className="sidebar__empty">No boards yet. A board is a note; it opens in Obsidian's Kanban plugin too.</p>}
      {boards.length > 0 && shown.length === 0 && <p className="sidebar__empty">No board matches “{trimmed}”.</p>}
      {error !== null && (
        <p className="sidebar__empty boards__error" role="alert">
          {error}
        </p>
      )}

      {adding ? (
        <input
          className="boards__rename"
          placeholder="Board name"
          aria-label="New board name"
          autoFocus
          onBlur={(event) => void add(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') setAdding(false)
          }}
        />
      ) : (
        <button className="boards__add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} />
          New board
        </button>
      )}

      {contextMenu.menu !== null && (
        <ContextMenu items={menuFor(contextMenu.menu.subject)} at={contextMenu.menu.at} onClose={contextMenu.close} />
      )}
    </div>
  )
}
