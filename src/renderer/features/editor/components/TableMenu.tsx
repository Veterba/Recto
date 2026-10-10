import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'

/**
 * The table's menus (table-editor.ts): one for a row, one for a column, one
 * for the table, and a short one on a cell that leads to all three.
 *
 * Compact on purpose: inserting and duplicating are a row of icons, alignment
 * is a segmented control, sorting two icons; moves show their shortcuts and
 * delete comes last, in red. Hovering or focusing an entry previews it on the
 * table (`preview`), and leaving it goes back to the plain highlight (`idle`).
 * Arrows move between entries (left/right within a row of icons or a segmented
 * control), Enter acts, Esc closes - a submenu first.
 */

export type MenuEntry =
  | { kind: 'icons'; items: readonly IconAction[] }
  | { kind: 'segmented'; label: string; options: readonly (IconAction & { active: boolean })[] }
  | {
      kind: 'item'
      icon: string
      label: string
      shortcut?: string
      danger?: boolean
      disabled?: boolean
      run: () => void
      preview?: () => void
    }
  | { kind: 'separator' }
  | { kind: 'submenu'; icon: string; label: string; entries: readonly MenuEntry[]; idle: () => void }

export type IconAction = { icon: string; label: string; run: () => void; preview?: () => void; disabled?: boolean }

type PanelProps = {
  entries: readonly MenuEntry[]
  at: { x: number; y: number }
  /** Back to the plain highlight when nothing in this panel is hovered. */
  idle: () => void
  onClose: () => void
  /** A submenu: Esc and ← come back to the item that opened it. */
  onBack?: () => void
  /** Focus the first entry when opened from the keyboard. */
  autoFocus: boolean
  /**
   * A submenu: the left edge of the menu that opened it. Without room on the
   * right it goes left of that menu - never on top of it.
   */
  besideLeft?: number
}

const MARGIN = 8

