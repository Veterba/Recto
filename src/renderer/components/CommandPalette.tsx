import { useEffect, useMemo, useRef, useState } from 'react'
import type { CommandRegistry } from '../core/commands'
import { fuzzyFilter, toSegments, type MatchRange } from '../core/fuzzy'
import { formatChord } from '../core/hotkeys'

/**
 * The command palette. Reads the registry and nothing else - so every command
 * is reachable here the moment it is registered, with no separate wiring.
 */

type Props = {
  registry: CommandRegistry
  open: boolean
  onClose: () => void
}

export function CommandPalette({ registry, open, onClose }: Props): React.ReactElement | null {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  // `available()` is called per open, not per keystroke, so isAvailable() stays cheap.
  const commands = useMemo(() => (open ? registry.available() : []), [registry, open])
  const results = useMemo(() => fuzzyFilter(query, commands, (c) => c.name).slice(0, 50), [query, commands])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    inputRef.current?.focus()
  }, [open])

  useEffect(() => setCursor(0), [query])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, results])

  if (!open) return null

  const commit = (index: number): void => {
    const hit = results[index]
    if (!hit) return
    onClose()
    void registry.run(hit.item.id)
  }

  return (
    <div className="palette__backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Type a command…"
          value={query}
          spellCheck={false}
          onChange={(ev) => setQuery(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Escape') return onClose()
            if (ev.key === 'ArrowDown' || (ev.key === 'n' && ev.ctrlKey)) {
              ev.preventDefault()
              setCursor((c) => Math.min(c + 1, Math.max(0, results.length - 1)))
            } else if (ev.key === 'ArrowUp' || (ev.key === 'p' && ev.ctrlKey)) {
              ev.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            } else if (ev.key === 'Enter') {
              ev.preventDefault()
              commit(cursor)
            }
          }}
        />

        {results.length === 0 ? (
          <p className="palette__empty">No matching command.</p>
        ) : (
          <ul className="palette__list" ref={listRef} role="listbox">
            {results.map((hit, i) => {
              const binding = registry.bindingFor(hit.item.id)
              return (
                <li
                  key={hit.item.id}
                  role="option"
                  aria-selected={i === cursor}
                  className={`palette__item${i === cursor ? ' is-active' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onMouseDown={(ev) => {
                    ev.preventDefault()
                    commit(i)
                  }}
                >
                  <span className="palette__name">
                    <Highlight text={hit.item.name} ranges={hit.match.ranges} />
                  </span>
                  {hit.item.section !== undefined && <span className="palette__section">{hit.item.section}</span>}
                  {binding !== null && <kbd className="palette__key">{formatChord(binding)}</kbd>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

/** The render half of `match -> ranges -> render`. Shared by every result list. */
export function Highlight({ text, ranges }: { text: string; ranges: readonly MatchRange[] }): React.ReactElement {
  return (
    <>
      {toSegments(text, ranges).map((seg, i) =>
        seg.hit ? (
          <mark key={i} className="hl">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  )
}
