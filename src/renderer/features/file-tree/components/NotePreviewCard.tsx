import { UTILITY_MODEL } from '@shared/ai'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../../app/api'
import { edited, readingTime, summariseNote, type NotePreview } from '../note-preview'
import { Icon } from '../../../ui/Icon'
import { IPC, IPC_EVENT } from '@shared/ipc'

/**
 * A note's gist, shown when the pointer rests on it - in the sidebar, or on a
 * link in a note.
 *
 * Read-only and fixed in place: it is a glance, not a window. A click on it
 * (anywhere but its buttons) pins the note as a floating window, which is the
 * window. The card itself is deliberately not draggable - a preview that
 * half-behaves like a window invites exactly the drag it cannot finish.
 *
 * The summary is compiled locally (see `note-preview.ts`). Claude is one button
 * away when a key is saved, and only when pressed: a hover is not consent to
 * send a note anywhere, and it is not a reason to spend money.
 */

type Props = {
  path: string
  /** The hovered row's rectangle, in viewport coordinates. */
  anchor: { top: number; right: number; bottom: number }
  mtime: number | undefined
  onOpen: (path: string) => void
  /** Pin the note as a floating window, where the card is now. */
  onPin?: (path: string, rect: DOMRect) => void
  onPointerEnter: () => void
  onPointerLeave: () => void
}

const WIDTH = 340
const GAP = 10
/** Enough for a gist, and a bound on what one click sends to the API. */
const SUMMARY_INPUT_CHARS = 24_000

