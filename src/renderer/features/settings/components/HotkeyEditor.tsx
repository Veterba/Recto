import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../../app/api'
import { commands } from '../../../app/commands'
import { chordFromEvent, formatChord } from '../../../app/hotkeys'
import { bindingProblem, groupRows, hotkeyRows, rowMatches } from '../../../app/hotkey-groups'
import { Tip } from '../../../ui/Tip'
import { IPC } from '@shared/ipc'

/**
 * Rebind any command.
 *
 * Reads the command registry, so every command is here the moment it is
 * registered - there is no second list to keep in sync. Grouped as the ⌘/
 * cheat sheet is (app/hotkey-groups.ts), searchable by name, group or keys.
 * Overrides are written to `hotkeys.json` in the vault: human-editable,
 * diffable, and deletable to get the defaults back.
 *
 * A new combination that another command in the same place already uses is
 * not applied until you choose: take it (and leave the other unbound) or keep
 * looking. One that macOS keeps (⌘⇧4, ⌘M) is refused with what it does.
 */

type Overrides = Record<string, string | null>

/** Keys that are only ever modifiers - not a binding on their own. */
const MODIFIER_ONLY = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'])

type Pending = { id: string; chord: string; taken: string[] } | { id: string; chord: string; reserved: string }

export function HotkeyEditor(): React.ReactElement {
  const [overrides, setOverrides] = useState<Overrides>({})
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    void api.invoke(IPC.stateRead, 'hotkeys').then((saved) => {
      if (saved !== null && typeof saved === 'object') setOverrides(saved as Overrides)
    })
  }, [])

  /** Persist and apply in one step, so the two can never disagree. */
  const commit = useCallback((next: Overrides) => {
    setOverrides(next)
    commands.setOverrides(next)
    setRevision((n) => n + 1)
    void api.invoke(IPC.stateWrite, 'hotkeys', next)
  }, [])

  /** Bind, or stop and ask when the chord is taken or kept by macOS. */
  const tryBind = useCallback(
    (id: string, chord: string) => {
      const problem = bindingProblem(id, chord)
      if (problem === null) {
        commit({ ...overrides, [id]: chord })
        return
      }
      setPending({ id, chord, ...problem })
    },
    [overrides, commit],
  )

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
      setRecording(null)
      tryBind(recording, chord)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recording, tryBind])

  const groups = useMemo(() => {
    void revision
    void overrides
    return groupRows(hotkeyRows().filter((row) => rowMatches(row, query)))
  }, [query, overrides, revision])

  /** Command id -> the others it clashes with, in its own scope: these must be resolved. */
  const clashes = useMemo(() => {
    void revision
    const map = new Map<string, string[]>()
    for (const { ids } of commands.conflicts())
      for (const id of ids)
        map.set(
          id,
          ids.filter((other) => other !== id),
        )
    return map
  }, [revision])

  const nameOf = (id: string): string => commands.get(id)?.name ?? id

  return (
    <div className="hotkeys">
      <div className="hotkeys__search">
        <input
          className="sidebar__search-input"
          type="search"
          placeholder="Search commands or keys…"
          aria-label="Search shortcuts"
          value={query}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="btn btn--ghost btn--sm" onClick={() => commit({})} disabled={Object.keys(overrides).length === 0}>
          Reset all to defaults
        </button>
      </div>

      {clashes.size > 0 && (
        <p className="hotkeys__banner" role="alert">
          Some commands share a shortcut, so only one of each can run. Change one of each marked below.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.section} className="hotkeys__group">
          <h3 className="hotkeys__grouphead">{group.section}</h3>
          <ul className="hotkeys__list">
            {group.rows.map((row) => {
              const overridden = Object.prototype.hasOwnProperty.call(overrides, row.id)
              const clash = clashes.get(row.id)
              const asking = pending?.id === row.id ? pending : null
              return (
                <li key={row.id} className={`hotkeys__row${clash !== undefined ? ' is-conflict' : ''}`} data-command={row.id}>
                  <div className="hotkeys__line">
                    <span className="hotkeys__name">{row.name}</span>
                    {clash !== undefined && (
                      <span className="hotkeys__badge" title={`Also: ${clash.map(nameOf).join(', ')}`}>
                        same as {clash.map(nameOf).join(', ')}
                      </span>
                    )}
                    <button
                      className={`hotkeys__chord${recording === row.id ? ' is-recording' : ''}${overridden ? ' is-custom' : ''}`}
                      aria-label={`Shortcut for ${row.name}`}
                      onClick={() => {
                        setPending(null)
                        setRecording(recording === row.id ? null : row.id)
                      }}
                    >
                      {recording === row.id ? 'Press keys…' : (row.label ?? 'Not bound')}
                    </button>
                    {overridden ? (
                      <Tip label="Reset to default">
                        <button
                          className="hotkeys__clear"
                          aria-label="Reset to default"
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
                          disabled={row.binding === null}
                          onClick={() => commit({ ...overrides, [row.id]: null })}
                        >
                          ×
                        </button>
                      </Tip>
                    )}
                  </div>
                  {asking !== null && (
                    <div className="hotkeys__ask" role="alert">
                      {'reserved' in asking ? (
                        <>
                          <span>
                            {formatChord(asking.chord)} is kept by macOS for {asking.reserved}. Pick another.
                          </span>
                          <button className="btn btn--ghost btn--sm" onClick={() => setPending(null)}>
                            OK
                          </button>
                        </>
                      ) : (
                        <>
                          <span>
                            {formatChord(asking.chord)} is already {asking.taken.map(nameOf).join(', ')}.
                          </span>
                          <button
                            className="btn btn--sm"
                            onClick={() => {
                              const next: Overrides = { ...overrides, [asking.id]: asking.chord }
                              for (const other of asking.taken) next[other] = null
                              setPending(null)
                              commit(next)
                            }}
                          >
                            Use it here, unbind {asking.taken.length === 1 ? 'that' : 'those'}
                          </button>
                          <button className="btn btn--ghost btn--sm" onClick={() => setPending(null)}>
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {groups.length === 0 && <p className="hotkeys__empty">No command matches “{query}”.</p>}
    </div>
  )
}
