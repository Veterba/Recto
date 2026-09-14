import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Backlinks } from '../components/Backlinks'
import { FormatBar } from '../components/FormatBar'
import { Icon } from '../components/Icon'
import { Outline } from '../components/Outline'
import { Properties } from '../components/Properties'
import { commands } from '../core/commands'
import { formatChord } from '../core/hotkeys'
import { extractTargets } from '../core/link-targets'
import { readFolds, setOutlineOpen, toggleOutline, useOutlineOpen, writeFolds } from '../core/outline'
import { Editor } from '../editor/Editor'
import type { EditorHandle } from '../editor/codemirror'
import type { LinkCandidate } from '../editor/link-complete'
import type { Format } from '../editor/markdown-actions'
import { noteIndexChanged } from '../core/note-bus'
import { registerView } from '../core/view-registry'
import { vaultFileUrl } from '../core/vault-url'

/**
 * One note, in CodeMirror.
 *
 * The buffer IS the file: no conversion on open, none on save, so whatever the
 * file contains is what you see and what gets written back. That losslessness
 * is the entire reason for choosing CodeMirror over a rich-text model.
 */

const SAVE_DEBOUNCE_MS = 500

type State = { path?: unknown; heading?: unknown }

/**
 * "Updated N links" after a rename, waiting for the renamed note to mount.
 *
 * A rename changes the tab's path, and the editor is keyed on its path, so the
 * component that did the rename is gone a frame later - and its state with it.
 * The notice is handed across the remount by path instead.
 */
const pendingRenameNotice = new Map<string, string>()

/** The live editor handle, so app commands can reach the focused editor. */
let activeHandle: EditorHandle | null = null
export const getActiveEditor = (): EditorHandle | null => activeHandle

/**
 * The note's name, as an editable heading above the text.
 *
 * It IS the file name - not the first `# heading`, and not a `title:`
 * property. The file name is what the sidebar shows, what the graph labels,
 * and what every `[[link]]` points at; a second, separate "title" would be a
 * third name for the same note that could disagree with the other two.
 *
 * So editing it renames the file, through the same path as renaming in the
 * sidebar, which rewrites every link pointing at it. Committed on Enter or
 * when focus leaves - never per keystroke, since each commit is a rename and
 * a vault-wide link rewrite.
 */
function NoteTitle({
  path,
  onRename,
}: {
  path: string
  onRename: (name: string) => Promise<string | null>
}): React.ReactElement {
  const file = path.slice(path.lastIndexOf('/') + 1)
  const dot = file.toLowerCase().endsWith('.md') ? file.length - 3 : file.length
  const current = file.slice(0, dot)
  const [draft, setDraft] = useState(current)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => setDraft(current), [current])

  const commit = async (): Promise<void> => {
    const name = draft.trim()
    if (name === '' || name === current) {
      setDraft(current)
      setError(null)
      return
    }
    // Slashes would make a rename a move into another folder. That is what
    // dragging in the sidebar is for; here it is refused out loud.
    if (/[/\\:]/.test(name)) {
      setError('A name cannot contain / \\ or :')
      return
    }
    setBusy(true)
    const failure = await onRename(name)
    setBusy(false)
    if (failure !== null) {
      setError(failure)
      setDraft(current)
    } else setError(null)
  }

  return (
    <div className="note-title">
      <input
        className={`note-title__input${error !== null ? ' is-invalid' : ''}`}
        value={draft}
        disabled={busy}
        spellCheck={false}
        aria-label="Note name"
        placeholder="Untitled"
        onChange={(event) => {
          setDraft(event.target.value)
          if (error !== null) setError(null)
        }}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setDraft(current)
            setError(null)
            event.currentTarget.blur()
          }
        }}
      />
      {error !== null && <p className="note-title__error">{error}</p>}
    </div>
  )
}

