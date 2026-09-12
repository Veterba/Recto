import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileNode } from '@shared/ipc-contract'
import { fuzzyFilter } from '../core/fuzzy'
import { Highlight } from './CommandPalette'

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

type Entry = { path: string; name: string; folder: string }

function flattenFiles(nodes: readonly FileNode[], out: Entry[] = []): Entry[] {
  for (const node of nodes) {
    if (node.kind === 'folder') flattenFiles(node.children ?? [], out)
    else if (node.name.toLowerCase().endsWith('.md')) {
      const at = node.path.lastIndexOf('/')
      out.push({
        path: node.path,
        name: node.name.replace(/\.md$/i, ''),
        folder: at === -1 ? '' : node.path.slice(0, at),
      })
    }
  }
  return out
}

type Props = {
  open: boolean
  roots: readonly FileNode[]
  onClose: () => void
  onOpen: (path: string) => void
}

export function QuickSwitcher({ open, roots, onClose, onOpen }: Props): React.ReactElement | null {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  const entries = useMemo(() => (open ? flattenFiles(roots) : []), [open, roots])

  const results = useMemo(() => {
    if (query.trim() === '') return entries.slice(0, 50).map((item) => ({ item, match: { score: 0, ranges: [] } }))
    // Match on the name, not the full path: matching the path makes every note
    // in a deeply nested folder score highly for its folder's letters.
    return fuzzyFilter(query, entries, (entry) => entry.name).slice(0, 50)
  }, [query, entries])

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
    onOpen(hit.item.path)
  }

  return (
    <div className="palette__backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Go to note"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Go to note…"
          value={query}
          spellCheck={false}
          onChange={(ev) => setQuery(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Escape') return onClose()
            if (ev.key === 'ArrowDown') {
              ev.preventDefault()
              setCursor((c) => Math.min(c + 1, Math.max(0, results.length - 1)))
            } else if (ev.key === 'ArrowUp') {
              ev.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            } else if (ev.key === 'Enter') {
              ev.preventDefault()
              commit(cursor)
            }
          }}
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
                  commit(i)
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
