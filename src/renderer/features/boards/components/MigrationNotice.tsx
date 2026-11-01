import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { IPC } from '@shared/ipc'
import type { BoardMigrationResult } from '@shared/board-migration'
import { BOARDS_FOLDER, CHATS_FOLDER, UNSORTED_FOLDER, type LayoutMigrationResult } from '@shared/recto-paths'
import { api } from '../../../app/api'
import { noteIndexChanged } from '../../../app/note-bus'
import { refreshBoards } from '../boards-store'

/**
 * What the boards migration did when this vault opened (main/board-migration.ts),
 * said once: which board notes it made, how many cards it changed, and where
 * the copy of every changed file is. When a board's name was already a
 * note's, nothing was written: this asks for another name and runs it again.
 */
export function BoardsMigrationNotice({
  vaultPath,
  onOpenBoard,
  onSettled,
}: {
  vaultPath: string
  onOpenBoard: (path: string) => void
  /** Nothing (more) to say: the next notice may show. */
  onSettled: () => void
}): React.ReactElement | null {
  const [result, setResult] = useState<BoardMigrationResult | null>(null)

  useEffect(() => {
    setResult(null)
    void api.invoke(IPC.boardsMigration).then(setResult)
  }, [vaultPath])

  useEffect(() => {
    if (result?.state === 'none') onSettled()
  }, [result, onSettled])

  useEffect(() => {
    if (result?.state === 'migrated') {
      noteIndexChanged()
      refreshBoards()
    }
  }, [result])

  if (result === null || result.state === 'none') return null
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

/**
 * What moving tasks/ and chats/ into Recto/ did when this vault opened
 * (main/layout-migration.ts), said once: how many files moved, which links
 * were rewritten, and where the copies are.
 */
export function LayoutMigrationNotice({ vaultPath, asks }: { vaultPath: string; asks: number }): React.ReactElement | null {
  const [result, setResult] = useState<LayoutMigrationResult>({ state: 'none' })

  // Asked each time the boards notice has had its say: that migration runs
  // first, and a retry after its names dialog is what lets this one run.
  useEffect(() => {
    if (asks > 0) void api.invoke(IPC.layoutMigration).then(setResult)
  }, [vaultPath, asks])

  useEffect(() => {
    if (result.state === 'migrated') {
      noteIndexChanged()
      refreshBoards()
    }
  }, [result])

  if (result.state === 'none') return null
  const close = (): void => setResult({ state: 'none' })
  return createPortal(
    <div className="dialog__backdrop" role="presentation">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label="Boards and chats moved"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape' || event.key === 'Enter') close()
        }}
      >
        <header className="dialog__head">
          <h2 className="dialog__title">{result.state === 'migrated' ? 'Boards and chats are in Recto/ now' : "Boards and chats weren't moved"}</h2>
        </header>
        {result.state === 'failed' && (
          <p className="dialog__lede">Recto tried to move tasks/ and chats/ into Recto/ and stopped: {result.error} Nothing was deleted.</p>
        )}
        {result.state === 'conflicts' && (
          <>
            <p className="dialog__lede">These files are in the way, so nothing was moved. Move or rename them, then open the vault again:</p>
            <ul className="board-migrated">
              {result.conflicts.map((c) => (
                <li key={c.from}>
                  {c.from} → <code>{c.to}</code>
                </li>
              ))}
            </ul>
          </>
        )}
        {result.state === 'migrated' && (
          <>
            <p className="dialog__lede">
              Each board has its own folder in {BOARDS_FOLDER}/, with its cards; cards on no board are in {UNSORTED_FOLDER}/, and chats in {CHATS_FOLDER}/.
              They are ordinary notes, hidden from the Data tree (Settings → Vault shows them). {result.moves.length}{' '}
              {result.moves.length === 1 ? 'file' : 'files'} moved; links by name work as before.
            </p>
            {result.links.length > 0 && (
              <>
                <p className="dialog__lede">These links spelled out a path that moved, so they now name the same note another way:</p>
                <ul className="board-migrated">
                  {result.links.map((l) => (
                    <li key={`${l.path}:${l.from}`}>
                      {l.path}: <code>{l.from}</code> → <code>{l.to}</code>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {result.backup !== null && (
              <p className="dialog__lede">
                A copy of every file before the move is in <code>{result.backup}</code>.
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
