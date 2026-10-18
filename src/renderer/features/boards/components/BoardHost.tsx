import { useState, useSyncExternalStore } from 'react'
import { registerView } from '../../../app/view-registry'
import { Icon } from '../../../ui/Icon'
import { currentBoards, isBoardPath, useBoards } from '../boards-store'
import { BoardView } from './BoardView'

/**
 * A board note on screen: the board, or - one click away - its Markdown.
 *
 * The same in a note's tab (Data) and a board's tab (Tasks): a board is a
 * note, so whichever way it was opened it is drawn as a board, and the
 * Markdown is the same editor every note has.
 */

/** Which board notes are showing their Markdown, so a tab keeps it across a re-render. */
const raw = new Set<string>()
const rawListeners = new Set<() => void>()
function setRaw(path: string, on: boolean): void {
  if (on) raw.add(path)
  else raw.delete(path)
  for (const listener of rawListeners) listener()
}
const subscribeRaw = (listener: () => void): (() => void) => {
  rawListeners.add(listener)
  return () => rawListeners.delete(listener)
}
const useRaw = (path: string): boolean => useSyncExternalStore(subscribeRaw, () => raw.has(path))

export function BoardNote({
  path,
  card,
  editor,
  onOpenNote,
}: {
  path: string
  card?: string | null
  /** The note's editor, for the Markdown. */
  editor: React.ReactElement
  onOpenNote: (path: string) => void
}): React.ReactElement {
  const showRaw = useRaw(path)
  if (!showRaw) return <BoardView key={path} path={path} card={card ?? null} onOpenNote={onOpenNote} onShowMarkdown={() => setRaw(path, true)} />
  return (
    <div className="board-raw">
      <div className="board-raw__bar">
        <button className="board__tool" onClick={() => setRaw(path, false)}>
          <Icon name="square-kanban" size={12} />
          Show board
        </button>
        <p className="board-raw__warn">
          Text outside the lanes is removed by Obsidian when it saves this board. Recto keeps its own settings in the block at the end.
        </p>
      </div>
      <div className="board-raw__editor">{editor}</div>
    </div>
  )
}

/** Whether a note is a board, from the index (and boards made here a moment ago). */
export function useIsBoard(path: string): boolean {
  const boards = useBoards()
  return boards.some((board) => board.path === path)
}

/**
 * Registered as a view type, so a board opens in a tab like anything else and
 * survives in `workspace.json`. The leaf state holds the board note's path
 * (and a card to open beside it); a leaf from before boards were notes holds
 * an id instead, and falls back to the first board.
 */
export function registerBoardView(
  onOpenNote: (path: string) => void,
  renderEditor: (path: string, onRenamed: (next: string) => void) => React.ReactElement,
): () => void {
  return registerView({
    type: 'board',
    title: 'Board',
    icon: 'square-kanban',
    getTitle: (state) => {
      const path = state['path']
      return typeof path === 'string' ? path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '') : (currentBoards()[0]?.name ?? 'Board')
    },
    render: ({ state, setState }) => (
      <BoardLeaf
        path={state['path']}
        card={state['card']}
        onOpenNote={onOpenNote}
        renderEditor={(p) => renderEditor(p, (next) => setState({ path: next }))}
      />
    ),
  })
}

function BoardLeaf({
  path,
  card,
  onOpenNote,
  renderEditor,
}: {
  path: unknown
  card: unknown
  onOpenNote: (path: string) => void
  renderEditor: (path: string) => React.ReactElement
}): React.ReactElement {
  const boards = useBoards()
  const [fallback] = useState(() => (typeof path === 'string' ? null : (currentBoards()[0]?.path ?? null)))
  const shown = typeof path === 'string' ? path : (fallback ?? boards[0]?.path)
  if (shown === undefined || shown === null)
    return <p className="board__empty">No boards yet. “New board” in the sidebar makes one, as a note in tasks/.</p>
  if (typeof path === 'string' && boards.length > 0 && !isBoardPath(path))
    return <p className="board__empty">“{path.replace(/\.md$/i, '')}” is not a board any more.</p>
  return <BoardNote path={shown} card={typeof card === 'string' ? card : null} editor={renderEditor(shown)} onOpenNote={onOpenNote} />
}
