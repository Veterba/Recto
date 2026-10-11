import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../ui/Icon'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { kindChange, stemLength } from '../file-tree-ops'

/**
 * Renaming a file or folder, in a dialog.
 *
 * It was an input inside the tree row, which is smaller and less code - and
 * wrong for this particular action. A rename here is not a cosmetic edit: it
 * rewrites every `[[wikilink]]` pointing at the note, across the whole vault.
 * A modal is the honest shape for something with consequences beyond the row
 * you clicked, and it gives the name room to be read at length rather than
 * inside a 200px column.
 *
 * Portalled to the document body: the sidebar is an `overflow: auto` scroller,
 * so anything rendered inside it is clipped by it.
 *
 * The whole name is there to edit, extension included, so a file's type can
 * be changed here - with a question first when that turns a note into
 * something else or a file into a note (see kindChange).
 */

type Props = {
  /** The current name, extension included. */
  name: string
  /** Vault-relative path, shown so it is clear WHICH file this is. */
  path: string
  /** A folder: no extension, the whole name selected, nothing to ask. */
  folder?: boolean
  onCommit: (next: string) => void
  onCancel: () => void
}

export function RenameDialog({ name, path, folder = false, onCommit, onCancel }: Props): React.ReactElement {
  const [asking, setAsking] = useState<{ next: string; change: 'leaves-notes' | 'becomes-note' } | null>(null)
  if (asking !== null)
    return (
      <ConfirmDialog
        title={asking.change === 'leaves-notes' ? 'Stop being a note?' : 'Make it a note?'}
        body={
          asking.change === 'leaves-notes'
            ? `${asking.next} will stop being a note: its links, backlinks, search entry and what the bot reads change with it.`
            : `${asking.next} will become a note: its links, backlinks, search entry and what the bot reads change with it.`
        }
        confirmLabel="Rename"
        danger={false}
        onConfirm={() => onCommit(asking.next)}
        onCancel={() => setAsking(null)}
      />
    )
  return (
    <NameDialog
      title="Rename"
      submitLabel="Rename"
      path={path}
      initial={name}
      select={stemLength(name, folder)}
      onSubmit={(next) => {
        const change = folder ? null : kindChange(name, next)
        if (change === null) onCommit(next)
        else setAsking({ next, change })
      }}
      onCancel={onCancel}
    />
  )
}

/** A name, typed in a dialog: renaming, and "New file…". */
export function NameDialog({
  title,
  submitLabel,
  path,
  initial,
  select,
  onSubmit,
  onCancel,
}: {
  title: string
  submitLabel: string
  /** Where it is, or where it goes. */
  path: string
  initial: string
  /** How many characters, from the start, are selected. */
  select: number
  onSubmit: (name: string) => void
  onCancel: () => void
}): React.ReactElement {
  const input = useRef<HTMLInputElement | null>(null)
  const [value, setValue] = useState(initial)

  useEffect(() => {
    const element = input.current
    if (element === null) return
    element.focus()
    element.setSelectionRange(0, select)
  }, [select])

  const trimmed = value.trim()
  const submit = (): void => {
    if (trimmed !== '') onSubmit(trimmed)
  }

  return createPortal(
    <div
      className="dialog__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        // Only a click on the backdrop itself dismisses; one that started
        // inside the dialog and drifted out does not.
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') onCancel()
        }}
      >
        <header className="dialog__head">
          <h2 className="dialog__title">{title}</h2>
          <button className="dialog__close" onClick={onCancel} aria-label="Cancel">
            <Icon name="x" size={16} />
          </button>
        </header>

        <p className="dialog__path" title={path}>
          {path}
        </p>

        <form
          className="dialog__row"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <input
            ref={input}
            className="dialog__input"
            value={value}
            spellCheck={false}
            autoComplete="off"
            aria-label="Name"
            onChange={(event) => setValue(event.target.value)}
          />
          <button className="dialog__submit" type="submit" disabled={trimmed === ''}>
            {submitLabel}
          </button>
        </form>
      </div>
    </div>,
    document.body,
  )
}
