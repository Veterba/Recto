import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Column } from '../boards'
import type { AddResult } from '../hooks/use-board-cards'

type Props = {
  /** The column the card goes in; with more than one offered, a picker is shown too. */
  column: string
  /** Columns to choose from, for the palette's "New card". Omitted from a column's own "+". */
  columns?: readonly Column[] | undefined
  /** The column it opens in, under its header; null centres it under the board's toolbar. */
  anchor: DOMRect | null
  onAdd: (column: string, title: string) => Promise<AddResult>
  /** The note that has the name, put on the board as it is. */
  onAddExisting: (column: string, path: string) => Promise<AddResult>
  onOpenExisting: (path: string) => void
  onClose: () => void
}

const WIDTH = 280

const stemOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
/** Where a note is, as a person reads it: its folder, or the vault's top. */
export const folderOf = (path: string): string => (path.includes('/') ? `${path.slice(0, path.lastIndexOf('/'))}/` : 'the top of the vault')
/** From a column's top edge to just under its header. */
const HEADER = 42

/**
 * The one way to add a card: a title field opened by a column's "+", over the top of that column.
 * Enter makes the card and closes; ⌘Enter makes it and stays for the next.
 * A name that is already a note is a choice, never a guess: put that note on
 * the board as it is, or choose another name. Nothing is made, moved or
 * overwritten until one is picked.
 */
export function NewCardPopover({ column, columns, anchor, onAdd, onAddExisting, onOpenExisting, onClose }: Props): React.ReactElement {
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState(column)
  const [taken, setTaken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const box = useRef<HTMLFormElement | null>(null)
  const field = useRef<HTMLInputElement | null>(null)
  const [at, setAt] = useState<{ left: number; top: number; width: number }>({ left: 0, top: 0, width: WIDTH })

  useLayoutEffect(() => {
    const width = anchor === null ? WIDTH : anchor.width - 16
    const left = anchor === null ? (window.innerWidth - WIDTH) / 2 : anchor.left + 8
    const top = anchor === null ? 96 : anchor.top + HEADER
    setAt({ left: Math.max(8, Math.min(window.innerWidth - width - 8, left)), top, width })
  }, [anchor])

  useEffect(() => field.current?.focus(), [])

  // A click anywhere else closes it.
  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (box.current?.contains(event.target as Node) !== true) onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [onClose])

  const submit = async (stay: boolean): Promise<void> => {
    const name = title.trim()
    if (name === '' || busy.current) return
    busy.current = true
    const result = await onAdd(target, name)
    busy.current = false
    if (result.ok) {
      setTaken(null)
      setError(null)
      if (stay) {
        setTitle('')
        field.current?.focus()
      } else onClose()
    } else if ('exists' in result) setTaken(result.exists)
    else setError(result.error)
  }

  const addExisting = async (existing: string): Promise<void> => {
    if (busy.current) return
    busy.current = true
    const result = await onAddExisting(target, existing)
    busy.current = false
    if (result.ok) onClose()
    else if ('error' in result) {
      setTaken(null)
      setError(result.error)
    }
  }

  const anotherName = (): void => {
    setTaken(null)
    field.current?.focus()
    field.current?.select()
  }

  return createPortal(
    <form
      ref={box}
      className="new-card glass-surface"
      role="dialog"
      aria-label="New card"
      style={{ left: at.left, top: at.top, width: at.width }}
      onSubmit={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
        if (event.key === 'Enter' && event.target === field.current) {
          event.preventDefault()
          if (!event.repeat) void submit(event.metaKey || event.ctrlKey)
        }
      }}
    >
      {columns !== undefined && columns.length > 1 && (
        <select className="setting__select new-card__column" aria-label="Column" value={target} onChange={(e) => setTarget(e.target.value)}>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <input
        ref={field}
        className="new-card__title"
        value={title}
        placeholder="Card title"
        aria-label="Card title"
        spellCheck={false}
        onChange={(event) => {
          setTitle(event.target.value)
          setTaken(null)
          setError(null)
        }}
      />
      {taken !== null && (
        <div className="new-card__exists" role="alert">
          <p className="new-card__taken">
            A note “
            <button type="button" className="new-card__link" onClick={() => onOpenExisting(taken)}>
              {stemOf(taken)}
            </button>
            ” already exists in {folderOf(taken)}. Add it to this board?
          </p>
          <div className="new-card__choices">
            <button type="button" className="btn btn--sm" onClick={() => void addExisting(taken)}>
              Add it to this board
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={anotherName}>
              Choose another name
            </button>
          </div>
        </div>
      )}
      {error !== null && (
        <p className="new-card__taken" role="alert">
          {error}
        </p>
      )}
      <p className="new-card__hint">↵ add · ⌘↵ add another · esc close</p>
    </form>,
    document.body,
  )
}
