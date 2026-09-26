import { registerView } from '../../../app/view-registry'
import { currentBoards, useBoards, updateBoards } from '../hooks/use-boards'
import { BoardView } from './BoardView'

/**
 * Registered as a view type, so a board opens in a tab like anything else and
 * survives in `workspace.json`. The leaf state holds the board id, so reopening
 * the app lands on the board you left.
 */
export function registerBoardView(onOpenNote: (path: string) => void): () => void {
  return registerView({
    type: 'board',
    title: 'Board',
    icon: 'square-kanban',
    getTitle: (state) => {
      const id = state['board']
      const found = currentBoards().boards.find((entry) => entry.id === id)
      return found?.name ?? 'Board'
    },
    render: ({ state }) => <BoardHost boardId={state['board']} onOpenNote={onOpenNote} />,
  })
}

function BoardHost({ boardId, onOpenNote }: { boardId: unknown; onOpenNote: (path: string) => void }): React.ReactElement {
  const file = useBoards()
  const id = typeof boardId === 'string' ? boardId : file.boards[0]?.id
  // A leaf that names a board which has since been deleted falls back rather
  // than rendering nothing - the same rule the workspace uses for view types.
  const board = file.boards.find((entry) => entry.id === id) ?? file.boards[0]

  if (board === undefined) return <p className="board__empty">No boards yet.</p>

  return (
    <BoardView
      board={board}
      onOpenNote={onOpenNote}
      onEditBoard={(next) => updateBoards({ boards: file.boards.map((entry) => (entry.id === next.id ? next : entry)) })}
    />
  )
}
