import { useCallback, useRef } from 'react'
import { formatChord } from '../core/hotkeys'
import { SECTIONS, type SectionId } from '../core/sections'
import { Icon } from './Icon'
import { Tip } from './Tip'

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
  /** Only the Data section has folders; omitted elsewhere. */
  onNewFolder?: (() => void) | undefined
  onExpandAll?: (() => void) | undefined
  onCollapseAll?: (() => void) | undefined
  onOpenArchive: () => void
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
  onNewFolder,
  onExpandAll,
  onCollapseAll,
  onOpenArchive,
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
        <Tip label="Hide sidebar" hint={formatChord('Mod+B')}>
          <button className="icon-btn" onClick={onCollapse} aria-label="Hide sidebar">
            <Icon name="panel-left-close" size={15} />
          </button>
        </Tip>
      </header>

      <div className="segmented" role="tablist" aria-label="Workspace">
        {SECTIONS.map((item, i) => (
          <Tip key={item.id} label={item.label} hint={formatChord(`Mod+${i + 1}`)}>
            <button
              role="tab"
              aria-selected={item.id === activeSection}
              className={`segmented__tab${item.id === activeSection ? ' is-active' : ''}`}
              onClick={() => onSelectSection(item.id)}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
            </button>
          </Tip>
        ))}
      </div>

      <div className="sidebar__searchrow">
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

        {/* Folder state only. Nothing is opened in the editor - these move the
            tree, not the workspace. */}
        {onExpandAll !== undefined && (
          <Tip label="Expand all folders" hint="Sidebar only — opens nothing">
            <button className="icon-btn icon-btn--sm" onClick={onExpandAll} aria-label="Expand all folders">
              <Icon name="chevrons-up-down" size={14} />
            </button>
          </Tip>
        )}
        {onCollapseAll !== undefined && (
          <Tip label="Collapse all folders" hint="Sidebar only — closes nothing">
            <button className="icon-btn icon-btn--sm" onClick={onCollapseAll} aria-label="Collapse all folders">
              <Icon name="chevrons-down-up" size={14} />
            </button>
          </Tip>
        )}
      </div>

      <div className="sidebar__body">{children}</div>

      {/* One row, one button shape. The old version mixed labelled buttons with
          bare icons at two different sizes, which read as three separate bars
          crammed together. */}
      <footer className="sidebar__footer">
        <Tip label={`New ${section.newLabel.toLowerCase()}`}>
          <button className="footer-btn" onClick={onNew}>
            <Icon name="plus" size={15} />
            <span>{section.newLabel}</span>
          </button>
        </Tip>
        {onNewFolder !== undefined && (
          <Tip label="New folder">
            <button className="footer-btn" onClick={onNewFolder}>
              <Icon name="folder-plus" size={15} />
              <span>Folder</span>
            </button>
          </Tip>
        )}
        <span className="sidebar__footer-gap" />
        <Tip label="Archive" hint="Deleted notes, kept for 10 days">
          <button className="footer-btn footer-btn--icon" onClick={onOpenArchive} aria-label="Archive">
            <Icon name="archive" size={15} />
          </button>
        </Tip>
        <Tip label="Settings">
          <button className="footer-btn footer-btn--icon" onClick={onOpenSettings} aria-label="Settings">
            <Icon name="settings" size={15} />
          </button>
        </Tip>
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
      <Tip label="Show sidebar" hint={formatChord('Mod+B')} placement="right">
        <button className="icon-btn" onClick={onExpand} aria-label="Show sidebar">
          <Icon name="panel-left-open" size={16} />
        </button>
      </Tip>
    </div>
  )
}
