import { useState } from 'react'
import { Icon } from '../components/Icon'
import { fuzzyMatch } from '../core/fuzzy'
import { columnId, DEFAULT_BOARDS, type Board } from './boards'
import { updateBoards, useBoards } from './use-boards'

/**
 * The Tasks sidebar: which boards exist.
 *
 * Deliberately the same shape as the file tree next door — a list you pick
 * from — because Tasks is a workspace like Data, not a different kind of app.
 */

type Props = {
  activeBoard: string | null
  /** The sidebar's search box, shared with the file tree next door. */
  query: string
  onOpen: (id: string) => void
}

export function BoardList({ activeBoard, query, onOpen }: Props): React.ReactElement {
  const file = useBoards()
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)

  const add = (name: string): void => {
    const trimmed = name.trim()
    setAdding(false)
    if (trimmed === '') return
    // Board ids are reused as `board:` values in frontmatter, so they go
    // through the same slug rules as column ids.
    const id = columnId(trimmed, file.boards)
    // Copied, not aliased: sharing the module constant would put one stray
    // in-place edit between us and a corrupted default for every new board.
    const board: Board = {
      id,
      name: trimmed,
      columns: DEFAULT_BOARDS.boards[0]!.columns.map((column) => ({ ...column })),
    }
    updateBoards({ boards: [...file.boards, board] })
    onOpen(id)
  }

  const remove = (id: string): void => {
    if (file.boards.length <= 1) return
    // Only the definition goes. The cards are notes and stay exactly where they
    // are; recreating a board with the same id brings them all back.
    updateBoards({ boards: file.boards.filter((board) => board.id !== id) })
  }

  const trimmed = query.trim()
  const shown =
    trimmed === '' ? file.boards : file.boards.filter((board) => fuzzyMatch(trimmed, board.name) !== null)

  return (
    <div className="boards">
      {shown.map((board) => (
        <div className={`boards__row${board.id === activeBoard ? ' is-active' : ''}`} key={board.id}>
          {renaming === board.id ? (
            <input
              className="boards__rename"
              defaultValue={board.name}
              autoFocus
              onBlur={(event) => {
                setRenaming(null)
                const name = event.target.value.trim()
                if (name !== '' && name !== board.name) {
                  // The id stays: it is what every card's frontmatter says.
                  updateBoards({
                    boards: file.boards.map((entry) => (entry.id === board.id ? { ...entry, name } : entry)),
                  })
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') setRenaming(null)
              }}
            />
          ) : (
            <>
              <button
                className="boards__name"
                onClick={() => onOpen(board.id)}
                onDoubleClick={() => setRenaming(board.id)}
              >
                <Icon name="square-kanban" size={14} />
                {board.name}
              </button>
              {file.boards.length > 1 && (
                <button
                  className="boards__remove"
                  aria-label={`Remove ${board.name}`}
                  title="Remove this board — the cards stay as notes"
                  onClick={() => remove(board.id)}
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </>
          )}
        </div>
      ))}

      {shown.length === 0 && <p className="sidebar__empty">No board matches “{trimmed}”.</p>}

      {adding ? (
        <input
          className="boards__rename"
          placeholder="Board name"
          autoFocus
          onBlur={(event) => add(event.target.value)}
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
    </div>
  )
}
