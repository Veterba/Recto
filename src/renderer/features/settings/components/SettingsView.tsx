import { useEffect, useRef, useState } from 'react'
import { HotkeyEditor } from './HotkeyEditor'
import { ObsidianSync } from './ObsidianSync'
import { Icon } from '../../../ui/Icon'
import { createPortal } from 'react-dom'
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

/**
 * Settings.
 *
 * A dialog, not a view: it opens over whatever you were doing and
 * takes part in the workspace rather than being a modal that blocks the app.
 *
 * Every control writes through the same state the rest of the app reads, so
 * there is no "apply" button and nothing to get out of sync.
 */

export type SettingsTab =
  'appearance' | 'editor' | 'writing' | 'templates' | 'periodic' | 'topics' | 'obsidian' | 'ai' | 'bots' | 'shortcuts' | 'vault'

const TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'writing', label: 'Writing' },
  { id: 'templates', label: 'Templates' },
  { id: 'periodic', label: 'Periodic notes' },
  { id: 'topics', label: 'Topics' },
  { id: 'obsidian', label: 'Obsidian' },
  { id: 'ai', label: 'AI' },
  { id: 'bots', label: 'Bots' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'vault', label: 'Vault' },
]

function Settings({ initialTab, ...deps }: SettingsDeps & { initialTab?: SettingsTab | undefined }): React.ReactElement {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'appearance')

  return (
    <div className="settings">
      <nav className="settings__tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            className={`settings__tab${tab === item.id ? ' is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="settings__body">
        {tab === 'appearance' && <AppearanceSettings {...deps} />}
        {tab === 'editor' && <EditorSettings {...deps} />}
        {tab === 'writing' && <WritingSettingsTab />}
        {tab === 'templates' && <TemplateSettingsTab {...deps} />}
        {tab === 'periodic' && <PeriodicSettingsTab {...deps} />}
        {tab === 'topics' && <TopicsSettingsTab />}
        {tab === 'obsidian' && <ObsidianSync />}
        {tab === 'ai' && <AiSettings {...deps} />}
        {tab === 'bots' && <BotsSettings />}
        {tab === 'shortcuts' && <HotkeyEditor />}
        {tab === 'vault' && <VaultSettings {...deps} />}
      </div>
    </div>
  )
}

/**
 * Settings, as a dialog.
 *
 * It used to open as a tab, which meant settings took a workspace slot, sat in
 * `workspace.json`, and could be left open in a split beside a note. Nothing
 * about changing a font size wants to persist across restarts or share the
 * screen - it is a thing you open, change, and close. `⌘,` like every other
 * Mac app.
 */
export function SettingsDialog({
  onClose,
  initialTab,
  ...deps
}: SettingsDeps & { onClose: () => void; initialTab?: SettingsTab | undefined }): React.ReactElement {
  const sheet = useRef<HTMLDivElement | null>(null)
  /*
   * Take focus when it opens.
   *
   * macOS does not focus a button when you click it, so opening settings from
   * the gear left the keyboard on `<body>` - outside this element - and Escape,
   * which is handled here, never arrived. A modal that cannot be dismissed by
   * the key every Mac dialog is dismissed by reads as stuck.
   */
  useEffect(() => sheet.current?.focus(), [])
  return createPortal(
    <div
      className="dialog__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="dialog dialog--settings"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        ref={sheet}
        tabIndex={-1}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') onClose()
        }}
      >
        <header className="dialog__head">
          <h2 className="dialog__title">Settings</h2>
          <button className="dialog__close" onClick={onClose} aria-label="Close settings">
            <Icon name="x" size={16} />
          </button>
        </header>
        <Settings {...deps} initialTab={initialTab} />
      </div>
    </div>,
    document.body,
  )
}
