import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { groupRows, hotkeyRows, rowMatches } from '../hotkey-groups'

/**
 * Every shortcut on one sheet, grouped as in Settings → Shortcuts (the same
 * data, app/hotkey-groups.ts). Only commands that have a key: a cheat sheet
 * of "not bound" is noise. Typing filters it; Esc, ⌘/ again or a click
 * outside close it.
 */
export function ShortcutSheet({ onClose }: { onClose: () => void }): React.ReactElement {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => groupRows(hotkeyRows().filter((row) => row.label !== null && rowMatches(row, query))), [query])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <div
      className="dialog__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog shortcut-sheet" role="dialog" aria-label="Keyboard shortcuts">
        <header className="shortcut-sheet__head">
          <h2 className="dialog__title">Keyboard shortcuts</h2>
          <input
            className="sidebar__search-input shortcut-sheet__search"
            type="search"
            placeholder="Filter…"
            aria-label="Filter shortcuts"
            autoFocus
            value={query}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
        </header>
        <div className="shortcut-sheet__body">
          {groups.map((group) => (
            <section key={group.section} className="shortcut-sheet__group">
              <h3 className="shortcut-sheet__grouphead">{group.section}</h3>
              <dl className="shortcut-sheet__list">
                {group.rows.map((row) => (
                  <div key={row.id} className="shortcut-sheet__row">
                    <dt>{row.name}</dt>
                    <dd>
                      <kbd>{row.label}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          {groups.length === 0 && <p className="shortcut-sheet__empty">No shortcut matches “{query}”.</p>}
        </div>
        <footer className="shortcut-sheet__foot">Change any of them in Settings → Shortcuts.</footer>
      </div>
    </div>,
    document.body,
  )
}
