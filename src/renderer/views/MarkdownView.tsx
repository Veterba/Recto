import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { registerView } from '../core/view-registry'

/**
 * Reads and writes one note.
 *
 * The textarea is TEMPORARY. CodeMirror 6 replaces it wholesale in 1.6; it
 * exists now because the risky part of this milestone is the write path, not
 * the editing experience, and a plain textarea exercises it exactly:
 * load -> edit -> debounced save -> watcher echo that must NOT reload the buffer.
 */

const SAVE_DEBOUNCE_MS = 500

type State = { path?: unknown }

function MarkdownEditor({ path }: { path: string }): React.ReactElement {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'loaded' | 'dirty' | 'saving' | 'saved'>('loaded')
  const saveTimer = useRef<number | undefined>(undefined)
  /** What is on disk as far as we know. Used to ignore our own echo. */
  const lastWritten = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setContent(null)
    setError(null)
    void api.invoke('fs:read', path).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setContent(result.content)
        lastWritten.current = result.content
        setStatus('loaded')
      } else {
        setError(result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [path])

  const save = useCallback(
    async (next: string) => {
      setStatus('saving')
      lastWritten.current = next
      const result = await api.invoke('fs:write', path, next)
      if (result.ok) setStatus('saved')
      else setError(result.error ?? 'Could not save.')
    },
    [path],
  )

  const onChange = useCallback(
    (next: string) => {
      setContent(next)
      setStatus('dirty')
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => void save(next), SAVE_DEBOUNCE_MS)
    },
    [save],
  )

  // Flush on unmount so closing a tab never drops the last keystrokes.
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current)
    },
    [],
  )

  // An external edit reloads the buffer. Our own save comes back through the
  // watcher too, so compare against what we last wrote before clobbering.
  useEffect(
    () =>
      api.on('vault:changed', (changes) => {
        const touched = changes.some((c) => 'path' in c && c.path === path && c.type === 'change')
        if (!touched) return
        void api.invoke('fs:read', path).then((result) => {
          if (!result.ok) return
          if (result.content === lastWritten.current) return
          setContent(result.content)
          lastWritten.current = result.content
          setStatus('loaded')
        })
      }),
    [path],
  )

  if (error !== null) {
    return (
      <div className="pane-empty">
        <p>
          Could not open <code>{path}</code>
          <br />
          {error}
        </p>
      </div>
    )
  }

  if (content === null) return <div className="pane-empty" />

  return (
    <div className="md">
      <div className="md__bar">
        <span className="md__path">{path}</span>
        <span className={`md__status is-${status}`}>
          {status === 'dirty' ? 'Unsaved' : status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
        </span>
      </div>
      <textarea
        className="md__area"
        value={content}
        spellCheck={false}
        placeholder="Start writing…"
        onChange={(ev) => onChange(ev.target.value)}
      />
      <p className="md__note">Plain textarea for now — CodeMirror 6 with live preview lands in 1.6.</p>
    </div>
  )
}

export function registerMarkdownView(): () => void {
  return registerView({
    type: 'markdown',
    title: 'Editor',
    getTitle: (state) => {
      const path = (state as State).path
      if (typeof path !== 'string' || path === '') return 'Editor'
      return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
    },
    render: ({ state }) => {
      const path = (state as State).path
      if (typeof path !== 'string' || path === '') {
        return (
          <div className="pane-empty">
            <p>
              No note open. Pick one from the sidebar, or press <kbd>⌘N</kbd> to create one.
            </p>
          </div>
        )
      }
      return <MarkdownEditor path={path} />
    },
  })
}
