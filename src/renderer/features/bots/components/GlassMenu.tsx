import { useEffect, useRef, useState } from 'react'

/**
 * A menu that floats over the conversation on the glass surface, opening up
 * from the composer: the + menu and the model menu. Arrow keys move, Enter
 * picks, Esc or a click elsewhere closes.
 */

export type GlassMenuEntry =
  | {
      kind: 'item'
      key: string
      label: string
      /** A second, muted line. */
      sub?: string
      /** Left of the label: a check on the current choice, or a glyph. */
      mark?: string
      /** At the right: a size, a shortcut, or an action ("Download · 8 GB"). */
      right?: string
      rightAction?: boolean
      disabled?: boolean
      run: () => void
    }
  | { kind: 'head'; label: string }
  | { kind: 'sep' }

type Props = {
  entries: readonly GlassMenuEntry[]
  className: string
  label: string
  onClose: () => void
  /** Something under the items (a confirm line, a download's progress). */
  footer?: React.ReactNode
}

export function GlassMenu({ entries, className, label, onClose, footer }: Props): React.ReactElement {
  const box = useRef<HTMLDivElement | null>(null)
  const items = entries.flatMap((e) => (e.kind === 'item' && e.disabled !== true ? [e.key] : []))
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    box.current?.focus()
    const outside = (event: PointerEvent): void => {
      const target = event.target as Element | null
      // The button that opened the menu toggles it itself.
      if (box.current?.contains(target) !== true && target?.closest('[data-menu-anchor]') === null) onClose()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [onClose])

  return (
    <div
      ref={box}
      className={`glass-menu glass-surface ${className}`}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const at = active === null ? -1 : items.indexOf(active)
          const step = event.key === 'ArrowDown' ? 1 : -1
          setActive(items[(at + step + items.length) % items.length] ?? null)
        } else if (event.key === 'Enter' && active !== null) {
          event.preventDefault()
          const entry = entries.find((e) => e.kind === 'item' && e.key === active)
          if (entry?.kind === 'item') entry.run()
        }
      }}
    >
      {entries.map((entry, i) => {
        if (entry.kind === 'head')
          return (
            <div key={i} className="glass-menu__head">
              {entry.label}
            </div>
          )
        if (entry.kind === 'sep') return <div key={i} className="glass-menu__sep" role="separator" />
        return (
          <button
            key={entry.key}
            className={`glass-menu__item${active === entry.key ? ' is-active' : ''}`}
            role="menuitem"
            disabled={entry.disabled === true}
            onMouseEnter={() => entry.disabled !== true && setActive(entry.key)}
            onClick={entry.run}
          >
            <span className="glass-menu__mark">{entry.mark ?? ''}</span>
            <span className="glass-menu__label">
              <b>{entry.label}</b>
              {entry.sub !== undefined && <span>{entry.sub}</span>}
            </span>
            {entry.right !== undefined && (
              <span className={`glass-menu__right${entry.rightAction === true ? ' is-action' : ''}`}>{entry.right}</span>
            )}
          </button>
        )
      })}
      {footer}
    </div>
  )
}
