import { useEffect, useRef, useState } from 'react'

/**
 * The parts every picker shares - the command palette, the quick switcher and
 * search: a text field over a list, arrows to move, Enter to pick.
 */

/** Query and cursor state, reset and focused each time the picker opens. */
export function usePicker(open: boolean): {
  query: string
  setQuery: (query: string) => void
  cursor: number
  setCursor: React.Dispatch<React.SetStateAction<number>>
  inputRef: React.RefObject<HTMLInputElement | null>
  listRef: React.RefObject<HTMLUListElement | null>
} {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    inputRef.current?.focus()
  }, [open])

  useEffect(() => setCursor(0), [query])

  return { query, setQuery, cursor, setCursor, inputRef, listRef }
}

/** Keep the selected row in view as the cursor or the list changes. */
export function useScrollSelected(listRef: React.RefObject<HTMLUListElement | null>, cursor: number, results: unknown): void {
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, results])
}

/**
 * The picker's keys, for its text field's `onKeyDown`. `emacs` adds Ctrl-N and
 * Ctrl-P for down and up.
 */
export function pickerKeyDown(
  ev: React.KeyboardEvent,
  {
    count,
    cursor,
    setCursor,
    pick,
    close,
    emacs = false,
  }: {
    count: number
    cursor: number
    setCursor: React.Dispatch<React.SetStateAction<number>>
    pick: (index: number) => void
    close: () => void
    emacs?: boolean
  },
): void {
  if (ev.key === 'Escape') return close()
  if (ev.key === 'ArrowDown' || (emacs && ev.key === 'n' && ev.ctrlKey)) {
    ev.preventDefault()
    setCursor((c) => Math.min(c + 1, Math.max(0, count - 1)))
  } else if (ev.key === 'ArrowUp' || (emacs && ev.key === 'p' && ev.ctrlKey)) {
    ev.preventDefault()
    setCursor((c) => Math.max(c - 1, 0))
  } else if (ev.key === 'Enter') {
    ev.preventDefault()
    pick(cursor)
  }
}
