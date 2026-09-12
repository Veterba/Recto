import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Editor } from '../editor/Editor'
import type { EditorHandle } from '../editor/codemirror'
import { registerView } from '../core/view-registry'

/**
 * One note, in CodeMirror.
 *
 * The buffer IS the file: no conversion on open, none on save, so whatever the
 * file contains is what you see and what gets written back. That losslessness
 * is the entire reason for choosing CodeMirror over a rich-text model.
 */

const SAVE_DEBOUNCE_MS = 500

type State = { path?: unknown }

/** The live editor handle, so app commands can reach the focused editor. */
let activeHandle: EditorHandle | null = null
export const getActiveEditor = (): EditorHandle | null => activeHandle

function MarkdownEditor({ path, onOpenLink }: { path: string; onOpenLink: (t: string) => void }): React.ReactElement {
  const [initial, setInitial] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'loaded' | 'dirty' | 'saving' | 'saved'>('loaded')
  const saveTimer = useRef<number | undefined>(undefined)
  const handle = useRef<EditorHandle | null>(null)
  /** What we last wrote, so our own watcher echo is not mistaken for an edit. */
  const lastWritten = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setInitial(null)
    setError(null)
    void api.invoke('fs:read', path).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setInitial(result.content)
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
      setStatus('dirty')
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => void save(next), SAVE_DEBOUNCE_MS)
    },
    [save],
  )

  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    const value = handle.current?.getValue()
    if (value !== undefined && value !== lastWritten.current) void save(value)
  }, [save])

  // Flush on unmount so closing a tab never drops the last keystrokes.
  useEffect(() => () => flush(), [flush])

  // An external edit reloads the buffer; our own save comes back through the
  // watcher too, so compare against what we last wrote before replacing it.
  useEffect(
    () =>
      api.on('vault:changed', (changes) => {
        const touched = changes.some((c) => 'path' in c && c.path === path && c.type === 'change')
        if (!touched) return
        void api.invoke('fs:read', path).then((result) => {
          if (!result.ok || result.content === lastWritten.current) return
          lastWritten.current = result.content
          handle.current?.setValue(result.content)
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

  if (initial === null) return <div className="pane-empty" />

  return (
    <div className="md">
      <div className="md__bar">
        <span className="md__path">{path}</span>
        <span className={`md__status is-${status}`}>
          {status === 'dirty' ? 'Unsaved' : status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
        </span>
      </div>
      <Editor
        docKey={path}
        initialValue={initial}
        onChange={onChange}
        onSave={flush}
        onOpenLink={onOpenLink}
        onReady={(editor: EditorHandle) => {
          handle.current = editor
          activeHandle = editor
        }}
      />
    </div>
  )
}

export function registerMarkdownView(onOpenLink: (target: string) => void): () => void {
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
      return <MarkdownEditor path={path} onOpenLink={onOpenLink} />
    },
  })
}
