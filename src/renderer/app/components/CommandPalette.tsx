import { useMemo } from 'react'
import type { CommandRegistry } from '../commands'
import { fuzzyFilter, toSegments, type MatchRange } from '../../ui/fuzzy'
import { formatChord } from '../hotkeys'
import { Icon } from '../../ui/Icon'
import { pickerKeyDown, usePicker, useScrollSelected } from '../../ui/picker'

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
  const { query, setQuery, cursor, setCursor, inputRef, listRef } = usePicker(open)

  // `available()` is called per open, not per keystroke, so isAvailable() stays cheap.
  const commands = useMemo(() => (open ? registry.available() : []), [registry, open])
  const results = useMemo(() => fuzzyFilter(query, commands, (c) => c.name).slice(0, 50), [query, commands])

  useScrollSelected(listRef, cursor, results)

  if (!open) return null

  const commit = (index: number): void => {
    const hit = results[index]
    if (!hit) return
    onClose()
    void registry.run(hit.item.id)
  }

  return (
    <div className="palette__backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(ev) => ev.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Type a command…"
          value={query}
          spellCheck={false}
          onChange={(ev) => setQuery(ev.target.value)}
          onKeyDown={(ev) => pickerKeyDown(ev, { count: results.length, cursor, setCursor, pick: commit, close: onClose, emacs: true })}
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
                  {hit.item.icon !== undefined && (
                    <span className="palette__icon">
                      <Icon name={hit.item.icon} size={15} />
                    </span>
                  )}
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
