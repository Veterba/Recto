import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HotkeyEditor } from './HotkeyEditor'
import { ObsidianSync } from './ObsidianSync'
import { Icon } from '../../../ui/Icon'
import { SettingSearchContext } from '../../../ui/setting-search'
import { WritingSettingsTab } from './WritingSettings'
import { TopicsSettingsTab } from '../../topics'
import type { SettingsDeps } from '../settings-deps'
import { AppearanceSettings } from './AppearanceSettings'
import { EditorSettings } from './EditorSettings'
import { TemplateSettingsTab } from './TemplateSettings'
import { PeriodicSettingsTab } from './PeriodicSettings'
import { AiSettings } from './AiSettings'
import { VaultSettings } from './VaultSettings'
import { BotsSettings } from '../../bots'
import { clampInside, resizeFrom, type Bounds, type Edges, type Rect } from '../../../app/note-windows'

/**
 * Settings.
 *
 * A panel floating over the app, not a modal: no backdrop, and the app behind
 * it stays visible and usable, so a change shows where it lands while you make
 * it. Moved by its title bar, resized from its sides and corner, and put back
 * where it was next time.
 *
 * Every control writes through the same state the rest of the app reads, so
 * there is no "apply" button and nothing to get out of sync.
 */

export type SettingsTab =
  'appearance' | 'editor' | 'writing' | 'templates' | 'periodic' | 'topics' | 'obsidian' | 'ai' | 'bots' | 'shortcuts' | 'vault'

type Section = {
  id: SettingsTab
  label: string
  group: 'App' | 'Vault' | 'Connections'
  description: string
  badge?: string
  render: (deps: SettingsDeps) => React.ReactNode
  /**
   * Whether its rows show in search results. Shortcuts has its own search over
   * every command; Obsidian is a setup flow with no rows, and looks for vaults
   * on disk the moment it is on screen.
   */
  searchable: boolean
}

const SECTIONS: readonly Section[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    group: 'App',
    description: 'Theme, translucency and the sidebar.',
    render: (deps) => <AppearanceSettings {...deps} />,
    searchable: true,
  },
  {
    id: 'editor',
    label: 'Editor',
    group: 'App',
    description: 'How notes look while you edit them.',
    render: (deps) => <EditorSettings {...deps} />,
    searchable: true,
  },
  {
    id: 'writing',
    label: 'Writing',
    group: 'App',
    description: 'Focus mode and the writing tools: syntax, style, authors and spelling.',
    render: () => <WritingSettingsTab />,
    searchable: true,
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    group: 'App',
    description: 'Every command can have a key. A key that is taken is shown before it is saved.',
    render: () => <HotkeyEditor />,
    searchable: false,
  },
  {
    id: 'vault',
    label: 'Vault',
    group: 'Vault',
    description: 'This folder of notes, its attachments, deleted notes and the search index.',
    render: (deps) => <VaultSettings {...deps} />,
    searchable: true,
  },
  {
    id: 'templates',
    label: 'Templates',
    group: 'Vault',
    description: 'Notes that new notes start from.',
    render: (deps) => <TemplateSettingsTab {...deps} />,
    searchable: true,
  },
  {
    id: 'periodic',
    label: 'Periodic notes',
    group: 'Vault',
    description: "Daily, weekly, monthly and yearly notes. Today's note opens the shortest period that is on.",
    render: (deps) => <PeriodicSettingsTab {...deps} />,
    searchable: true,
  },
  {
    id: 'topics',
    label: 'Topics',
    group: 'Vault',
    description: 'Groups of similar notes, found from what they say.',
    render: () => <TopicsSettingsTab />,
    searchable: true,
  },
  {
    id: 'obsidian',
    label: 'Obsidian',
    group: 'Connections',
    description: 'Keep this vault and an Obsidian vault in sync, both ways.',
    render: () => <ObsidianSync />,
    searchable: false,
  },
  {
    id: 'ai',
    label: 'AI',
    group: 'Connections',
    description: 'Your Anthropic API key, for the API models.',
    render: (deps) => <AiSettings {...deps} />,
    searchable: true,
  },
  {
    id: 'bots',
    label: 'Bots',
    group: 'Connections',
    badge: 'Beta',
    description: 'Chat with your notes through a local model.',
    render: () => <BotsSettings />,
    searchable: true,
  },
]

const GROUPS = ['App', 'Vault', 'Connections'] as const

export const SETTINGS_PANEL_MIN: Bounds = { width: 460, height: 300 }
const DEFAULT_SIZE: Bounds = { width: 780, height: 560 }

const windowBounds = (): Bounds => ({ width: window.innerWidth, height: window.innerHeight })

/** Centred in the window, at its current size. */
function centred(size: Bounds): Rect {
  const bounds = windowBounds()
  const r = clampInside({ x: 0, y: 0, ...size }, bounds, SETTINGS_PANEL_MIN)
  return { ...r, x: Math.round((bounds.width - r.width) / 2), y: Math.round((bounds.height - r.height) / 2) }
}

const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

const RESIZE: readonly { name: string; edges: Edges }[] = [
  { name: 'left', edges: { left: true } },
  { name: 'right', edges: { right: true } },
  { name: 'bottom', edges: { bottom: true } },
  { name: 'corner', edges: { right: true, bottom: true } },
]

/** A field that has its own use for Esc: it is left to it rather than closing Settings. */
const usesEscape = (target: EventTarget): boolean =>
  target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]') !== null

