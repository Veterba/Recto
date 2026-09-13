import { useEffect, useState } from 'react'
import type { ArchiveState, IndexStats, VaultInfo } from '@shared/ipc-contract'
import { api } from '../api'
import { HotkeyEditor } from '../components/HotkeyEditor'
import { Icon } from '../components/Icon'
import type { Appearance } from '../core/appearance'
import { registerView } from '../core/view-registry'

/**
 * Settings.
 *
 * A registered view like everything else, so it opens in a tab or a split and
 * takes part in the workspace rather than being a modal that blocks the app.
 *
 * Every control writes through the same state the rest of the app reads, so
 * there is no "apply" button and nothing to get out of sync.
 */

type Tab = 'appearance' | 'editor' | 'shortcuts' | 'vault'

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'vault', label: 'Vault' },
]

/** Hues spaced around the wheel; accent saturation and lightness stay fixed. */
const HUES = [258, 222, 190, 160, 130, 45, 25, 350, 320, 288]

type Deps = {
  appearance: Appearance
  update: (patch: Partial<Appearance>) => void
  vault: VaultInfo
  onCloseVault: () => void
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="setting">
      <div className="setting__text">
        <span className="setting__label">{label}</span>
        {hint !== undefined && <span className="setting__hint">{hint}</span>}
      </div>
      <div className="setting__control">{children}</div>
    </div>
  )
}

function Appearance_({ appearance, update }: Deps): React.ReactElement {
  return (
    <>
      <Row label="Theme" hint="System follows macOS; a choice here overrides it.">
        <div className="segmented segmented--inline">
          {(['system', 'light', 'dark'] as const).map((theme) => (
            <button
              key={theme}
              className={`segmented__tab${appearance.theme === theme ? ' is-active' : ''}`}
              onClick={() => update({ theme })}
            >
              <span>{theme}</span>
            </button>
          ))}
        </div>
      </Row>

      <Row label="Accent" hint="One hue drives every accent in the app.">
        <div className="hues">
          {HUES.map((hue) => (
            <button
              key={hue}
              className={`hue${appearance.accentHue === hue ? ' is-active' : ''}`}
              style={{ background: `hsl(${hue} 88% 68%)` }}
              aria-label={`Hue ${hue}`}
              onClick={() => update({ accentHue: hue })}
            />
          ))}
        </div>
      </Row>
    </>
  )
}

function EditorSettings({ appearance, update }: Deps): React.ReactElement {
  return (
    <>
      <Row label="Live Preview" hint="Hide markdown markers until the cursor reaches the line.">
        <button
          className={`toggle${appearance.livePreview ? ' is-on' : ''}`}
          role="switch"
          aria-checked={appearance.livePreview}
          onClick={() => update({ livePreview: !appearance.livePreview })}
        >
          <span className="toggle__knob" />
        </button>
      </Row>

      <Row label="Font" hint="Monospace suits source; serif suits long-form reading.">
        <div className="segmented segmented--inline">
          {(['mono', 'sans', 'serif'] as const).map((font) => (
            <button
              key={font}
              className={`segmented__tab${appearance.editorFont === font ? ' is-active' : ''}`}
              onClick={() => update({ editorFont: font })}
            >
              <span>{font}</span>
            </button>
          ))}
        </div>
      </Row>

      <Row label="Font size" hint={`${appearance.fontSize}px`}>
        <input
          className="slider"
          type="range"
          min={11}
          max={24}
          step={1}
          value={appearance.fontSize}
          onChange={(event) => update({ fontSize: Number(event.target.value) })}
        />
      </Row>
    </>
  )
}

function VaultSettings({ vault, onCloseVault }: Deps): React.ReactElement {
  const [stats, setStats] = useState<IndexStats | null>(null)
  const [archive, setArchive] = useState<ArchiveState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.invoke('index:stats').then(setStats)
    void api.invoke('archive:list').then(setArchive)
  }, [])

  return (
    <>
      <Row label="Vault" hint={vault.path}>
        <div className="setting__buttons">
          <button className="btn btn--ghost btn--sm" onClick={() => void api.invoke('fs:reveal', '')}>
            Show in Finder
          </button>
          <button className="btn btn--ghost btn--sm" onClick={onCloseVault}>
            Close vault
          </button>
        </div>
      </Row>

      <Row
        label="Keep deleted notes for"
        hint="Then they go to the system trash, still recoverable in Finder."
      >
        <div className="setting__buttons">
          {[7, 10, 30, 90, 0].map((days) => (
            <button
              key={days}
              className={`chip${archive?.retentionDays === days ? ' is-active' : ''}`}
              onClick={() => void api.invoke('archive:set-retention', days).then(setArchive)}
            >
              {days === 0 ? 'Forever' : `${days} days`}
            </button>
          ))}
        </div>
      </Row>

      <Row
        label="Search index"
        hint={
          stats === null
            ? 'Reading…'
            : `${stats.notes} notes · ${stats.links} links · ${stats.unresolved} unresolved · ${stats.tags} tags`
        }
      >
        <button
          className="btn btn--ghost btn--sm"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void api.invoke('index:reindex').then(async () => {
              setStats(await api.invoke('index:stats'))
              setBusy(false)
            })
          }}
        >
          {busy ? 'Rebuilding…' : 'Rebuild index'}
        </button>
      </Row>

      <p className="setting__note">
        <Icon name="history" size={13} />
        The index and version history live in <code>.recto/index.db</code>. Deleting it
        rebuilds the index from your notes — but loses version history, which cannot be rebuilt
        because it is what your files <em>used</em> to be.
      </p>
    </>
  )
}

function Settings(deps: Deps): React.ReactElement {
  const [tab, setTab] = useState<Tab>('appearance')

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
        {tab === 'appearance' && <Appearance_ {...deps} />}
        {tab === 'editor' && <EditorSettings {...deps} />}
        {tab === 'shortcuts' && <HotkeyEditor />}
        {tab === 'vault' && <VaultSettings {...deps} />}
      </div>
    </div>
  )
}

export function registerSettingsView(getDeps: () => Deps): () => void {
  return registerView({
    type: 'settings',
    title: 'Settings',
    icon: 'settings',
    render: () => <Settings {...getDeps()} />,
  })
}
