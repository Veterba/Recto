import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Proposal } from '@shared/ai-access'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'
import { Icon } from '../../../ui/Icon'
import { Editor } from '../../editor/components/Editor'
import { headingOf, previewFile, previewOf } from '../suggestion-model'

/**
 * A suggestion seen before it is accepted: the note as it will read with its
 * waiting changes - the same editor as a note window, read-only and rendered,
 * the lines added or changed marked - worked out from the note as it is now,
 * as Accept will do it. Accept all or Reject all from here, or close it.
 */
export function SuggestionPreview({
  proposal,
  onAccept,
  onReject,
  onClose,
}: {
  proposal: Proposal
  onAccept: () => void
  onReject: () => void
  onClose: () => void
}): React.ReactElement {
  const file = previewFile(proposal)
  const heading = headingOf(proposal)
  /** The note as it is now: undefined while it is read, null when it is not there (a new note). */
  const [current, setCurrent] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (file === null) return
    let live = true
    if (file.before === null) setCurrent(null)
    else
      void api.invoke(IPC.fsRead, file.path).then((read) => {
        if (!live) return
        if (read.ok) setCurrent(read.content)
        else setError(`${file.path} could not be read: ${read.error}`)
      })
    return () => {
      live = false
    }
  }, [file?.path, file?.before])

  useEffect(() => {
    const escape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [onClose])

  const preview = current === undefined ? null : previewOf(proposal, current)
  const notes =
    preview === null
      ? []
      : [
          `${preview.marked.length} ${preview.marked.length === 1 ? 'line' : 'lines'} added or changed, marked`,
          ...(preview.removed > 0 ? [`${preview.removed} ${preview.removed === 1 ? 'line' : 'lines'} removed`] : []),
          ...(preview.stale > 0
            ? [`${preview.stale} ${preview.stale === 1 ? 'change no longer fits' : 'changes no longer fit'} the note and is left out`]
            : []),
        ]

  return createPortal(
    <div className="suggestion-preview__scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="suggestion-preview glass-surface" role="dialog" aria-label="Preview of the suggestion">
        <header className="suggestion-preview__head">
          <Icon name={heading.icon} size={15} />
          <h2 className="suggestion-preview__title">
            {heading.verb} <strong>{heading.name}</strong>
          </h2>
          <span className="suggestion-preview__notes">{notes.join(' · ')}</span>
          {/* Focus here: Escape is the preview's, not the Suggested edits panel's under it. */}
          <button className="dialog__close" onClick={onClose} aria-label="Close preview" autoFocus>
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="suggestion-preview__body">
          {error !== null ? (
            <p className="suggestion__error">{error}</p>
          ) : preview === null ? (
            <div className="note-reader__loading" />
          ) : (
            <div className="note-reader">
              <Editor
                docKey={`preview:${proposal.id}`}
                initialValue={preview.text}
                readOnly
                markedLines={preview.marked}
                onChange={() => {}}
                onSave={() => {}}
                onOpenLink={() => {}}
                // Laid out as the note window lays a note out: rendered, every line.
                onReady={(editor) => editor.setLivePreview(true)}
              />
            </div>
          )}
        </div>
        <footer className="suggestion-preview__foot">
          <span className="suggestion__spacer" />
          <button className="btn btn--ghost btn--sm" onClick={onClose}>
            Close
          </button>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => {
              onReject()
              onClose()
            }}
          >
            Reject all
          </button>
          <button
            className="btn btn--primary btn--sm"
            disabled={preview === null}
            onClick={() => {
              onAccept()
              onClose()
            }}
          >
            Accept all
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
