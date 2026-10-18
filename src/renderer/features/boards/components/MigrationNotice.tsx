import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { IPC } from '@shared/ipc'
import type { BoardMigrationResult } from '@shared/board-migration'
import { api } from '../../../app/api'
import { noteIndexChanged } from '../../../app/note-bus'
import { refreshBoards } from '../boards-store'

/**
 * What the boards migration did when this vault opened (main/board-migration.ts),
 * said once: which board notes it made, how many cards it changed, and where
 * the copy of every changed file is. When a board's name was already a
 * note's, nothing was written: this asks for another name and runs it again.
 */
export function BoardsMigrationNotice({ vaultPath, onOpenBoard }: { vaultPath: string; onOpenBoard: (path: string) => void }): React.ReactElement | null {
  const [result, setResult] = useState<BoardMigrationResult>({ state: 'none' })

  useEffect(() => {
    void api.invoke(IPC.boardsMigration).then(setResult)
  }, [vaultPath])

  useEffect(() => {
    if (result.state === 'migrated') {
      noteIndexChanged()
      refreshBoards()
    }
  }, [result])

  if (result.state === 'none') return null
  if (result.state === 'conflicts')
    return (
      <NamesDialog
        conflicts={result.conflicts}
        onSubmit={(names) => void api.invoke(IPC.boardsMigrate, names).then(setResult)}
        onLater={() => setResult({ state: 'none' })}
      />
    )

  const close = (): void => setResult({ state: 'none' })
  return createPortal(
    <div className="dialog__backdrop" role="presentation">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label="Boards are notes now"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape' || event.key === 'Enter') close()
        }}
      >
        <header className="dialog__head">
          <h2 className="dialog__title">{result.state === 'failed' ? "Boards weren't moved" : 'Boards are notes now'}</h2>
        </header>
        {result.state === 'failed' ? (
          <p className="dialog__lede">
            Recto tried to turn your boards into notes and stopped: {result.error} Nothing was deleted; your boards stay as they were until it can.
          </p>
        ) : (
          <>
            <p className="dialog__lede">
              Each board is a note in the Obsidian Kanban format, so it opens in Obsidian too. Its cards are lines on it, linking to their notes;
              the notes keep their priority, dates and tags, and no longer say which board or column they are in.
            </p>
            <ul className="board-migrated">
              {result.boards.map((board) => (
                <li key={board.path}>
                  <button
                    className="board-migrated__open"
                    onClick={() => {
                      close()
                      onOpenBoard(board.path)
                    }}
                  >
                    {board.path}
                  </button>{' '}
                  · {board.cards} {board.cards === 1 ? 'card' : 'cards'}
                </li>
              ))}
            </ul>
            {result.backup !== null && (
              <p className="dialog__lede">
                {result.cards} card {result.cards === 1 ? 'note was' : 'notes were'} changed. A copy of every file before the change is in{' '}
                <code>{result.backup}</code>.
              </p>
            )}
          </>
        )}
        <footer className="dialog__actions">
          <button className="dialog__submit" autoFocus onClick={close}>
            OK
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

function NamesDialog({
  conflicts,
  onSubmit,
  onLater,
}: {
  conflicts: { id: string; name: string }[]
  onSubmit: (names: Record<string, string>) => void
  onLater: () => void
}): React.ReactElement {
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(conflicts.map((c) => [c.id, `${c.name} board`])))
  return createPortal(
    <div className="dialog__backdrop" role="presentation">
      <form
        className="dialog"
        role="dialog"
        aria-label="Name your boards"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(names)
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <h2 className="dialog__title">A board needs another name</h2>
        <p className="dialog__lede">
          Boards are becoming notes, in tasks/ beside their cards. A note already has the name of {conflicts.length === 1 ? 'this board' : 'these boards'}, and
          two notes can't share one. Nothing has been changed yet.
        </p>
        {conflicts.map((conflict, i) => (
          <label className="board-field" key={conflict.id}>
            <span>{conflict.name}</span>
            <input
              className="dialog__input"
              value={names[conflict.id] ?? ''}
              autoFocus={i === 0}
              aria-label={`New name for ${conflict.name}`}
              onChange={(event) => setNames({ ...names, [conflict.id]: event.target.value })}
            />
          </label>
        ))}
        <footer className="dialog__actions">
          <button type="button" className="dialog__ghost" onClick={onLater}>
            Later
          </button>
          <button type="submit" className="dialog__submit">
            Make the boards
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}
