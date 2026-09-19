import { useEffect, useRef, useState } from 'react'
import type { SearchResult } from '@shared/ipc-contract'
import { api } from '../api'
import { plainSnippet } from '../core/snippet'

/**
 * Full-text search over the whole vault.
 *
 * The index does the ranking (BM25) and the snippeting, so this component only
 * has to render. Snippets come back with matches wrapped in `<<` `>>` rather
 * than HTML, so nothing from a note's content is ever interpreted as markup.
 */

type Props = {
  open: boolean
  onClose: () => void
  onOpenFile: (path: string) => void
}

export function SearchPanel({ open, onClose, onOpenFile }: Props): React.ReactElement | null {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [cursor, setCursor] = useState(0)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open])

  useEffect(() => {
    if (!open) return
    if (query.trim() === '') {
      setResults([])
      return
    }
    setSearching(true)
    // Debounced: typing "nordicsync" should be one query, not ten.
    const timer = window.setTimeout(() => {
      void api.invoke('index:search', query, 60).then((hits) => {
        setResults(hits)
        setCursor(0)
        setSearching(false)
      })
    }, 140)
    return () => window.clearTimeout(timer)
  }, [query, open])

  if (!open) return null

  const commit = (index: number): void => {
    const hit = results[index]
    if (!hit) return
    onClose()
    onOpenFile(hit.path)
  }

  return (
    <div className="palette__backdrop" onMouseDown={onClose}>
      <div
        className="palette palette--search"
        role="dialog"
        aria-modal="true"
        aria-label="Search notes"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Search all notes…"
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

        {query.trim() === '' ? (
          <p className="palette__empty">
            Type to search every note. Whole phrases work — the index does the ranking.
          </p>
        ) : results.length === 0 ? (
          <p className="palette__empty">{searching ? 'Searching…' : 'No matches.'}</p>
        ) : (
          <ul className="palette__list" role="listbox">
            {results.map((hit, i) => (
              <li
                key={hit.path}
                role="option"
                aria-selected={i === cursor}
                className={`result${i === cursor ? ' is-active' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onMouseDown={(ev) => {
                  ev.preventDefault()
                  commit(i)
                }}
              >
                <span className="result__name">{hit.path.slice(hit.path.lastIndexOf('/') + 1).replace(/\.md$/, '')}</span>
                <span className="result__path">{hit.path}</span>
                <Snippet text={hit.snippet} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * Render FTS5's `<<match>>` markers as highlights.
 *
 * The markers are chosen rather than HTML tags precisely so that note content
 * can be rendered as text: nothing a user writes can inject markup here.
 */
function Snippet({ text }: { text: string }): React.ReactElement {
  const parts = plainSnippet(text).split(/(<<[^>]*>>)/g)
  return (
    <span className="result__snippet">
      {parts.map((part, i) =>
        part.startsWith('<<') && part.endsWith('>>') ? (
          <mark key={i} className="hl">
            {part.slice(2, -2)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  )
}
