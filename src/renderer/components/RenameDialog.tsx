import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

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
 */

type Props = {
  /** The current name, extension included. */
  name: string
  /** Vault-relative path, shown so it is clear WHICH file this is. */
  path: string
  onCommit: (next: string) => void
  onCancel: () => void
}

export function RenameDialog({ name, path, onCommit, onCancel }: Props): React.ReactElement {
  const input = useRef<HTMLInputElement | null>(null)
  const [value, setValue] = useState(name)

  useEffect(() => {
    const element = input.current
    if (element === null) return
    element.focus()
    // Select the stem, not the extension - renaming almost never means
    // renaming '.md', and having to skip past it every time is friction.
    const dot = name.lastIndexOf('.')
    element.setSelectionRange(0, dot > 0 ? dot : name.length)
  }, [name])

  const trimmed = value.trim()
  const submit = (): void => {
    if (trimmed === '') return
    onCommit(trimmed)
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
        aria-label={`Rename ${name}`}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') onCancel()
        }}
      >
        <header className="dialog__head">
          <h2 className="dialog__title">Rename</h2>
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
            aria-label="New name"
            onChange={(event) => setValue(event.target.value)}
          />
          <button className="dialog__submit" type="submit" disabled={trimmed === ''}>
            Rename
          </button>
        </form>
      </div>
    </div>,
    document.body,
  )
}
