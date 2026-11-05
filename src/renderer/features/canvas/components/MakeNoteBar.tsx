import { useEffect, useState } from 'react'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'
import { nameProblem } from '@shared/vault'
import { cardName, createCardNote, noteNamed } from '../../boards/create-card'
import { fuzzyFilter } from '../../../ui/fuzzy'
import { Icon } from '../../../ui/Icon'

/**
 * "Make it a note" on a text node: the note's name (its first line, to start
 * with), made in `folder` under the usual name rules. A name a note already
 * has is not taken over: you choose that note instead, or another name.
 */

/** A note's name from a text node: its first line, without a heading's #. */
export const noteNameFrom = (text: string): string => cardName(text.replace(/^\s*#{1,6}\s+/, '')) || 'Untitled'

/** The note's body: the text without its first line when that line was a heading - the title is the file name. */
export const noteBodyFrom = (text: string): string =>
  /^\s*#{1,6}\s+/.test(text) ? text.split('\n').slice(1).join('\n').replace(/^\n+/, '') : text

const REMEMBERED = 'canvas-notes'

export function MakeNoteBar({
  text,
  folder: beside,
  folders,
  onMade,
  onCancel,
}: {
  text: string
  /** The canvas's own folder: where a note goes unless another was chosen. */
  folder: string
  /** Every folder in the vault, to choose from. */
  folders: readonly string[]
  /** The note to put in the node's place: made now, or one that was there already. */
  onMade: (path: string) => void
  onCancel: () => void
}): React.ReactElement {
  const [name, setName] = useState(() => noteNameFrom(text))
  // The folder new notes from a canvas go in: the default (noteFolderBeside), or the one chosen last time in this vault.
  const [folder, setFolder] = useState<string | null>(null)
  useEffect(() => {
    void api.invoke(IPC.stateRead, REMEMBERED).then((raw) => {
      const kept = (raw as { folder?: unknown } | null)?.folder
      setFolder(typeof kept === 'string' && folders.includes(kept) ? kept : null)
    })
  }, [folders])
  const target = folder ?? beside
  const choose = (next: string | null): void => {
    setFolder(next)
    void api.invoke(IPC.stateWrite, REMEMBERED, { folder: next })
  }
  const [taken, setTaken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The folder list, open, and what is typed to find one. */
  const [picking, setPicking] = useState<string | null>(null)
  const others = folders.filter((f) => f !== beside)
  const found = picking === null || picking.trim() === '' ? others : fuzzyFilter(picking.trim(), others, (f) => f).map((m) => m.item)
  const besideLabel = beside === '' ? 'Vault root' : beside

  const make = async (): Promise<void> => {
    const typed = cardName(name)
    const problem = typed === '' ? 'A note needs a name.' : nameProblem(typed, true)
    if (problem !== null) {
      setError(problem)
      return
    }
    const existing = await noteNamed(typed)
    if (existing !== null) {
      setTaken(existing)
      return
    }
    const made = await createCardNote(typed, target, noteBodyFrom(text))
    if (made.ok) onMade(made.path)
    else setError(made.error)
  }

  return (
    <div className="canvas-bar glass-surface" role="dialog" aria-label="Make it a note">
      <div className="canvas-bar__head">
        <span className="canvas-bar__label">Make it a note</span>
        <button className="canvas-bar__close" aria-label="Cancel" onClick={onCancel}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <input
        className="canvas-bar__input"
        aria-label="Note name"
        value={name}
        autoFocus
        onFocus={(ev) => ev.currentTarget.select()}
        onChange={(ev) => {
          setName(ev.target.value)
          setTaken(null)
          setError(null)
        }}
        onKeyDown={(ev) => {
          ev.stopPropagation()
          if (ev.key === 'Enter') void make()
          if (ev.key === 'Escape') onCancel()
        }}
      />
      <button
        className="canvas-bar__folder"
        aria-label="Folder"
        aria-expanded={picking !== null}
        onClick={() => setPicking(picking === null ? '' : null)}
      >
        <Icon name="folder" size={14} />
        <span className="canvas-bar__folder-name">{folder ?? besideLabel}</span>
        {folder === null && <span className="canvas-bar__hint">default</span>}
        <Icon name="chevron-down" size={14} />
      </button>
      {picking !== null && (
        <div className="canvas-bar__folders">
          <input
            className="canvas-bar__input canvas-bar__find"
            aria-label="Find a folder"
            placeholder="Find a folder…"
            value={picking}
            autoFocus
            onChange={(ev) => setPicking(ev.target.value)}
            onKeyDown={(ev) => {
              ev.stopPropagation()
              if (ev.key === 'Escape') setPicking(null)
              if (ev.key === 'Enter' && found[0] !== undefined) {
                choose(found[0])
                setPicking(null)
              }
            }}
          />
          <ul className="canvas-bar__list" role="listbox" aria-label="Folders">
            {picking.trim() === '' && (
              <li>
                <button
                  className={`canvas-bar__option${folder === null ? ' is-chosen' : ''}`}
                  onClick={() => {
                    choose(null)
                    setPicking(null)
                  }}
                >
                  {besideLabel}
                  <span className="canvas-bar__hint">default</span>
                </button>
              </li>
            )}
            {found.map((f) => (
              <li key={f}>
                <button
                  className={`canvas-bar__option${f === folder ? ' is-chosen' : ''}`}
                  onClick={() => {
                    choose(f)
                    setPicking(null)
                  }}
                >
                  {f}
                </button>
              </li>
            ))}
            {found.length === 0 && picking.trim() !== '' && <li className="canvas-bar__hint">No folder matches.</li>}
          </ul>
        </div>
      )}
      {taken !== null && <p className="canvas-bar__note">A note “{cardName(name)}” already exists. Put that one here instead?</p>}
      {error !== null && <p className="canvas-bar__error">{error}</p>}
      <div className="canvas-bar__actions">
        <button className="btn btn--ghost btn--sm" onClick={onCancel}>
          Cancel
        </button>
        {taken === null ? (
          <button className="btn btn--primary btn--sm" onClick={() => void make()}>
            Make it a note
          </button>
        ) : (
          <button className="btn btn--primary btn--sm" onClick={() => onMade(taken)}>
            Use that note
          </button>
        )}
      </div>
    </div>
  )
}
