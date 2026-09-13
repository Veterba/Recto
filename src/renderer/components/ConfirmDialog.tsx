import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

/**
 * "Are you sure?", for the two or three things in the app that deserve it.
 *
 * Deliberately not a general habit: a confirmation on every action is a
 * confirmation nobody reads. It exists where the click is one pixel from
 * something else and the undo is a trip through another screen - deleting a
 * note, a folder, or a board.
 *
 * Enter confirms and Escape cancels, and the confirming button holds focus, so
 * the fast path stays fast for anyone who meant it.
 */

type Props = {
  title: string
  /** What exactly is about to happen, in a sentence. */
  body: React.ReactNode
  /** The verb on the button, e.g. "Move to archive". */
  confirmLabel: string
  /** Paints the button as destructive. */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = true,
  onConfirm,
  onCancel,
}: Props): React.ReactElement {
  const confirm = useRef<HTMLButtonElement | null>(null)
  useEffect(() => confirm.current?.focus(), [])

  return createPortal(
    <div
      className="dialog__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') onCancel()
          if (event.key === 'Enter') onConfirm()
        }}
      >
        <header className="dialog__head">
          <h2 className="dialog__title">{title}</h2>
          <button className="dialog__close" onClick={onCancel} aria-label="Cancel">
            <Icon name="x" size={16} />
          </button>
        </header>

        <p className="dialog__lede">{body}</p>

        <footer className="dialog__actions">
          <button className="dialog__ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirm}
            className={`dialog__submit${danger ? ' dialog__submit--danger' : ''}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