function Panel({ entries, at, idle, onClose, onBack, autoFocus, besideLeft }: PanelProps): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState(at)
  const [sub, setSub] = useState<{ index: number; at: { x: number; y: number }; keyboard: boolean } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    // Its laid-out size, not getBoundingClientRect: that one is scaled while
    // the menu animates in, and a menu measured 3% small is placed 3% wrong.
    const rect = { width: el.offsetWidth, height: el.offsetHeight }
    let x = at.x
    if (at.x + rect.width > window.innerWidth - MARGIN) {
      if (besideLeft === undefined) x = Math.max(MARGIN, at.x - rect.width)
      else {
        // Left of the parent menu if it fits there; otherwise whichever side
        // has more room, overlapping as little as possible.
        const left = besideLeft - 4 - rect.width
        const roomLeft = besideLeft - MARGIN
        const roomRight = window.innerWidth - MARGIN - at.x
        x = left >= MARGIN ? left : roomLeft > roomRight ? MARGIN : window.innerWidth - MARGIN - rect.width
      }
    }
    const y = Math.max(MARGIN, Math.min(at.y, window.innerHeight - rect.height - MARGIN))
    setPosition({ x, y })
    if (autoFocus) (el.querySelector('[data-nav]:not(:disabled)') as HTMLElement | null)?.focus()
  }, [at, autoFocus, besideLeft])

  const stops = (): HTMLElement[] => [...(ref.current?.querySelectorAll<HTMLElement>('[data-nav]:not(:disabled)') ?? [])]

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const all = stops()
    const current = document.activeElement as HTMLElement | null
    const index = current === null ? -1 : all.indexOf(current)
    const group = current?.dataset['group']
    const inGroup = all.filter((el) => el.dataset['group'] === group)
    const groups = [...new Set(all.map((el) => el.dataset['group']))]
    const firstOf = (g: string | undefined): HTMLElement | undefined => all.find((el) => el.dataset['group'] === g)
    const stop = (): void => {
      event.preventDefault()
      event.stopPropagation()
    }
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        stop()
        const g = groups.indexOf(group)
        const next = event.key === 'ArrowDown' ? (g + 1) % groups.length : (g - 1 + groups.length) % groups.length
        firstOf(groups[index === -1 ? 0 : next])?.focus()
        return
      }
      case 'ArrowRight':
      case 'ArrowLeft': {
        const forward = event.key === 'ArrowRight'
        if (current?.dataset['submenu'] !== undefined && forward) {
          stop()
          current.click()
          return
        }
        if (inGroup.length > 1) {
          stop()
          const i = inGroup.indexOf(current!)
          inGroup[Math.max(0, Math.min(inGroup.length - 1, i + (forward ? 1 : -1)))]?.focus()
          return
        }
        if (!forward && onBack !== undefined) {
          stop()
          onBack()
        }
        return
      }
      case 'Escape':
        stop()
        if (onBack !== undefined) onBack()
        else onClose()
        return
      case 'Tab':
        stop()
        return
    }
  }

  let group = 0
  const nextGroup = (): string => String(group++)

  return (
    <>
      <div
        ref={ref}
        className="tmenu glass-surface"
        role="menu"
        style={{ left: position.x, top: position.y }}
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
        onMouseLeave={() => {
          if (sub === null) idle()
        }}
      >
        {entries.map((entry, i) => {
          if (entry.kind === 'separator') return <hr key={i} className="tmenu__sep" />
          if (entry.kind === 'icons') {
            const g = nextGroup()
            return (
              <div key={i} className="tmenu__icons" role="group">
                {entry.items.map((item) => (
                  <Tip key={item.label} label={item.label} placement="top">
                    <button
                      className="tmenu__icon"
                      data-nav
                      data-group={g}
                      aria-label={item.label}
                      disabled={item.disabled === true}
                      onMouseEnter={() => item.preview?.()}
                      onFocus={() => item.preview?.()}
                      onClick={() => {
                        item.run()
                        onClose()
                      }}
                    >
                      <Icon name={item.icon} size={15} />
                    </button>
                  </Tip>
                ))}
              </div>
            )
          }
          if (entry.kind === 'segmented') {
            const g = nextGroup()
            return (
              <div key={i} className="tmenu__row">
                <span className="tmenu__label">{entry.label}</span>
                <div className="tmenu__segmented" role="radiogroup" aria-label={entry.label}>
                  {entry.options.map((option) => (
                    <Tip key={option.label} label={option.label} placement="top">
                      <button
                        className={`tmenu__segment${option.active ? ' is-on' : ''}`}
                        data-nav
                        data-group={g}
                        role="radio"
                        aria-checked={option.active}
                        aria-label={option.label}
                        onMouseEnter={() => option.preview?.()}
                        onFocus={() => option.preview?.()}
                        onClick={() => {
                          option.run()
                          onClose()
                        }}
                      >
                        <Icon name={option.icon} size={14} />
                      </button>
                    </Tip>
                  ))}
                </div>
              </div>
            )
          }
          if (entry.kind === 'submenu') {
            const g = nextGroup()
            const open = sub?.index === i
            return (
              <button
                key={i}
                className={`tmenu__item${open ? ' is-open' : ''}`}
                data-nav
                data-group={g}
                data-submenu
                aria-haspopup="menu"
                aria-expanded={open}
                onMouseEnter={(event) => {
                  const r = event.currentTarget.getBoundingClientRect()
                  entry.idle()
                  setSub({ index: i, at: { x: position.x + (ref.current?.offsetWidth ?? 0) + 4, y: r.top - 5 }, keyboard: false })
                }}
                onClick={(event) => {
                  const r = event.currentTarget.getBoundingClientRect()
                  entry.idle()
                  setSub({
                    index: i,
                    at: { x: position.x + (ref.current?.offsetWidth ?? 0) + 4, y: r.top - 5 },
                    keyboard: event.detail === 0,
                  })
                }}
              >
                <span className="tmenu__item-icon">
                  <Icon name={entry.icon} size={15} />
                </span>
                <span className="tmenu__item-label">{entry.label}</span>
                <Icon name="chevron-right" size={13} className="tmenu__chevron" />
              </button>
            )
          }
          const g = nextGroup()
          return (
            <button
              key={i}
              className={`tmenu__item${entry.danger === true ? ' is-danger' : ''}`}
              data-nav
              data-group={g}
              role="menuitem"
              disabled={entry.disabled === true}
              onMouseEnter={() => {
                setSub(null)
                if (entry.preview !== undefined) entry.preview()
                else idle()
              }}
              onFocus={() => (entry.preview ?? idle)()}
              onClick={() => {
                // The action first: it writes the table, and closing then has
                // nothing left to write.
                entry.run()
                onClose()
              }}
            >
              <span className="tmenu__item-icon">
                <Icon name={entry.icon} size={15} />
              </span>
              <span className="tmenu__item-label">{entry.label}</span>
              {entry.shortcut !== undefined && <kbd className="tmenu__shortcut">{entry.shortcut}</kbd>}
            </button>
          )
        })}
      </div>
      {sub !== null &&
        (() => {
          const entry = entries[sub.index]
          if (entry?.kind !== 'submenu') return null
          return (
            <Panel
              entries={entry.entries}
              at={sub.at}
              besideLeft={position.x}
              idle={entry.idle}
              onClose={onClose}
              autoFocus={sub.keyboard}
              onBack={() => {
                setSub(null)
                idle()
                ;(
                  ref.current?.querySelectorAll<HTMLElement>('[data-submenu]')[
                    entries.slice(0, sub.index).filter((e) => e.kind === 'submenu').length
                  ] ?? null
                )?.focus()
              }}
            />
          )
        })()}
    </>
  )
}

/** A table menu at a point, closed by a press outside, Esc, a resize or the window losing focus. */
export function TableMenu({
  entries,
  at,
  idle,
  onClose,
  keyboard,
}: {
  entries: readonly MenuEntry[]
  at: { x: number; y: number }
  idle: () => void
  onClose: () => void
  keyboard: boolean
}): React.ReactElement {
  const layer = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const outside = (event: MouseEvent): void => {
      if (layer.current?.contains(event.target as Node) === true) return
      if ((event.target as HTMLElement).closest?.('.tmenu') != null) return
      onClose()
    }
    const close = (): void => onClose()
    // Esc closes it wherever the focus is - a menu opened with the mouse has
    // none - and before anything else uses the key: the menu is on top.
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if ((event.target as HTMLElement | null)?.closest?.('.tmenu') != null) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    // Keys and resizes at once; the press outside a moment later, so the press
    // that opened the menu does not close it.
    window.addEventListener('keydown', escape, true)
    window.addEventListener('resize', close)
    const timer = window.setTimeout(() => {
      window.addEventListener('mousedown', outside, true)
      window.addEventListener('blur', close)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mousedown', outside, true)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [onClose])
  return createPortal(
    <div ref={layer} className="tmenu-layer">
      <Panel entries={entries} at={at} idle={idle} onClose={onClose} autoFocus={keyboard} />
    </div>,
    document.body,
  )
}
