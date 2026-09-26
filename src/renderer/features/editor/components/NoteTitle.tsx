import { useState, useEffect } from 'react'

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
export function NoteTitle({ path, onRename }: { path: string; onRename: (name: string) => Promise<string | null> }): React.ReactElement {
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
