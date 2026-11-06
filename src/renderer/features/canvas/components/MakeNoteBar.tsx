import { useEffect, useState } from 'react'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'
import { folderOf, nameProblem } from '@shared/obsidian-links'
import { cardName, createCardNote } from '../../boards/create-card'
import { fuzzyFilter } from '../../../ui/fuzzy'
import { Icon } from '../../../ui/Icon'
import { NameWarning } from '../../../ui/NameWarning'

/**
 * "Make it a note" on a text node: the note's name (its first line, to start
 * with), made in `folder` under Obsidian's name rules. When notes of that name
 * are already in the vault, it asks: use one of them (put it on the canvas -
 * its file stays where it is, never moved), or make a new one here beside them,
 * as Obsidian allows. Only when the chosen folder has one already is "here"
 * impossible (the same file, to the Mac): then another name.
 */

/** A note's name from a text node: its first line, without a heading's #. */
export const noteNameFrom = (text: string): string => cardName(text.replace(/^\s*#{1,6}\s+/, '')) || 'Untitled'

/** The note's body: the text without its first line when that line was a heading - the title is the file name. */
export const noteBodyFrom = (text: string): string =>
  /^\s*#{1,6}\s+/.test(text) ? text.split('\n').slice(1).join('\n').replace(/^\n+/, '') : text

const REMEMBERED = 'canvas-notes'

/** Where a note is, for a person: its folder, or the vault's top. */
const placeOf = (path: string): string => (folderOf(path) === '' ? 'the vault’s top folder' : folderOf(path))

export function MakeNoteBar({
  text,
  folder: beside,
  folders,
  sameNamed,
  onMade,
  onCancel,
}: {
  text: string
  /** The canvas's own folder: where a note goes unless another was chosen. */
  folder: string
  /** Every folder in the vault, to choose from. */
  folders: readonly string[]
  /** The notes already called this (ignoring case), anywhere in the vault. */
  sameNamed: (name: string) => readonly string[]
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
  /** Notes already called the typed name: shown to use one of, or to make a new one beside. */
  const [taken, setTaken] = useState<readonly string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The folder list, open, and what is typed to find one. */
  const [picking, setPicking] = useState<string | null>(null)
  const others = folders.filter((f) => f !== beside)
  const found = picking === null || picking.trim() === '' ? others : fuzzyFilter(picking.trim(), others, (f) => f).map((m) => m.item)
  const besideLabel = beside === '' ? 'Vault root' : beside

  const make = async (): Promise<void> => {
    const typed = cardName(name)
    const problem = typed === '' ? 'A note needs a name.' : nameProblem(typed)
    if (problem !== null) {
      setError(problem)
      return
    }
    // Notes of this name already: asked first - use one, or make a new one here.
    const others = sameNamed(typed)
    if (others.length > 0) {
      setTaken(others)
      return
    }
    await createHere(typed)
  }

  /** A new note of this name in the chosen folder, beside any of the same name elsewhere. */
  const createHere = async (typed: string): Promise<void> => {
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
      <NameWarning name={name} />
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
      {taken !== null && (
        <div className="canvas-bar__taken" role="group" aria-label="A note of this name exists">
          <p className="canvas-bar__note">
            {taken.length === 1 ? `“${cardName(name)}” is already a note, in ${placeOf(taken[0]!)}.` : `${taken.length} notes are called “${cardName(name)}”.`}
          </p>
          {taken.map((p) => (
            <button key={p} className="btn btn--sm canvas-bar__use" onClick={() => onMade(p)}>
              Use that note{taken.length > 1 ? ` (${placeOf(p)})` : ''}
            </button>
          ))}
        </div>
      )}
      {error !== null && <p className="canvas-bar__error">{error}</p>}
      <div className="canvas-bar__actions">
        <button className="btn btn--ghost btn--sm" onClick={onCancel}>
          Cancel
        </button>
        {taken === null ? (
          <button className="btn btn--primary btn--sm" onClick={() => void make()}>
            Make it a note
          </button>
        ) : taken.some((p) => folderOf(p).toLowerCase() === target.toLowerCase()) ? (
          // The chosen folder has one: a second there would be the same file.
          <button
            className="btn btn--primary btn--sm"
            onClick={() => {
              setTaken(null)
              setError(null)
            }}
          >
            Choose another name
          </button>
        ) : (
          <button className="btn btn--primary btn--sm" onClick={() => void createHere(cardName(name))}>
            Create a new “{cardName(name)}” here
          </button>
        )}
      </div>
    </div>
  )
}
