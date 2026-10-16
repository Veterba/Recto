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
  onOpenExisting: (path: string) => void
  onClose: () => void
}

const WIDTH = 280
/** From a column's top edge to just under its header. */
const HEADER = 42

/**
 * The one way to add a card: a title field opened by a column's "+", over the top of that column.
 * Enter makes the card and closes; ⌘Enter makes it and stays for the next.
 * A name that is already a note is said here, and nothing is made.
 */
export function NewCardPopover({ column, columns, anchor, onAdd, onOpenExisting, onClose }: Props): React.ReactElement {
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
        <p className="new-card__taken" role="alert">
          A note with that name exists:{' '}
          <button type="button" className="new-card__link" onClick={() => onOpenExisting(taken)}>
            {taken}
          </button>
        </p>
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
