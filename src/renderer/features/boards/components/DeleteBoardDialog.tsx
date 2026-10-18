import { useEffect, useState, useSyncExternalStore } from 'react'
import { IPC } from '@shared/ipc'
import { parseKanban } from '@shared/kanban'
import { api } from '../../../app/api'
import { noteIndexChanged } from '../../../app/note-bus'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { refreshBoards } from '../boards-store'

/**
 * Deleting a board note asks what becomes of its cards.
 *
 * The board goes to the archive, like any note. Its cards' notes stay, unless
 * you choose to archive them too - never silently: a card can be on another
 * board, and a note is yours. Asked from the Tasks list and from the file tree,
 * so it is a request any of them can make and one dialog answers.
 */

let asked: { path: string; done?: () => void } | null = null
const listeners = new Set<() => void>()
const emit = (): void => {
  for (const listener of listeners) listener()
}

/** Ask to delete a board note; `done` runs once it is gone. */
export function requestBoardDelete(path: string, done?: () => void): void {
  asked = { path, ...(done === undefined ? {} : { done }) }
  emit()
}

/** Mounted once, in the shell. */
export function BoardDeleteHost(): React.ReactElement | null {
  const request = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => asked,
  )
  if (request === null) return null
  return (
    <DeleteBoardDialog
      key={request.path}
      path={request.path}
      onClose={(deleted) => {
        asked = null
        emit()
        if (deleted) request.done?.()
      }}
    />
  )
}

function DeleteBoardDialog({ path, onClose }: { path: string; onClose: (deleted: boolean) => void }): React.ReactElement {
  const [notes, setNotes] = useState<string[] | null>(null)
  const [withCards, setWithCards] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

  // The notes its cards are: their links, resolved.
  useEffect(() => {
    void api.invoke(IPC.fsRead, path).then(async (read) => {
      if (!read.ok) return setNotes([])
      const links = [...new Set(parseKanban(read.content).lanes.flatMap((lane) => lane.items.flatMap((item) => (item.link === null ? [] : [item.link]))))]
      const found = links.length === 0 ? {} : await api.invoke(IPC.indexCards, links)
      setNotes([...new Set(Object.values(found).flatMap((row) => (row === null ? [] : [row.path])))])
    })
  }, [path])

  const count = notes?.length ?? 0
  const remove = async (): Promise<void> => {
    const archived = await api.invoke(IPC.archiveAdd, path)
    if (!archived.ok) return setError(archived.error)
    if (withCards) for (const note of notes ?? []) await api.invoke(IPC.archiveAdd, note)
    noteIndexChanged()
    refreshBoards()
    onClose(true)
  }

  return (
    <ConfirmDialog
      title="Delete board"
      body={
        <>
          <strong>{name}</strong> goes to the archive.{' '}
          {notes === null ? (
            'Counting its cards…'
          ) : count === 0 ? (
            'None of its cards is a note.'
          ) : (
            <>
              <span className="board-delete__choice">
                <label>
                  <input type="radio" name="board-delete" checked={!withCards} onChange={() => setWithCards(false)} /> Keep its {count}{' '}
                  {count === 1 ? 'card note' : 'card notes'}
                </label>
                <label>
                  <input type="radio" name="board-delete" checked={withCards} onChange={() => setWithCards(true)} /> Archive{' '}
                  {count === 1 ? 'that note' : `those ${count} notes`} too
                </label>
              </span>
            </>
          )}
          {error !== null && <span className="board-delete__error"> {error}</span>}
        </>
      }
      confirmLabel={withCards ? 'Delete board and archive cards' : 'Delete board'}
      onConfirm={() => void remove()}
      onCancel={() => onClose(false)}
    />
  )
}
