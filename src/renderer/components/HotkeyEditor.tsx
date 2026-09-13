import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { commands } from '../core/commands'
import { chordFromEvent, formatChord, normalizeChord } from '../core/hotkeys'
import { fuzzyFilter, type MatchRange } from '../core/fuzzy'
import { Highlight } from './CommandPalette'
import { Tip } from './Tip'

/**
 * Rebind any command.
 *
 * Reads the command registry, so every command is here the moment it is
 * registered - there is no second list to keep in sync. Overrides are written
 * to `hotkeys.json` in the vault: human-editable, diffable, and deletable to
 * get the defaults back.
 *
 * Conflicts are shown rather than silently resolved. Two commands really can
 * share a chord (bold in the editor, toggle-sidebar everywhere else) and the
 * registry picks by context; what must never happen is a binding that quietly
 * does nothing.
 */

type Overrides = Record<string, string | null>

/** Keys that are only ever modifiers - not a binding on their own. */
const MODIFIER_ONLY = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'])

export function HotkeyEditor(): React.ReactElement {
  const [overrides, setOverrides] = useState<Overrides>({})
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const captureRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void api.invoke('state:read', 'hotkeys').then((saved) => {
      if (saved !== null && typeof saved === 'object') setOverrides(saved as Overrides)
    })
  }, [])

  /** Persist and apply in one step, so the two can never disagree. */
  const commit = useCallback((next: Overrides) => {
    setOverrides(next)
    commands.setOverrides(next)
    setRevision((n) => n + 1)
    void api.invoke('state:write', 'hotkeys', next)
  }, [])

  // While recording, the window-level shortcut handler must not also fire -
  // otherwise pressing ⌘P to rebind it would open the palette.
  useEffect(() => {
    if (recording === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(null)
        return
      }
      if (MODIFIER_ONLY.has(event.key)) return
      const chord = chordFromEvent(event)
      // A bare letter would shadow typing everywhere; require a modifier.
      if (!/(ctrl|alt|meta)\+/.test(chord)) return
      commit({ ...overrides, [recording]: chord })
      setRecording(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recording, overrides, commit])

  const rows = useMemo(() => {
    void revision
    const all = commands.list().map((command) => ({
      id: command.id,
      name: command.name,
      section: command.section ?? 'Other',
      binding: commands.bindingFor(command.id),
      overridden: Object.prototype.hasOwnProperty.call(overrides, command.id),
    }))

    if (query.trim() === '') {
      return all
        .sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name))
        .map((row) => ({ row, ranges: [] as MatchRange[] }))
    }
    // Matched on the name only, and the ranges are kept so the search actually
    // shows what matched rather than being a silent filter.
    return fuzzyFilter(query, all, (row) => row.name).map((hit) => ({
      row: hit.item,
      ranges: hit.match.ranges,
    }))
  }, [query, overrides, revision])

  /** chord -> command ids, for showing which bindings are shared. */
  const conflicts = useMemo(() => {
    void revision
    const map = new Map<string, string[]>()
    for (const { chord, ids } of commands.conflicts()) map.set(chord, ids)
    return map
  }, [revision])

  return (
    <div className="hotkeys" ref={captureRef}>
      <div className="hotkeys__search">
        <input
          className="sidebar__search-input"
          type="search"
          placeholder="Search commands…"
          value={query}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => commit({})}
          disabled={Object.keys(overrides).length === 0}
        >
          Reset all
        </button>
      </div>

      <ul className="hotkeys__list">
        {rows.map(({ row, ranges }) => {
          const chord = row.binding === null ? null : normalizeChord(row.binding)
          const shared = chord === null ? undefined : conflicts.get(chord)

          return (
            <li key={row.id} className="hotkeys__row">
              <span className="hotkeys__name">
                <span>
                  <Highlight text={row.name} ranges={ranges} />
                </span>
                <span className="hotkeys__section">{row.section}</span>
              </span>

              {shared !== undefined && shared.length > 1 && (
                <span
                  className="hotkeys__shared"
                  title={`Also bound: ${shared.filter((id) => id !== row.id).join(', ')}. The editor wins while a note has focus.`}
                >
                  shared
                </span>
              )}

              <button
                className={`hotkeys__chord${recording === row.id ? ' is-recording' : ''}${row.overridden ? ' is-custom' : ''}`}
                onClick={() => setRecording(recording === row.id ? null : row.id)}
              >
                {recording === row.id
                  ? 'Press keys…'
                  : row.binding === null
                    ? 'Not bound'
                    : formatChord(row.binding)}
              </button>

              {row.overridden ? (
                <Tip label="Back to the default">
                <button
                  className="hotkeys__clear"
                  aria-label="Back to the default"
                  onClick={() => {
                    const next = { ...overrides }
                    delete next[row.id]
                    commit(next)
                  }}
                >
                  ↺
                </button>
                </Tip>
              ) : (
                <Tip label="Unbind this shortcut">
                  <button
                    className="hotkeys__clear"
                    aria-label="Unbind"
                    onClick={() => commit({ ...overrides, [row.id]: null })}
                  >
                    ×
                  </button>
                </Tip>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
