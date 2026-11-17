import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Proposal } from '@shared/ai-access'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'
import { Icon } from '../../../ui/Icon'
import { BoardView } from '../../boards/components/BoardView'
import { CanvasView, type CanvasShell } from '../../canvas/components/CanvasView'
import { Editor } from '../../editor/components/Editor'
import { headingOf, previewOf, previewTarget } from '../suggestion-model'

/**
 * A suggestion seen before it is accepted, as the screen will look: a canvas
 * as the canvas, a board as the board, a note as the note - the same views
 * Recto draws them in, given the file as it would be once the waiting
 * changes are accepted (worked out from the file as it is now, as Accept will
 * do it) and never writing it. A note's added and changed lines are marked.
 * Looked at, not worked in: clicks, menus and keys go nowhere; the wheel
 * zooms a canvas and scrolls a board or a note. Accept all or Reject all from
 * here, or close it.
 */

/** A canvas in a preview opens nothing and offers nothing: the shell it would use, with nothing behind it. */
const STILL_SHELL: CanvasShell = { openFile: () => {}, openLink: () => {}, folders: () => [], roots: () => [], hideSidebar: () => {} }

/** Everything but looking: kept from the view under it. A canvas's empty plane may still be dragged, to look around. */
function still(ev: React.SyntheticEvent): void {
  const target = ev.target as HTMLElement
  if ((ev.type === 'pointerdown' || ev.type === 'mousedown') && target.classList.contains('react-flow__pane')) return
  ev.preventDefault()
  ev.stopPropagation()
}

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
  const target = previewTarget(proposal)
  const heading = headingOf(proposal)
  /** The file as it is now: undefined while it is read, null when it is not there (new). */
  const [current, setCurrent] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const isNew = target?.file?.before === null

  useEffect(() => {
    if (target === null) return
    let live = true
    if (isNew) setCurrent(null)
    else
      void api.invoke(IPC.fsRead, target.path).then((read) => {
        if (!live) return
        if (read.ok) setCurrent(read.content)
        else setError(`${target.path} could not be read: ${read.error}`)
      })
    return () => {
      live = false
    }
  }, [target?.path, isNew])

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
  // What is new or moved on a canvas or a board, outlined - and the first of it brought into sight once drawn.
  const body = useRef<HTMLDivElement | null>(null)
  const marks = (preview?.markedNodes ?? []).map((m) =>
    preview!.target.view === 'canvas' ? `.react-flow__node[data-id="${CSS.escape(m)}"]` : `.board-card[aria-label="${CSS.escape(m)}"]`,
  )
  const markKey = marks.join(',')
  useEffect(() => {
    if (markKey === '') return
    const timer = setTimeout(() => body.current?.querySelector(markKey)?.scrollIntoView({ block: 'center', inline: 'center' }), 400)
    return () => clearTimeout(timer)
  }, [markKey])

  return createPortal(
    <div className="suggestion-preview__scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`suggestion-preview glass-surface is-${target?.view ?? 'note'}`} role="dialog" aria-label="Preview of the suggestion">
        <header className="suggestion-preview__head">
          <Icon name={heading.icon} size={15} />
          <h2 className="suggestion-preview__title">
            {heading.verb} <strong>{heading.name}</strong>
          </h2>
          <span className="suggestion-preview__notes">{preview?.notes.join(' · ')}</span>
          {/* Focus here: Escape is the preview's, not the Suggested edits panel's under it. */}
          <button className="dialog__close" onClick={onClose} aria-label="Close preview" autoFocus>
            <Icon name="x" size={16} />
          </button>
        </header>
        {markKey !== '' && (
          <style>{`.suggestion-preview__body :is(${markKey}) { outline: 2px solid var(--success); outline-offset: 3px; border-radius: 10px; }`}</style>
        )}
        <div
          ref={body}
          className="suggestion-preview__body"
          onPointerDownCapture={still}
          onMouseDownCapture={still}
          onClickCapture={still}
          onDoubleClickCapture={still}
          onContextMenuCapture={still}
          onKeyDownCapture={still}
          onDragStartCapture={still}
          onPasteCapture={still}
        >
          {error !== null ? (
            <p className="suggestion__error">{error}</p>
          ) : preview === null ? (
            <div className="note-reader__loading" />
          ) : preview.target.view === 'canvas' ? (
            <CanvasView path={preview.target.path} leafId={`preview:${proposal.id}`} shell={STILL_SHELL} preview={preview.text} />
          ) : preview.target.view === 'board' ? (
            <BoardView path={preview.target.path} preview={preview.text} onOpenNote={() => {}} onShowMarkdown={() => {}} />
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