export function SettingsPanel({
  onClose,
  initialTab,
  focusRequest,
  ...deps
}: SettingsDeps & {
  onClose: () => void
  initialTab?: SettingsTab | undefined
  /** Changes each time Settings is asked to open, so a second ⌘, focuses the open panel. */
  focusRequest: number
}): React.ReactElement {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'appearance')
  const [query, setQuery] = useState('')
  const panel = useRef<HTMLDivElement | null>(null)
  const { appearance, update } = deps
  const [rect, setRect] = useState<Rect>(() =>
    appearance.settingsPanel === null ? centred(DEFAULT_SIZE) : clampInside(appearance.settingsPanel, windowBounds(), SETTINGS_PANEL_MIN),
  )
  const rectRef = useRef(rect)
  rectRef.current = rect

  const save = (next: Rect): void => {
    if (appearance.settingsPanel === null || !sameRect(appearance.settingsPanel, next)) update({ settingsPanel: next })
  }

  // Asked to open while open, or opened on a particular section: go there and take focus.
  useLayoutEffect(() => {
    if (initialTab !== undefined) {
      setTab(initialTab)
      setQuery('')
    }
    panel.current?.focus()
    // Only on a new request: `initialTab` alone changing is part of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest])

  // Focus goes back to where it was when the panel closes. Read while
  // rendering, before the effect above has moved it into the panel.
  const [before] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  useEffect(
    () => () => {
      if (before !== null && before.isConnected) before.focus()
    },
    [before],
  )

  // The window shrinking must not strand the panel outside it.
  useEffect(() => {
    const onResize = (): void => {
      const next = clampInside(rectRef.current, windowBounds(), SETTINGS_PANEL_MIN)
      if (sameRect(next, rectRef.current)) return
      setRect(next)
      save(next)
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Follow the pointer from a press, and save where it ends up. */
  const track = (event: React.PointerEvent, move: (start: Rect, dx: number, dy: number) => Rect): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const start = rectRef.current
    const onMove = (ev: PointerEvent): void => setRect(move(start, ev.clientX - event.clientX, ev.clientY - event.clientY))
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('is-resizing')
      save(rectRef.current)
    }
    document.body.classList.add('is-resizing')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const go = (id: SettingsTab): void => {
    setTab(id)
    setQuery('')
  }

  const section = SECTIONS.find((s) => s.id === tab) ?? SECTIONS[0]!

  return createPortal(
    <>
      {/* The blur's opaque base: see .settings-panel__base in settings.css. */}
      <div
        className="settings-panel__base"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        aria-hidden="true"
      />
      <div
        className="settings-panel glass-surface"
        role="dialog"
        aria-label="Settings"
        ref={panel}
        tabIndex={-1}
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || usesEscape(event.target)) return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      >
        <header
          className="settings-panel__head"
          title="Drag to move · double-click to centre"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('button') !== null) return
            track(event, (start, dx, dy) => clampInside({ ...start, x: start.x + dx, y: start.y + dy }, windowBounds(), SETTINGS_PANEL_MIN))
          }}
          onDoubleClick={(event) => {
            if ((event.target as HTMLElement).closest('button') !== null) return
            const next = centred(rectRef.current)
            setRect(next)
            save(next)
          }}
        >
          <h2 className="settings-panel__title">Settings</h2>
          <button className="dialog__close" onClick={onClose} aria-label="Close settings">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="settings">
          <nav className="settings__nav">
            <label className="settings__search">
              <Icon name="search" size={13} />
              <input
                value={query}
                placeholder="Search settings"
                aria-label="Search settings"
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // Esc empties the search first; on an empty one it closes Settings.
                  if (event.key !== 'Escape') return
                  event.preventDefault()
                  event.stopPropagation()
                  if (query !== '') setQuery('')
                  else onClose()
                }}
              />
            </label>
            <div className="settings__tabs" role="tablist" aria-orientation="vertical" aria-label="Sections">
              {GROUPS.map((group) => (
                <div key={group} className="settings__navgroup" role="presentation">
                  <div className="settings__navhead" role="presentation">
                    {group}
                  </div>
                  {SECTIONS.filter((s) => s.group === group).map((item) => {
                    const active = query === '' && tab === item.id
                    return (
                      <button
                        key={item.id}
                        role="tab"
                        aria-selected={active}
                        className={`settings__tab${active ? ' is-active' : ''}`}
                        onClick={() => go(item.id)}
                      >
                        {item.label}
                        {item.badge !== undefined && <span className="settings__navbadge">{item.badge}</span>}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </nav>

          <div className="settings__body">
            {query.trim() === '' ? (
              <div className="settings__section" role="tabpanel" aria-label={section.label} key={section.id}>
                <h2 className="settings__title">{section.label}</h2>
                <p className="settings__lead">{section.description}</p>
                {section.render(deps)}
              </div>
            ) : (
              <SettingSearchContext.Provider value={query.trim()}>
                <div className="settings-results" aria-label="Search results">
                  <h2 className="settings__title">Results for “{query.trim()}”</h2>
                  {SECTIONS.filter((s) => s.searchable).map((s) => (
                    <section key={s.id} className="settings-results__section" aria-label={s.label}>
                      <button className="settings-results__head" onClick={() => go(s.id)}>
                        {s.label}
                        <Icon name="arrow-right" size={12} />
                      </button>
                      {s.render(deps)}
                    </section>
                  ))}
                  <p className="settings-results__empty">Nothing matches. Try another word.</p>
                </div>
              </SettingSearchContext.Provider>
            )}
          </div>
        </div>

        {RESIZE.map(({ name, edges }) => (
          <div
            key={name}
            className={`settings-panel__edge settings-panel__edge--${name}`}
            aria-hidden="true"
            onPointerDown={(event) => {
              event.stopPropagation()
              track(event, (start, dx, dy) => resizeFrom(start, edges, dx, dy, windowBounds(), SETTINGS_PANEL_MIN))
            }}
          />
        ))}
      </div>
    </>,
    document.body,
  )
}
