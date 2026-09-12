import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Backlinks } from '../components/Backlinks'
import { extractTargets } from '../core/link-targets'
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

function MarkdownEditor({
  path,
  onOpenLink,
  onOpenPath,
}: {
  path: string
  onOpenLink: (t: string) => void
  onOpenPath: (p: string) => void
}): React.ReactElement {
  const [initial, setInitial] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'loaded' | 'dirty' | 'saving' | 'saved'>('loaded')
  const saveTimer = useRef<number | undefined>(undefined)
  const handle = useRef<EditorHandle | null>(null)
  /** Bumped after each save, so the backlinks list refreshes. */
  const [savedAt, setSavedAt] = useState(0)
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
      if (result.ok) {
        setStatus('saved')
        setSavedAt(Date.now())
      } else setError(result.error ?? 'Could not save.')
    },
    [path],
  )

  /**
   * Ask the index which of this note's links point at nothing, and tell the
   * editor so they render as broken.
   *
   * Debounced and batched: one round trip for the whole document rather than
   * one per link, and not on every keystroke.
   */
  const refreshUnresolved = useCallback((text: string) => {
    const targets = extractTargets(text)
    if (targets.length === 0) {
      handle.current?.setUnresolved([])
      return
    }
    void api.invoke('index:resolve-links', targets).then((resolved) => {
      handle.current?.setUnresolved(targets.filter((target) => resolved[target] == null))
    })
  }, [])

  const onChange = useCallback(
    (next: string) => {
      setStatus('dirty')
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        void save(next)
        refreshUnresolved(next)
      }, SAVE_DEBOUNCE_MS)
    },
    [save, refreshUnresolved],
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
          refreshUnresolved(initial)
        }}
      />
      <Backlinks path={path} revision={savedAt} onOpen={onOpenPath} />
    </div>
  )
}

export function registerMarkdownView(
  onOpenLink: (target: string) => void,
  onOpenPath: (path: string) => void,
): () => void {
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
      return <MarkdownEditor path={path} onOpenLink={onOpenLink} onOpenPath={onOpenPath} />
    },
  })
}