export function NotePreviewCard({ path, anchor, mtime, onOpen, onPin, onPointerEnter, onPointerLeave }: Props): React.ReactElement {
  const card = useRef<HTMLDivElement | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [preview, setPreview] = useState<NotePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [backlinks, setBacklinks] = useState<number | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [summary, setSummary] = useState<{ text: string; state: 'streaming' | 'done' | 'error' } | null>(null)
  const [position, setPosition] = useState({ left: anchor.right + GAP, top: anchor.top - 6 })
  const streamId = `preview:${path}`

  useEffect(() => {
    let cancelled = false
    setText(null)
    setPreview(null)
    setError(null)
    setBacklinks(null)
    setSummary(null)
    const name = path.slice(path.lastIndexOf('/') + 1)
    void api.invoke(IPC.fsRead, path).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setError(result.error)
        return
      }
      setText(result.content)
      setPreview(summariseNote(result.content, name))
    })
    void api.invoke(IPC.indexBacklinks, path).then((links) => {
      if (!cancelled) setBacklinks(new Set(links.map((link) => link.path)).size)
    })
    void api.invoke(IPC.aiKeyStatus).then((status) => {
      if (!cancelled) setHasKey(status.present)
    })
    return () => {
      cancelled = true
    }
  }, [path])

  // A summary still streaming when the card closes is stopped, not left to
  // finish into nothing - that would be paying for words nobody sees.
  useEffect(() => {
    const offDelta = api.on(IPC_EVENT.aiDelta, (delta) => {
      if (delta.id === streamId) setSummary((s) => ({ text: (s?.text ?? '') + delta.text, state: 'streaming' }))
    })
    const offDone = api.on(IPC_EVENT.aiDone, (done) => {
      if (done.id === streamId) setSummary((s) => ({ text: s?.text ?? '', state: 'done' }))
    })
    const offError = api.on(IPC_EVENT.aiError, (failure) => {
      if (failure.id === streamId) setSummary({ text: failure.message, state: 'error' })
    })
    return () => {
      offDelta()
      offDone()
      offError()
      void api.invoke(IPC.aiCancel, streamId)
    }
  }, [streamId])

  // Beside the row, and kept on screen: flipped up if it would run off the
  // bottom, nudged left if the window is narrow.
  useLayoutEffect(() => {
    const element = card.current
    if (element === null) return
    const height = element.offsetHeight
    const top = Math.max(8, Math.min(anchor.top - 6, window.innerHeight - height - 8))
    const left = Math.max(8, Math.min(anchor.right + GAP, window.innerWidth - WIDTH - 8))
    setPosition({ left, top })
  }, [anchor, preview, summary])

  const summarise = (): void => {
    if (text === null) return
    setSummary({ text: '', state: 'streaming' })
    void api
      .invoke(IPC.aiSend, {
        id: streamId,
        model: UTILITY_MODEL,
        system:
          "Summarise the user's note in two or three plain sentences: what it is about and what matters in it. " +
          'No preamble, no bullet points, no markdown.',
        messages: [{ role: 'user', content: text.slice(0, SUMMARY_INPUT_CHARS) }],
      })
      .then((started) => {
        if (!started.ok) setSummary({ text: started.error ?? 'Could not start.', state: 'error' })
      })
  }

  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

  return createPortal(
    <div
      className={`note-peek${onPin !== undefined ? ' is-pinnable' : ''}`}
      ref={card}
      role="dialog"
      aria-label="Note preview"
      title={onPin !== undefined ? 'Click to pin as a window' : undefined}
      onClick={(event) => {
        if (onPin === undefined || card.current === null) return
        if ((event.target as HTMLElement).closest('button, a, input, textarea') !== null) return
        onPin(path, card.current.getBoundingClientRect())
      }}
      style={{ left: position.left, top: position.top, width: WIDTH }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onContextMenu={(event) => event.preventDefault()}
      // Not draggable: moving notes into the workspace is its own feature.
      onDragStart={(event) => event.preventDefault()}
    >
      {error !== null ? (
        <p className="note-peek__error">{error}</p>
      ) : preview === null ? (
        <div className="note-peek__loading" aria-live="polite">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <>
          <header className="note-peek__head">
            <button className="note-peek__title" onClick={() => onOpen(path)} title="Open note">
              {preview.title}
            </button>
            {folder !== '' && <span className="note-peek__folder">{folder}</span>}
            <div className="note-peek__meta">
              {mtime !== undefined && <span>{edited(mtime)}</span>}
              <span>{readingTime(preview.words)}</span>
              {backlinks !== null && backlinks > 0 && (
                <span>
                  {backlinks} {backlinks === 1 ? 'backlink' : 'backlinks'}
                </span>
              )}
            </div>
          </header>

          {preview.tags.length > 0 && (
            <div className="note-peek__tags">
              {preview.tags.slice(0, 8).map((tag) => (
                <span className="note-peek__tag" key={tag}>
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {summary !== null ? (
            <p className={`note-peek__summary${summary.state === 'error' ? ' is-error' : ''}`}>
              <Icon name="sparkles" size={12} />
              <span>
                {summary.text}
                {summary.state === 'streaming' && <i className="note-peek__caret" />}
              </span>
            </p>
          ) : preview.excerpt !== '' ? (
            <p className="note-peek__excerpt">{preview.excerpt}</p>
          ) : (
            <p className="note-peek__excerpt is-empty">No text yet.</p>
          )}

          {preview.properties.length > 0 && (
            <dl className="note-peek__props">
              {preview.properties.map((prop) => (
                <div key={prop.key}>
                  <dt>{prop.key}</dt>
                  <dd>{prop.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {preview.outline.length > 0 && (
            <ul className="note-peek__outline">
              {preview.outline.map((heading, index) => (
                <li key={index} className={heading.level === 3 ? 'is-sub' : ''}>
                  {heading.text}
                </li>
              ))}
            </ul>
          )}

          {preview.tasks.total > 0 && (
            <div className="note-peek__tasks">
              <div className="note-peek__bar">
                <span style={{ width: `${(preview.tasks.done / preview.tasks.total) * 100}%` }} />
              </div>
              <span>
                {preview.tasks.done}/{preview.tasks.total} done
              </span>
            </div>
          )}

          {hasKey && preview.words > 0 && (summary === null || summary.state === 'error') && (
            <footer className="note-peek__foot">
              <button className="note-peek__ai" onClick={summarise}>
                <Icon name="sparkles" size={12} />
                Summarize with Claude
              </button>
            </footer>
          )}
        </>
      )}
    </div>,
    document.body,
  )
}
