import { useMemo } from 'react'
import type { FileNode } from '@shared/vault'
import { fuzzyFilter } from '../../../ui/fuzzy'
import { noteEntries } from '../../file-tree'
import { Highlight } from '../../../app/components/CommandPalette'
import { pickerKeyDown, usePicker, useScrollSelected } from '../../../ui/picker'
import { pressOrDrag } from '../../../ui/press-or-drag'
import { beginPaneDrag } from '../../../app/pane-drag'

/**
 * Jump to any note by name (⌘O).
 *
 * Filenames only, matched in the renderer against the tree that is already in
 * memory - a few thousand strings, so no index round trip and no debounce. The
 * full-text search (⌘⇧F) is the one that needs the database.
 *
 * Shares the fuzzy matcher and the highlight renderer with the command palette,
 * which is the point of having kept `match -> ranges -> render` separate.
 */

type Props = {
  open: boolean
  roots: readonly FileNode[]
  onClose: () => void
  onOpen: (path: string) => void
}

export function QuickSwitcher({ open, roots, onClose, onOpen }: Props): React.ReactElement | null {
  const { query, setQuery, cursor, setCursor, inputRef, listRef } = usePicker(open)

  const entries = useMemo(() => (open ? noteEntries(roots) : []), [open, roots])

  const results = useMemo(() => {
    if (query.trim() === '') return entries.slice(0, 50).map((item) => ({ item, match: { score: 0, ranges: [] } }))
    // Match on the name, not the full path: matching the path makes every note
    // in a deeply nested folder score highly for its folder's letters.
    return fuzzyFilter(query, entries, (entry) => entry.name).slice(0, 50)
  }, [query, entries])

  useScrollSelected(listRef, cursor, results)

  if (!open) return null

  const commit = (index: number): void => {
    const hit = results[index]
    if (!hit) return
    onClose()
    onOpen(hit.item.path)
  }

  return (
    <div className="palette__backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Go to note" onMouseDown={(ev) => ev.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Go to note…"
          value={query}
          spellCheck={false}
          onChange={(ev) => setQuery(ev.target.value)}
          onKeyDown={(ev) => pickerKeyDown(ev, { count: results.length, cursor, setCursor, pick: commit, close: onClose })}
        />

        {results.length === 0 ? (
          <p className="palette__empty">{entries.length === 0 ? 'No notes in this vault yet.' : 'No matching note.'}</p>
        ) : (
          <ul className="palette__list" ref={listRef} role="listbox">
            {results.map((hit, i) => (
              <li
                key={hit.item.path}
                role="option"
                aria-selected={i === cursor}
                className={`palette__item${i === cursor ? ' is-active' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onMouseDown={(ev) => {
                  ev.preventDefault()
                  // A click opens it; dragged out, it goes to the pane it is dropped on.
                  pressOrDrag(ev, {
                    onClick: () => commit(i),
                    onDrag: (x, y) => {
                      onClose()
                      beginPaneDrag({ kind: 'path', path: hit.item.path }, hit.item.name, x, y)
                    },
                  })
                }}
              >
                <span className="palette__name">
                  <Highlight text={hit.item.name} ranges={hit.match.ranges} />
                </span>
                {hit.item.folder !== '' && <span className="palette__section">{hit.item.folder}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