function MarkdownEditor({
  path,
  heading,
  onOpenLink,
  onOpenPath,
  getLinkCandidates,
  livePreview,
  vim,
  showTitle,
  onRenamed,
}: {
  path: string
  /** Show the editable note name above the text. */
  showTitle: boolean
  /** The note now lives at a new path; the tab follows it. */
  onRenamed: (path: string) => void
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

  /** The caret's line, for the outline's "you are here". */
  const [cursorLine, setCursorLine] = useState(1)
  const outlineOpen = useOutlineOpen()

  const syncFormats = useCallback(() => {
    setActive(handle.current?.getActiveFormats() ?? new Set())
    setCursorLine(handle.current?.getCursorLine() ?? 1)
  }, [])

  // Folds are remembered per note. Written when they change, and again on the
  // way out: lines typed above a fold move it, and the editor's own ranges
  // follow the text where the last saved list would not.
  useEffect(
    () => () => {
      const folds = handle.current?.getFolds()
      if (folds !== undefined) writeFolds(path, folds)
    },
    [path],
  )

  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    const value = handle.current?.getValue()
    if (value !== undefined && value !== lastWritten.current) void save(value)
  }, [save])

  // Flush on unmount so closing a tab never drops the last keystrokes.
  useEffect(() => () => flush(), [flush])

  const [renameNotice, setRenameNotice] = useState<string | null>(() => {
    const waiting = pendingRenameNotice.get(path) ?? null
    pendingRenameNotice.delete(path)
    return waiting
  })
  useEffect(() => {
    if (renameNotice === null) return
    const timer = window.setTimeout(() => setRenameNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [renameNotice])

  /** Rename from the title. Returns an error sentence, or null on success. */
  const renameTo = useCallback(
    async (name: string): Promise<string | null> => {
      // Save first, to the path the text belongs to. Renaming with an unsaved
      // buffer would move the old file and then write the new text to a path
      // that no longer exists.
      window.clearTimeout(saveTimer.current)
      const value = handle.current?.getValue()
      if (value !== undefined && value !== lastWritten.current) await save(value)

      const extension = path.toLowerCase().endsWith('.md') ? '.md' : ''
      const result = await api.invoke('fs:rename', path, `${name}${extension}`)
      if (!result.ok) return result.error
      noteIndexChanged()
      if (result.rewrittenLinks > 0) {
        pendingRenameNotice.set(result.path, 
          `Updated ${result.rewrittenLinks} ${result.rewrittenLinks === 1 ? 'link' : 'links'} in ${result.rewrittenFiles} ${
            result.rewrittenFiles === 1 ? 'note' : 'notes'
          }`,
        )
      }
      onRenamed(result.path)
      return null
    },
    [path, save, onRenamed],
  )

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
        onOpenLink={onOpenLink}
        getLinkCandidates={getLinkCandidates}
        onChange={(next) => {
          // Written through the editor, not straight to disk: that way the
          // change is one undoable edit and the cursor is preserved.
          handle.current?.setValue(next)
          setText(next)
          onChange(next)
        }}
      />
      {/* The path bar stays where it always was, top left, whether the name is
          shown or not - the name goes under it, not the other way round. */}
      <div className="md__bar">
        <span className="md__path">{path}</span>
        <span className="md__mode">{livePreview ? 'Live Preview' : 'Source'}</span>
        <button
          className={`icon-btn md__outline-btn${outlineOpen ? ' is-on' : ''}`}
          onClick={toggleOutline}
          aria-pressed={outlineOpen}
          aria-label="Outline"
          title={`Outline (${formatChord('Mod+Shift+O')})`}
        >
          <Icon name="list-tree" size={13} />
        </button>
        <span className={`md__status is-${status}`}>
          {status === 'dirty' ? 'Unsaved' : status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
        </span>
      </div>
      {showTitle && <NoteTitle path={path} onRename={renameTo} />}
      {renameNotice !== null && <p className="note-title__notice">{renameNotice}</p>}
      <Editor
        docKey={path}
        initialValue={initial}
        onChange={onChange}
        onSave={flush}
        onOpenLink={onOpenLink}
        getLinkCandidates={getLinkCandidates}
        onSelectionChange={syncFormats}
        onFoldsChange={(lines) => writeFolds(path, lines)}
        onReady={(editor: EditorHandle) => {
          handle.current = editor
          activeHandle = editor
          editor.setFolds(readFolds(path))
          editor.setLivePreview(livePreview)
          editor.setVim(vim)
          setActive(editor.getActiveFormats())
          refreshUnresolved(initial)
          // A link with a #heading opened this note; land on that heading.
          if (heading !== null && heading !== '') editor.revealHeading(heading)
        }}
      />
      <Backlinks path={path} revision={savedAt} onOpen={onOpenPath} />
      {outlineOpen && (
        <Outline
          text={text}
          cursorLine={cursorLine}
          onReveal={(line) => handle.current?.revealLine(line)}
          onClose={() => setOutlineOpen(false)}
        />
      )}
    </div>
  )
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i
/** Files opened in the editor. Anything else is shown, not edited. */
const TEXT_FILE = /\.(md|markdown|txt|text|mdx|canvas|json|ya?ml|csv|tsv|log|css|js|ts|tsx|jsx|py|sh|html?|xml|toml|ini)$/i

/** A path with no extension counts as text: that is how plain notes are named elsewhere. */
const isTextFile = (path: string): boolean => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return !name.includes('.') || TEXT_FILE.test(name)
}

/**
 * A tab for a file that is not a note.
 *
 * Clicking a screenshot in the sidebar used to open its bytes in the markdown
 * editor - unreadable at best, and one such PNG crashed the editor outright.
 * Images are shown as images; anything else says what it is.
 */
function FileView({ path }: { path: string }): React.ReactElement {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const [failed, setFailed] = useState(false)
  if (IMAGE_FILE.test(name) && !failed) {
    return (
      <div className="file-view">
        <div className="md__bar">
          <span className="md__path">{path}</span>
        </div>
        <div className="file-view__stage">
          <img src={vaultFileUrl(path)} alt={name} onError={() => setFailed(true)} />
        </div>
      </div>
    )
  }
  return (
    <div className="pane-empty">
      <p>
        <code>{name}</code>
        <br />
        {failed ? 'This image could not be loaded.' : 'This file is not a note, so Recto does not open it as text.'}
      </p>
    </div>
  )
}

export function registerMarkdownView(
  onOpenLink: (target: string, heading: string | null) => void,
  onOpenPath: (path: string, heading?: string | null) => void,
  getLinkCandidates: () => readonly LinkCandidate[],
  getLivePreview: () => boolean,
  getVim: () => boolean,
  getShowTitle: () => boolean,
): () => void {
  return registerView({
    type: 'markdown',
    title: 'Editor',
    getTitle: (state) => {
      const path = (state as State).path
      if (typeof path !== 'string' || path === '') return 'Editor'
      return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
    },
    render: ({ state, setState }) => {
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
      if (!isTextFile(path)) return <FileView key={path} path={path} />
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
          showTitle={getShowTitle()}
          // The tab follows the file. The heading is dropped: it was where a
          // link landed when the note opened, and it is not worth re-scrolling
          // to after a rename.
          onRenamed={(next) => setState({ path: next })}
        />
      )
    },
  })
}
