import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { IPC, type BoardDeleteChoice } from '@shared/ipc'
import { parseKanban } from '@shared/kanban'
import { isPlacedCard } from '@shared/recto-paths'
import { api } from '../../../app/api'
import { noteIndexChanged } from '../../../app/note-bus'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { Icon } from '../../../ui/Icon'
import { refreshBoards, useBoards } from '../boards-store'

/**
 * Deleting a board note asks what becomes of its cards.
 *
 * The board note goes to the macOS Trash. Its cards go to Unsorted, to another
 * board, or to the Trash too - main does the moving (main/boards.ts) - and a
 * notice offers to undo all of it. A card another board still links stays on it, and a note
 * from outside Recto's folders only loses its line: neither is ever trashed.
 * Asked from the Tasks list and from the file tree, so it is a request any of
 * them can make and one dialog answers.
 */

let asked: { path: string; done?: () => void } | null = null
/** The last delete, while its undo is offered. */
let undo: { name: string; id: string; count: number } | null = null
const listeners = new Set<() => void>()
const emit = (): void => {
  for (const listener of listeners) listener()
}
const UNDO_MS = 60_000

/** Ask to delete a board note; `done` runs once it is gone. */
export function requestBoardDelete(path: string, done?: () => void): void {
  asked = { path, ...(done === undefined ? {} : { done }) }
  emit()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Mounted once, in the shell. */
export function BoardDeleteHost(): React.ReactElement | null {
  const request = useSyncExternalStore(subscribe, () => asked)
  const offered = useSyncExternalStore(subscribe, () => undo)
  return (
    <>
      {request !== null && (
        <DeleteBoardDialog
          key={request.path}
          path={request.path}
          onClose={(deleted) => {
            asked = null
            emit()
            if (deleted) request.done?.()
          }}
        />
      )}
      {offered !== null && <UndoNotice {...offered} />}
    </>
  )
}

function UndoNotice({ name, id, count }: { name: string; id: string; count: number }): React.ReactElement {
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (undo?.id === id) {
        undo = null
        emit()
      }
    }, UNDO_MS)
    return () => clearTimeout(timer)
  }, [id])
  const close = (): void => {
    undo = null
    emit()
  }
  return createPortal(
    <p className="board-undo glass-surface" role="status">
      <span>
        {error ?? `Deleted ${name}${count === 0 ? '' : ` and ${count} ${count === 1 ? 'card' : 'cards'}`}; moved to the Trash.`}
      </span>
      {error === null && (
        <button
          className="board-undo__button"
          onClick={() =>
            void api.invoke(IPC.boardsUndoDelete, id).then((result) => {
              if (!result.ok) return setError(result.error ?? 'Could not undo.')
              noteIndexChanged()
              refreshBoards()
              close()
            })
          }
        >
          Undo
        </button>
      )}
      <button className="board-undo__close" aria-label="Dismiss" onClick={close}>
        <Icon name="x" size={12} />
      </button>
    </p>,
    document.body,
  )
}

const stem = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

function DeleteBoardDialog({ path, onClose }: { path: string; onClose: (deleted: boolean) => void }): React.ReactElement {
  const boards = useBoards().filter((b) => b.path !== path)
  const [notes, setNotes] = useState<string[] | null>(null)
  const [choice, setChoice] = useState<BoardDeleteChoice['kind']>('unsorted')
  const [to, setTo] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const name = stem(path)

  // The notes its cards are: their links, resolved.
  useEffect(() => {
    void api.invoke(IPC.fsRead, path).then(async (read) => {
      if (!read.ok) return setNotes([])
      const links = [...new Set(parseKanban(read.content).lanes.flatMap((lane) => lane.items.flatMap((item) => (item.link === null ? [] : [item.link]))))]
      const found = links.length === 0 ? {} : await api.invoke(IPC.indexCards, links)
      setNotes([...new Set(Object.values(found).flatMap((row) => (row === null ? [] : [row.path])))])
    })
  }, [path])

  const target = to !== '' ? to : (boards[0]?.path ?? '')
  const placed = (notes ?? []).filter(isPlacedCard).length
  const outside = (notes ?? []).length - placed

  const remove = async (): Promise<void> => {
    const kind: BoardDeleteChoice =
      choice === 'board' ? { kind: 'board', to: target } : choice === 'trash' ? { kind: 'trash' } : { kind: 'unsorted' }
    const result = await api.invoke(IPC.boardsDelete, path, kind)
    if (!result.ok) return setError(result.error)
    if (result.undoId !== undefined) {
      undo = { name, id: result.undoId, count: result.trashed.length }
      emit()
    }
    noteIndexChanged()
    refreshBoards()
    onClose(true)
  }

  const option = (value: BoardDeleteChoice['kind'], label: React.ReactNode, disabled = false): React.ReactElement => (
    <label>
      <input type="radio" name="board-delete" checked={choice === value} disabled={disabled} onChange={() => setChoice(value)} /> {label}
    </label>
  )

  return (
    <ConfirmDialog
      title="Delete board"
      body={
        <>
          <strong>{name}</strong> goes to the Trash.{' '}
          {notes === null ? (
            'Counting its cards…'
          ) : notes.length === 0 ? (
            'None of its cards is a note.'
          ) : (
            <>
              Its {notes.length === 1 ? 'card note' : `${notes.length} card notes`}:
              <span className="board-delete__choice">
                {option('unsorted', 'Move to Unsorted')}
                {option(
                  'board',
                  <>
                    Move to{' '}
                    <select
                      className="setting__select"
                      aria-label="Board to move the cards to"
                      value={target}
                      disabled={boards.length === 0}
                      onChange={(event) => {
                        setTo(event.target.value)
                        setChoice('board')
                      }}
                    >
                      {boards.map((b) => (
                        <option key={b.path} value={b.path}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </>,
                  boards.length === 0,
                )}
                {option('trash', 'Move to the Trash')}
              </span>
              <span className="board-delete__note">
                Cards another board also has stay on it.
                {outside > 0 && ` ${outside === 1 ? 'One note' : `${outside} notes`} from outside Recto/ only ${outside === 1 ? 'loses its' : 'lose their'} line.`}
              </span>
            </>
          )}
          {error !== null && <span className="board-delete__error"> {error}</span>}
        </>
      }
      confirmLabel={choice === 'trash' ? 'Delete board and trash cards' : 'Delete board'}
      onConfirm={() => void remove()}
      onCancel={() => onClose(false)}
    />
  )
}
