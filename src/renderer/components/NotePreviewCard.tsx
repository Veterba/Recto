import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { edited, readingTime, summariseNote, type NotePreview } from '../core/note-preview'
import { Icon } from './Icon'

/**
 * A note's gist, shown when the pointer rests on it in the sidebar.
 *
 * Read-only and fixed in place: it is a glance, not a window. It is
 * deliberately not draggable - pulling a note out into the workspace is a
 * separate feature, and a preview that half-behaves like a window invites
 * exactly the drag it cannot finish.
 *
 * The summary is compiled locally (see core/note-preview). Claude is one button
 * away when a key is saved, and only when pressed: a hover is not consent to
 * send a note anywhere, and it is not a reason to spend money.
 */

type Props = {
  path: string
  /** The hovered row's rectangle, in viewport coordinates. */
  anchor: { top: number; right: number; bottom: number }
  mtime: number | undefined
  model: string
  onOpen: (path: string) => void
  onPointerEnter: () => void
  onPointerLeave: () => void
}

const WIDTH = 340
const GAP = 10
/** Enough for a gist, and a bound on what one click sends to the API. */
const SUMMARY_INPUT_CHARS = 24_000

export function NotePreviewCard({
  path,
  anchor,
  mtime,
  model,
  onOpen,
  onPointerEnter,
  onPointerLeave,
}: Props): React.ReactElement {
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
    void api.invoke('fs:read', path).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setError(result.error)
        return
      }
      setText(result.content)
      setPreview(summariseNote(result.content, name))
    })
    void api.invoke('index:backlinks', path).then((links) => {
      if (!cancelled) setBacklinks(new Set(links.map((link) => link.path)).size)
    })
    void api.invoke('ai:key-status').then((status) => {
      if (!cancelled) setHasKey(status.present)
    })
    return () => {
      cancelled = true
    }
  }, [path])

  // A summary still streaming when the card closes is stopped, not left to
  // finish into nothing - that would be paying for words nobody sees.
  useEffect(() => {
    const offDelta = api.on('ai:delta', (delta) => {
      if (delta.id === streamId) setSummary((s) => ({ text: (s?.text ?? '') + delta.text, state: 'streaming' }))
    })
    const offDone = api.on('ai:done', (done) => {
      if (done.id === streamId) setSummary((s) => ({ text: s?.text ?? '', state: 'done' }))
    })
    const offError = api.on('ai:error', (failure) => {
      if (failure.id === streamId) setSummary({ text: failure.message, state: 'error' })
    })
    return () => {
      offDelta()
      offDone()
      offError()
      void api.invoke('ai:cancel', streamId)
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
      .invoke('ai:send', {
        id: streamId,
        model,
        system:
          'Summarise the user\'s note in two or three plain sentences: what it is about and what matters in it. ' +
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
      className="peek"
      ref={card}
      role="dialog"
      aria-label="Note preview"
      style={{ left: position.left, top: position.top, width: WIDTH }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onContextMenu={(event) => event.preventDefault()}
      // Not draggable: moving notes into the workspace is its own feature.
      onDragStart={(event) => event.preventDefault()}
    >
      {error !== null ? (
        <p className="peek__error">{error}</p>
      ) : preview === null ? (
        <div className="peek__loading" aria-live="polite">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <>
          <header className="peek__head">
            <button className="peek__title" onClick={() => onOpen(path)} title="Open note">
              {preview.title}
            </button>
            {folder !== '' && <span className="peek__folder">{folder}</span>}
            <div className="peek__meta">
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
            <div className="peek__tags">
              {preview.tags.slice(0, 8).map((tag) => (
                <span className="peek__tag" key={tag}>
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {summary !== null ? (
            <p className={`peek__summary${summary.state === 'error' ? ' is-error' : ''}`}>
              <Icon name="sparkles" size={12} />
              <span>
                {summary.text}
                {summary.state === 'streaming' && <i className="peek__caret" />}
              </span>
            </p>
          ) : preview.excerpt !== '' ? (
            <p className="peek__excerpt">{preview.excerpt}</p>
          ) : (
            <p className="peek__excerpt is-empty">No text yet.</p>
          )}

          {preview.properties.length > 0 && (
            <dl className="peek__props">
              {preview.properties.map((prop) => (
                <div key={prop.key}>
                  <dt>{prop.key}</dt>
                  <dd>{prop.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {preview.outline.length > 0 && (
            <ul className="peek__outline">
              {preview.outline.map((heading, index) => (
                <li key={index} className={heading.level === 3 ? 'is-sub' : ''}>
                  {heading.text}
                </li>
              ))}
            </ul>
          )}

          {preview.tasks.total > 0 && (
            <div className="peek__tasks">
              <div className="peek__bar">
                <span style={{ width: `${(preview.tasks.done / preview.tasks.total) * 100}%` }} />
              </div>
              <span>
                {preview.tasks.done}/{preview.tasks.total} done
              </span>
            </div>
          )}

          {hasKey && preview.words > 0 && (summary === null || summary.state === 'error') && (
            <footer className="peek__foot">
              <button className="peek__ai" onClick={summarise}>
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
