import { useCallback, useEffect, useRef, useState } from 'react'
import { extensionOf, type TextFileResult } from '@shared/file-kind'
import { IPC, IPC_EVENT } from '@shared/ipc'
import { api } from '../../../app/api'
import { createCodeEditor, type CodeHandle } from '../code-editor'
import { BinaryCard, sizeLabel } from './FileView'

/**
 * A vault file that is not a note, in the code editor.
 *
 * Saved like a note - debounced, flushed on close, reloaded when another app
 * changes it - but nothing else a note has: no properties, backlinks, topics
 * or toolbar, and the index and the bots never see it (they only read `.md`).
 * A file whose bytes turn out not to be text gets the binary card instead, so
 * no file is a dead end.
 */

const SAVE_DEBOUNCE_MS = 500

/** The code editor with focus, for ⌘F and ⌘S. Null when focus is anywhere else. */
let activeCode: CodeHandle | null = null
export const getActiveCodeEditor = (): CodeHandle | null =>
  activeCode !== null && document.activeElement?.closest('.code-view') != null ? activeCode : null

export function CodeView({ path }: { path: string }): React.ReactElement {
  const [file, setFile] = useState<TextFileResult | null>(null)
  const [status, setStatus] = useState<'loaded' | 'dirty' | 'saving' | 'saved'>('loaded')
  const [formatError, setFormatError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const host = useRef<HTMLDivElement | null>(null)
  const handle = useRef<CodeHandle | null>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  /** What we last wrote, so our own watcher echo is not mistaken for an edit. */
  const lastWritten = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setFile(null)
    void api.invoke(IPC.fsReadText, path).then((result) => {
      if (cancelled) return
      if (result.ok) lastWritten.current = result.content
      setFile(result)
    })
    return () => {
      cancelled = true
    }
  }, [path])

  const save = useCallback(
    async (next: string) => {
      setStatus('saving')
      lastWritten.current = next
      const result = await api.invoke(IPC.fsWrite, path, next)
      if (result.ok) {
        setStatus('saved')
        setSaveError(null)
      } else setSaveError(result.error ?? 'Could not save.')
    },
    [path],
  )

  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    const value = handle.current?.getValue()
    if (value !== undefined && value !== lastWritten.current) void save(value)
  }, [save])

  const ready = file?.ok === true
  const readOnly = file?.ok === true && file.readOnly
  useEffect(() => {
    if (!ready || host.current === null || file === null || !file.ok) return
    const editor = createCodeEditor(host.current, {
      doc: file.content,
      path,
      readOnly: file.readOnly,
      onChange: (next) => {
        setStatus('dirty')
        setFormatError(null)
        window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(() => void save(next), SAVE_DEBOUNCE_MS)
      },
      onFocus: () => {
        activeCode = editor
      },
    })
    handle.current = editor
    return () => {
      // Closing the tab never drops the last keystrokes.
      flush()
      if (activeCode === editor) activeCode = null
      handle.current = null
      editor.destroy()
    }
    // The editor is built once per loaded file; later state lives inside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, path])

  // Another app changed the file: take its text, unless it is our own echo.
  useEffect(
    () =>
      api.on(IPC_EVENT.vaultChanged, (changes) => {
        if (!changes.some((c) => 'path' in c && c.path === path && c.type === 'change')) return
        void api.invoke(IPC.fsReadText, path).then((result) => {
          if (!result.ok || result.content === lastWritten.current) return
          lastWritten.current = result.content
          handle.current?.setValue(result.content)
          setStatus('loaded')
        })
      }),
    [path],
  )

  if (file === null) return <div className="pane-empty" />
  if (!file.ok) return <BinaryCard path={path} reason={file.error} size={file.size} />

  const isJson = extensionOf(path) === 'json'
  return (
    <div className="code-view">
      <div className="md__bar">
        <span className="md__path">{path}</span>
        {readOnly && (
          <span className="code-view__notice" role="status">
            Read-only · {sizeLabel(file.size)} is too large to edit here
          </span>
        )}
        {isJson && !readOnly && (
          <button
            className="btn btn--ghost btn--sm code-view__format"
            onClick={() => {
              setFormatError(handle.current?.formatJson() ?? null)
              handle.current?.focus()
            }}
            title="Pretty-print the JSON (one undo step)"
          >
            Format
          </button>
        )}
        {formatError !== null && <span className="code-view__error">Not formatted: {formatError}</span>}
        {saveError !== null && <span className="code-view__error">{saveError}</span>}
        <span className={`md__status is-${status}`}>
          {status === 'dirty' ? 'Unsaved' : status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
        </span>
      </div>
      <div className="code-view__host" ref={host} />
    </div>
  )
}
