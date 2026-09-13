import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Backlinks } from '../components/Backlinks'
import { FormatBar } from '../components/FormatBar'
import { Properties } from '../components/Properties'
import { commands } from '../core/commands'
import { formatChord } from '../core/hotkeys'
import { extractTargets } from '../core/link-targets'
import { Editor } from '../editor/Editor'
import type { EditorHandle } from '../editor/codemirror'
import type { LinkCandidate } from '../editor/link-complete'
import type { Format } from '../editor/markdown-actions'
import { noteIndexChanged } from '../core/note-bus'
import { registerView } from '../core/view-registry'

/**
 * One note, in CodeMirror.
 *
 * The buffer IS the file: no conversion on open, none on save, so whatever the
 * file contains is what you see and what gets written back. That losslessness
 * is the entire reason for choosing CodeMirror over a rich-text model.
 */

const SAVE_DEBOUNCE_MS = 500

type State = { path?: unknown; heading?: unknown }

/** The live editor handle, so app commands can reach the focused editor. */
let activeHandle: EditorHandle | null = null
export const getActiveEditor = (): EditorHandle | null => activeHandle

function MarkdownEditor({
  path,
  heading,
  onOpenLink,
  onOpenPath,
  getLinkCandidates,
  livePreview,
  vim,
}: {
  path: string
  /** A `#heading` from the link that opened this note, to scroll to. */
  heading: string | null
  onOpenLink: (t: string, h: string | null) => void
  onOpenPath: (p: string, h?: string | null) => void
  getLinkCandidates: () => readonly LinkCandidate[]
  livePreview: boolean
  vim: boolean
}): React.ReactElement {
  const [initial, setInitial] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'loaded' | 'dirty' | 'saving' | 'saved'>('loaded')
  const saveTimer = useRef<number | undefined>(undefined)
  const handle = useRef<EditorHandle | null>(null)
  /** Bumped after each save, so the backlinks list refreshes. */
  const [savedAt, setSavedAt] = useState(0)
  const [active, setActive] = useState<ReadonlySet<Format>>(new Set())
  /** Live document text, so the Properties panel reflects unsaved edits. */
  const [text, setText] = useState('')
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
        setText(result.content)
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
        // A save can have added or removed a `[[link]]`, which is a change to
        // the graph. Self-writes are suppressed in the watcher, so nothing else
        // would ever tell it.
        noteIndexChanged()
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
      setText(next)
      setStatus('dirty')
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        void save(next)
        refreshUnresolved(next)
      }, SAVE_DEBOUNCE_MS)
    },
    [save, refreshUnresolved],
  )

  const syncFormats = useCallback(() => {
    setActive(handle.current?.getActiveFormats() ?? new Set())
  }, [])

  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    const value = handle.current?.getValue()
    if (value !== undefined && value !== lastWritten.current) void save(value)
  }, [save])

  // Flush on unmount so closing a tab never drops the last keystrokes.
  useEffect(() => () => flush(), [flush])

  // Mode changes are pushed into the live editor rather than remounting it, so
  // toggling Live Preview keeps your cursor, scroll and undo history.
  useEffect(() => {
    handle.current?.setLivePreview(livePreview)
  }, [livePreview])

  useEffect(() => {
    handle.current?.setVim(vim)
  }, [vim])

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
          setText(result.content)
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
      <FormatBar
        active={active}
        onRun={(id) => {
          void commands.run(id)
          handle.current?.focus()
        }}
        shortcutFor={(id) => {
          const binding = commands.bindingFor(id)
          return binding === null ? null : formatChord(binding)
        }}
      />
      <Properties
        text={text}
        onChange={(next) => {
          // Written through the editor, not straight to disk: that way the
          // change is one undoable edit and the cursor is preserved.
          handle.current?.setValue(next)
          setText(next)
          onChange(next)
        }}
      />
      <div className="md__bar">
        <span className="md__path">{path}</span>
        <span className="md__mode">{livePreview ? 'Live Preview' : 'Source'}</span>
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
        getLinkCandidates={getLinkCandidates}
        onSelectionChange={syncFormats}
        onReady={(editor: EditorHandle) => {
          handle.current = editor
          activeHandle = editor
          editor.setLivePreview(livePreview)
          editor.setVim(vim)
          setActive(editor.getActiveFormats())
          refreshUnresolved(initial)
          // A link with a #heading opened this note; land on that heading.
          if (heading !== null && heading !== '') editor.revealHeading(heading)
        }}
      />
      <Backlinks path={path} revision={savedAt} onOpen={onOpenPath} />
    </div>
  )
}

export function registerMarkdownView(
  onOpenLink: (target: string, heading: string | null) => void,
  onOpenPath: (path: string, heading?: string | null) => void,
  getLinkCandidates: () => readonly LinkCandidate[],
  getLivePreview: () => boolean,
  getVim: () => boolean,
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
      const livePreview = getLivePreview()
      const vim = getVim()
      const rawHeading = (state as State).heading
      const heading = typeof rawHeading === 'string' && rawHeading !== '' ? rawHeading : null
      if (typeof path !== 'string' || path === '') {
        return (
          <div className="pane-empty">
            <p>
              No note open. Pick one from the sidebar, or press <kbd>⌘N</kbd> to create one.
            </p>
          </div>
        )
      }
      return (
        <MarkdownEditor
          key={path}
          path={path}
          heading={heading}
          onOpenLink={onOpenLink}
          onOpenPath={onOpenPath}
          getLinkCandidates={getLinkCandidates}
          livePreview={livePreview}
          vim={vim}
        />
      )
    },
  })
}
