import { useCallback, useRef } from 'react'
import { formatChord } from '../core/hotkeys'
import { SECTIONS, type SectionId } from '../core/sections'
import { Icon } from './Icon'

/**
 * The whole left column: vault header, the three section tabs, a search box,
 * the section's list, and a footer.
 *
 * The section tabs live here rather than in a separate icon rail because
 * switching section switches the entire workspace - it is a mode change, and it
 * belongs at the top of the thing whose contents it changes.
 */

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 520

type Props = {
  vaultName: string
  activeSection: SectionId
  onSelectSection: (id: SectionId) => void
  query: string
  onQueryChange: (query: string) => void
  width: number
  onResize: (width: number) => void
  onNew: () => void
  onOpenSettings: () => void
  onCollapse: () => void
  children?: React.ReactNode
}

export function Sidebar({
  vaultName,
  activeSection,
  onSelectSection,
  query,
  onQueryChange,
  width,
  onResize,
  onNew,
  onOpenSettings,
  onCollapse,
  children,
}: Props): React.ReactElement {
  const searchRef = useRef<HTMLInputElement | null>(null)

  const startDrag = useCallback(
    (ev: React.PointerEvent) => {
      ev.preventDefault()
      const startX = ev.clientX
      const startWidth = width

      const onMove = (move: PointerEvent): void => {
        onResize(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + move.clientX - startX)))
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.classList.remove('is-resizing')
      }
      document.body.classList.add('is-resizing')
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [width, onResize],
  )

  const section = SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0]!

  return (
    <aside className="sidebar" style={{ width }} aria-label="Sidebar">
      <header className="sidebar__vault">
        <span className="sidebar__vault-name" title={vaultName}>
          {vaultName}
        </span>
        <button className="icon-btn" onClick={onCollapse} title={`Hide sidebar (${formatChord('Mod+B')})`}>
          <Icon name="panel-left-close" size={15} />
        </button>
      </header>

      <div className="segmented" role="tablist" aria-label="Workspace">
        {SECTIONS.map((item, i) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={item.id === activeSection}
            className={`segmented__tab${item.id === activeSection ? ' is-active' : ''}`}
            title={`${item.label} — ${formatChord(`Mod+${i + 1}`)}`}
            onClick={() => onSelectSection(item.id)}
          >
            <Icon name={item.icon} size={17} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="sidebar__search">
        <Icon name="search" size={14} className="sidebar__search-icon" />
        <input
          ref={searchRef}
          className="sidebar__search-input"
          type="search"
          spellCheck={false}
          placeholder={section.searchPlaceholder}
          value={query}
          onChange={(ev) => onQueryChange(ev.target.value)}
          onKeyDown={(ev) => {
            ev.stopPropagation()
            if (ev.key === 'Escape') onQueryChange('')
          }}
        />
      </div>

      <div className="sidebar__body">{children}</div>

      <footer className="sidebar__footer">
        <button className="sidebar__new" onClick={onNew}>
          <Icon name="plus" size={15} />
          <span>{section.newLabel}</span>
        </button>
        <button className="icon-btn" onClick={onOpenSettings} title="Settings">
          <Icon name="settings" size={15} />
        </button>
      </footer>

      <div
        className="sidebar__resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={startDrag}
      />
    </aside>
  )
}

/** The thin strip that brings the sidebar back when it is collapsed. */
export function SidebarStub({ onExpand }: { onExpand: () => void }): React.ReactElement {
  return (
    <div className="sidebar-stub">
      <button className="icon-btn" onClick={onExpand} title={`Show sidebar (${formatChord('Mod+B')})`}>
        <Icon name="panel-left-open" size={16} />
      </button>
    </div>
  )
}
