import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { inRecto } from '@shared/recto-paths'
import { fuzzyFilter, type MatchRange } from '../../../ui/fuzzy'
import { Icon } from '../../../ui/Icon'
import { pickerKeyDown, useScrollSelected } from '../../../ui/picker'
import { Highlight } from '../../../app/components/CommandPalette'

/**
 * One note out of the vault, found by typing its name - in place of a menu
 * that lists every file. Notes only: not Recto's own files (boards, cards,
 * chats), which are not notes you write a guide in.
 *
 * The list is drawn over everything, anchored to the button: a settings card
 * clips what pokes out of it, and the list is taller than the card.
 */

type Entry = { path: string; name: string; folder: string }
type Row = { kind: 'none' } | { kind: 'note'; entry: Entry; ranges: readonly MatchRange[] }

const SHOWN = 50
/** Room the list wants; with less below the button, it opens above. */
const WANTED = 340
const GAP = 4

const entryOf = (path: string): Entry => {
  const at = path.lastIndexOf('/')
  return { path, name: path.slice(at + 1).replace(/\.md$/i, ''), folder: at === -1 ? '' : path.slice(0, at) }
}

type Props = {
  /** Vault-relative paths; the Markdown ones are offered. */
  notes: readonly string[]
  value: string | null
  onChange: (path: string | null) => void
  label: string
}

export function NotePicker({ notes, value, onChange, label }: Props): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const root = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  const pop = useRef<HTMLDivElement | null>(null)
  const [at, setAt] = useState<React.CSSProperties>({})

  // Where the list goes: under the button, or over it when the window has more room there; kept there on scroll and resize.
  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const r = button.current?.getBoundingClientRect()
      if (r === undefined) return
      const below = window.innerHeight - r.bottom - GAP
      const above = r.top - GAP
      const up = below < WANTED && above > below
      setAt({
        right: window.innerWidth - r.right,
        ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
        maxHeight: Math.max(160, (up ? above : below) - 12),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const entries = useMemo(() => notes.filter((n) => n.toLowerCase().endsWith('.md') && !inRecto(n)).map(entryOf), [notes])
  const rows = useMemo((): Row[] => {
    const typed = query.trim()
    const hits =
      typed === ''
        ? entries.slice(0, SHOWN).map((entry): Row => ({ kind: 'note', entry, ranges: [] }))
        : fuzzyFilter(typed, entries, (e) => e.name)
            .slice(0, SHOWN)
            .map((hit): Row => ({ kind: 'note', entry: hit.item, ranges: hit.match.ranges }))
    return typed === '' ? [{ kind: 'none' }, ...hits] : hits
  }, [query, entries])

  useEffect(() => setCursor(0), [query])
  useScrollSelected(listRef, cursor, rows)

  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return
    const away = (ev: PointerEvent): void => {
      const target = ev.target as Node
      if (!root.current?.contains(target) && !pop.current?.contains(target)) setOpen(false)
    }
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [open])

  const pick = (index: number): void => {
    const row = rows[index]
    if (row === undefined) return
    onChange(row.kind === 'none' ? null : row.entry.path)
    setOpen(false)
  }

  const current = value === null ? null : entryOf(value)
  const missing = value !== null && !notes.includes(value)

  return (
    <div className="note-picker" ref={root}>
      <button
        ref={button}
        className="note-picker__button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={value ?? undefined}
        onClick={() => {
          setQuery('')
          setOpen((o) => !o)
        }}
      >
        <Icon name="file-text" size={14} />
        <span className="note-picker__name">{current === null ? 'None' : `${current.name}${missing ? ' (missing)' : ''}`}</span>
        <Icon name="chevron-down" size={13} />
      </button>
      {open &&
        createPortal(
          <div className="note-picker__pop" ref={pop} style={at}>
            <input
              className="note-picker__input"
              autoFocus
              placeholder="Find a note…"
              spellCheck={false}
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              onKeyDown={(ev) => pickerKeyDown(ev, { count: rows.length, cursor, setCursor, pick, close: () => setOpen(false) })}
            />
            <ul className="note-picker__list" ref={listRef} role="listbox" aria-label={label}>
              {rows.map((row, i) => (
                <li
                  key={row.kind === 'none' ? '' : row.entry.path}
                  role="option"
                  aria-selected={i === cursor}
                  className={`note-picker__row${i === cursor ? ' is-active' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onMouseDown={(ev) => {
                    ev.preventDefault()
                    pick(i)
                  }}
                >
                  {row.kind === 'none' ? (
                    <span className="note-picker__row-name">None</span>
                  ) : (
                    <>
                      <span className="note-picker__row-name">
                        <Highlight text={row.entry.name} ranges={row.ranges} />
                      </span>
                      {row.entry.folder !== '' && <span className="note-picker__folder">{row.entry.folder}</span>}
                    </>
                  )}
                  {(row.kind === 'none' ? value === null : row.entry.path === value) && <Icon name="check" size={13} />}
                </li>
              ))}
              {rows.length === 0 && <li className="note-picker__none">No note by that name.</li>}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  )
}
