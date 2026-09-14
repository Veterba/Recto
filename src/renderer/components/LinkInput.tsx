import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fuzzyFilter } from '../core/fuzzy'
import type { LinkCandidate } from '../editor/link-complete'

/**
 * A text input that offers note names after `[[`.
 *
 * The same gesture as the editor, in the one other place links are written.
 * Without it, the only way to put a link in a property was to type the note's
 * name exactly and close the brackets by hand - which is how a real vault ended
 * up with `["[[Recto]]]]"]`, and how "links in properties do not work" looked
 * true while the feature was in fact working.
 */

const OPEN_LINK = /\[\[([^\]\n]*)$/
const MAX = 8

type Props = {
  value: string
  onChange: (value: string) => void
  getCandidates: () => readonly LinkCandidate[]
  className?: string
  placeholder?: string
  autoFocus?: boolean
  onBlur?: () => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
}

export function LinkInput({
  value,
  onChange,
  getCandidates,
  className,
  placeholder,
  autoFocus,
  onBlur,
  onKeyDown,
}: Props): React.ReactElement {
  const input = useRef<HTMLInputElement | null>(null)
  const [caret, setCaret] = useState(value.length)
  const [cursor, setCursor] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null)

  const open = OPEN_LINK.exec(value.slice(0, caret))
  const query = open?.[1] ?? null
  const matches =
    query === null || dismissed
      ? []
      : (query.trim() === ''
          ? getCandidates().map((item) => ({ item }))
          : fuzzyFilter(query, getCandidates(), (candidate) => candidate.name)
        ).slice(0, MAX)

  useLayoutEffect(() => {
    if (matches.length === 0 || input.current === null) {
      setBox(null)
      return
    }
    const rect = input.current.getBoundingClientRect()
    setBox({ left: rect.left, top: rect.bottom + 4, width: Math.max(rect.width, 220) })
    // Position depends on the input, and only matters while the list is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches.length, value])

  const pick = (name: string): void => {
    if (open === null) return
    const start = caret - (open[1] ?? '').length
    const after = value.slice(caret)
    // Do not close brackets that are already closed.
    const close = after.startsWith(']]') ? '' : ']]'
    const next = `${value.slice(0, start)}${name}${close}${after}`
    const at = start + name.length + 2
    onChange(next)
    setCursor(0)
    requestAnimationFrame(() => {
      input.current?.setSelectionRange(at, at)
      setCaret(at)
    })
  }

  const track = (event: React.SyntheticEvent<HTMLInputElement>): void =>
    setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)

  return (
    <>
      <input
        ref={input}
        className={className}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(event) => {
          onChange(event.target.value)
          track(event)
          setDismissed(false)
          setCursor(0)
        }}
        onSelect={track}
        onBlur={onBlur}
        onKeyDown={(event) => {
          if (matches.length > 0) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setCursor((c) => (c + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length)
              return
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              const chosen = matches[cursor]
              if (chosen !== undefined) pick(chosen.item.name)
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setDismissed(true)
              return
            }
          }
          onKeyDown?.(event)
        }}
      />
      {box !== null &&
        matches.length > 0 &&
        createPortal(
          <ul className="link-suggest" style={{ left: box.left, top: box.top, width: box.width }} role="listbox">
            {matches.map((match, index) => (
              <li
                key={match.item.path}
                role="option"
                aria-selected={index === cursor}
                className={`link-suggest__item${index === cursor ? ' is-cursor' : ''}`}
                // Mousedown, not click: a click would blur the input first,
                // which commits the half-typed value and closes the list.
                onMouseDown={(event) => {
                  event.preventDefault()
                  pick(match.item.name)
                }}
                onMouseEnter={() => setCursor(index)}
              >
                <span className="link-suggest__name">{match.item.name}</span>
                {match.item.folder !== '' && <span className="link-suggest__folder">{match.item.folder}</span>}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  )
}
