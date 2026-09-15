import { useEffect, useState } from 'react'
import { AI_MODELS, ATTACHMENTS_FOLDER, type ArchiveState, type IndexStats, type RecentVault, type VaultInfo } from '@shared/ipc-contract'
import { api } from '../api'
import { HotkeyEditor } from '../components/HotkeyEditor'
import { ObsidianSync } from '../components/ObsidianSync'
import { Icon } from '../components/Icon'
import { PREVIEW_DELAY_MAX, PREVIEW_DELAY_MIN, type Appearance } from '../core/appearance'
import { dailyNotePath, isInFolder, normaliseFolder, templateName, type TemplateSettings } from '../core/templates'
import { createPortal } from 'react-dom'

/**
 * Settings.
 *
 * A dialog, not a view: it opens over whatever you were doing and
 * takes part in the workspace rather than being a modal that blocks the app.
 *
 * Every control writes through the same state the rest of the app reads, so
 * there is no "apply" button and nothing to get out of sync.
 */

type Tab = 'appearance' | 'editor' | 'templates' | 'obsidian' | 'ai' | 'shortcuts' | 'vault'

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'templates', label: 'Templates' },
  { id: 'obsidian', label: 'Obsidian' },
  { id: 'ai', label: 'AI' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'vault', label: 'Vault' },
]

type Deps = {
  appearance: Appearance
  update: (patch: Partial<Appearance>) => void
  vault: VaultInfo
  onCloseVault: () => void
  onSwitchVault: (target: string | null) => Promise<string | null>
  templates: TemplateSettings
  updateTemplates: (next: TemplateSettings) => void
  /** Every note in the vault, so the tab can list what is in the templates folder. */
  notes: readonly string[]
  /** Files in the attachments folder, which the Data tree does not show. */
  attachments: readonly string[]
  openDailyNote: () => void
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

/** A named group of settings. One heading, one hairline, no accordion. */
function Group({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="settings__group">
      <h3 className="settings__grouphead">{title}</h3>
      {children}
    </section>
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

      <Row
        label="Translucency"
        hint={
          /Mac OS X/.test(navigator.userAgent)
            ? 'Blur the desktop through the sidebar. How far it goes is set by the theme.'
            : 'macOS only — this platform has no window vibrancy.'
        }
      >
        <button
          className={`toggle${appearance.translucent ? ' is-on' : ''}`}
          role="switch"
          aria-checked={appearance.translucent}
          disabled={!/Mac OS X/.test(navigator.userAgent)}
          onClick={() => update({ translucent: !appearance.translucent })}
        >
          <span className="toggle__knob" />
        </button>
      </Row>

      {appearance.translucent && (
        <p className="setting__note">
          <Icon name="panel-left-close" size={13} />
          How far it goes is the theme's call, not a slider: a dark panel on a light page can be
          almost entirely backdrop and still read, a light panel on a dark one cannot. Full screen
          switches it off while it lasts — there is no desktop behind a full-screen window, only a
          black space.
        </p>
      )}

      <Group title="Sidebar">
        <Row
          label="Text size"
          hint={`${Math.round(13 * appearance.sidebarScale)}px file names — the editor's own size is under Editor`}
        >
          <input
            className="slider"
            type="range"
            min={0.9}
            max={1.25}
            step={0.05}
            value={appearance.sidebarScale}
            onChange={(event) => update({ sidebarScale: Number(event.target.value) })}
          />
        </Row>

        <Row
          label="Note preview delay"
          hint={`${appearance.previewDelay.toFixed(1)} s resting on a note before its preview opens`}
        >
          <input
            className="slider"
            type="range"
            min={PREVIEW_DELAY_MIN}
            max={PREVIEW_DELAY_MAX}
            step={0.5}
            value={appearance.previewDelay}
            aria-label="Note preview delay"
            onChange={(event) => update({ previewDelay: Number(event.target.value) })}
          />
        </Row>

        <Row label="Bolder text" hint="A frosted panel eats stroke weight; this puts it back.">
          <button
            className={`toggle${appearance.sidebarBold ? ' is-on' : ''}`}
            role="switch"
            aria-checked={appearance.sidebarBold}
            onClick={() => update({ sidebarBold: !appearance.sidebarBold })}
          >
            <span className="toggle__knob" />
          </button>
        </Row>

        <Row
          label="Brightness"
          hint={
            appearance.sidebarContrast >= 95
              ? 'As white as it goes — over a pale backdrop this starts to glow rather than read'
              : `${appearance.sidebarContrast}% — how white the file names are against the panel`
          }
        >
          <input
            className="slider"
            type="range"
            min={0}
            max={100}
            step={5}
            value={appearance.sidebarContrast}
            onChange={(event) => update({ sidebarContrast: Number(event.target.value) })}
          />
        </Row>
      </Group>
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

      <Row
        label="Heading font"
        hint="Match uses the body font. A serif over a sans reads well."
      >
        <div className="segmented segmented--inline">
          {(['match', 'mono', 'sans', 'serif'] as const).map((font) => (
            <button
              key={font}
              className={`segmented__tab${appearance.headingFont === font ? ' is-active' : ''}`}
              onClick={() => update({ headingFont: font })}
            >
              <span>{font}</span>
            </button>
          ))}
        </div>
      </Row>

      <Row
        label="Heading size"
        hint={`${appearance.headingScale.toFixed(2)}× per level — H1 is ${Math.round(
          appearance.fontSize * appearance.headingScale ** 3,
        )}px against ${appearance.fontSize}px body`}
      >
        <input
          className="slider"
          type="range"
          min={1}
          max={1.6}
          step={0.05}
          value={appearance.headingScale}
          onChange={(event) => update({ headingScale: Number(event.target.value) })}
        />
      </Row>

      <Row label="Note name" hint="The note's name, centred above its text. Edit it there to rename the note.">
        <button
          className={`toggle${appearance.showNoteTitle ? ' is-on' : ''}`}
          role="switch"
          aria-checked={appearance.showNoteTitle}
          aria-label="Show note name"
          onClick={() => update({ showNoteTitle: !appearance.showNoteTitle })}
        >
          <span className="toggle__knob" />
        </button>
      </Row>

      <Row label="Vim mode" hint="Modal editing. Esc for normal mode, :w saves.">
        <button
          className={`toggle${appearance.vimMode ? ' is-on' : ''}`}
          role="switch"
          aria-checked={appearance.vimMode}
          onClick={() => update({ vimMode: !appearance.vimMode })}
        >
          <span className="toggle__knob" />
        </button>
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

/**
 * A vault-relative folder, typed and committed on Enter or blur.
 *
 * Not committed per keystroke: every change creates the folder if it is new,
 * so typing "Templates" letter by letter would leave T/, Te/, Tem/... behind.
 */
function FolderField({
  value,
  onCommit,
  label,
}: {
  value: string
  onCommit: (folder: string) => void
  label: string
}): React.ReactElement {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const normalised = normaliseFolder(draft)
  const invalid = draft.trim() !== '' && normalised === null

  const commit = (): void => {
    if (normalised === null) {
      setDraft(value)
      return
    }
    // Only the case differs from what is set: on a Mac disk that IS the same
    // folder, so nothing changes - and the field shows the folder's real name
    // rather than keeping the spelling that was typed.
    if (normalised.toLowerCase() === value.toLowerCase()) setDraft(value)
    else onCommit(normalised)
  }

  return (
    <input
      className={`dialog__input setting__path${invalid ? ' is-invalid' : ''}`}
      value={draft}
      spellCheck={false}
      autoComplete="off"
      aria-label={label}
      aria-invalid={invalid}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

/**
 * Templates: where they live, and the daily note made from one.
 *
 * The folder is a real, visible folder in the vault - templates are notes you
 * write and edit like any other, so hiding them would only make them harder to
 * find. The daily note is the one template the app uses on its own.
 */
function TemplateSettingsTab({ templates, updateTemplates, notes, openDailyNote }: Deps): React.ReactElement {
  const inFolder = notes.filter((path) => isInFolder(path, templates.folder))
  /** Whether the chosen daily template has anything in it. */
  const [chosenEmpty, setChosenEmpty] = useState(false)
  useEffect(() => {
    const chosen = templates.daily.template
    if (chosen === null) {
      setChosenEmpty(false)
      return
    }
    let cancelled = false
    void api.invoke('fs:read', chosen).then((result) => {
      if (!cancelled) setChosenEmpty(result.ok && result.content.trim() === '')
    })
    return () => {
      cancelled = true
    }
  }, [templates.daily.template])
  const today = dailyNotePath(new Date(), templates.daily.folder)
  const setDaily = (patch: Partial<TemplateSettings['daily']>): void =>
    updateTemplates({ ...templates, daily: { ...templates.daily, ...patch } })

  return (
    <>
      <Row
        label="Templates folder"
        hint={
          inFolder.length === 0
            ? 'In your vault, next to your notes. Empty so far — any note you put here becomes a template.'
            : `${inFolder.length} ${inFolder.length === 1 ? 'template' : 'templates'} here. Insert one into any note with ⌘⇧T.`
        }
      >
        <FolderField
          value={templates.folder}
          label="Templates folder"
          onCommit={(folder) => updateTemplates({ ...templates, folder })}
        />
      </Row>

      <p className="setting__note">
        <Icon name="layout-template" size={13} />
        Changing the folder points Recto at a different one; it does not move the templates you already
        have. Placeholders filled in on insert: <code>{'{{date}}'}</code>, <code>{'{{time}}'}</code>,{' '}
        <code>{'{{title}}'}</code>, <code>{'{{date:+7}}'}</code>.
      </p>

      <Group title="Daily note">
        <Row
          label="Make a note every day"
          hint="Created automatically the first time Recto is open on a new day. It is not opened for you."
        >
          <button
            className={`toggle${templates.daily.enabled ? ' is-on' : ''}`}
            role="switch"
            aria-checked={templates.daily.enabled}
            aria-label="Daily note"
            onClick={() => setDaily({ enabled: !templates.daily.enabled })}
          >
            <span className="toggle__knob" />
          </button>
        </Row>

        {templates.daily.enabled && (
          <>
            <Row
              label="Template"
              hint={
                chosenEmpty
                  ? `${templateName(templates.daily.template ?? '')} is empty — daily notes use the built-in heading until you write something in it.`
                  : "Which template today's note starts from."
              }
            >
              <select
                className="setting__select"
                value={templates.daily.template ?? ''}
                aria-label="Daily note template"
                onChange={(event) => setDaily({ template: event.target.value === '' ? null : event.target.value })}
              >
                <option value="">Built-in — just the date as a heading</option>
                {inFolder.map((path) => (
                  <option key={path} value={path}>
                    {templateName(path)}
                  </option>
                ))}
                {/* A chosen template that is no longer in the folder still shows
                    as selected, rather than the select silently reading "Built-in". */}
                {templates.daily.template !== null && !inFolder.includes(templates.daily.template) && (
                  <option value={templates.daily.template}>{templateName(templates.daily.template)} (missing)</option>
                )}
              </select>
            </Row>

            <Row label="Folder" hint="Year, month and week folders are made inside it as the days go by.">
              <FolderField
                value={templates.daily.folder}
                label="Daily notes folder"
                onCommit={(folder) => setDaily({ folder })}
              />
            </Row>

            <div className="daily__preview">
              <span className="daily__label">Today's note</span>
              <code className="daily__path">{today.path}</code>
              <button className="btn btn--ghost btn--sm" onClick={openDailyNote}>
                <Icon name="calendar-days" size={13} />
                Open
              </button>
            </div>
          </>
        )}
      </Group>
    </>
  )
}

/**
 * The API key, and what the app will do with it.
 *
 * The key goes in and never comes back out: there is no IPC channel that
 * returns it, so this screen can show a masked hint and nothing more. Saving
 * hands it to main, which encrypts it into the OS keychain outside the vault -
 * a vault is a folder people push to git, and a secret in one is a secret
 * published.
 */
function AiSettings({ appearance, update }: Deps): React.ReactElement {
  const [status, setStatus] = useState<{ present: boolean; hint: string | null; available: boolean } | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const refresh = (): void => {
    void api.invoke('ai:key-status').then(setStatus)
  }
  useEffect(refresh, [])

  const save = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    const saved = await api.invoke('ai:set-key', draft)
    if (!saved.ok) {
      setResult({ ok: false, text: saved.error ?? 'Could not save the key.' })
      setBusy(false)
      return
    }
    setDraft('')
    refresh()
    // Saving and then finding out it was wrong an hour later is the failure
    // this avoids: one token, one round trip, an answer now.
    const tested = await api.invoke('ai:test', appearance.aiModel)
    setResult(tested.ok ? { ok: true, text: 'Saved and working.' } : { ok: false, text: tested.error ?? 'The key was saved but the test failed.' })
    setBusy(false)
  }

  return (
    <>
      <Row
        label="Anthropic API key"
        hint={
          status === null
            ? 'Checking…'
            : status.present
              ? `Saved as ${status.hint} — in your login keychain, not in the vault.`
              : status.available
                ? 'Bring your own key. It is encrypted into your login keychain and never leaves this machine.'
                : 'This system has no secure storage, so a key cannot be saved here.'
        }
      >
        {status?.present === true ? (
          <div className="setting__buttons">
            <button
              className="btn btn--ghost btn--sm"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void api.invoke('ai:test', appearance.aiModel).then((tested) => {
                  setResult(tested.ok ? { ok: true, text: 'Working.' } : { ok: false, text: tested.error ?? 'Failed.' })
                  setBusy(false)
                })
              }}
            >
              {busy ? 'Testing…' : 'Test'}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                void api.invoke('ai:clear-key').then(() => {
                  setResult(null)
                  refresh()
                })
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="setting__buttons">
            <input
              className="dialog__input"
              type="password"
              value={draft}
              spellCheck={false}
              autoComplete="off"
              placeholder="sk-ant-…"
              aria-label="Anthropic API key"
              disabled={status?.available === false}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter' && draft.trim() !== '') void save()
              }}
            />
            <button className="btn btn--primary btn--sm" disabled={busy || draft.trim() === ''} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </Row>

      {result !== null && (
        <p className={`setting__note${result.ok ? '' : ' setting__note--bad'}`}>
          <Icon name={result.ok ? 'check' : 'alert-triangle'} size={13} />
          {result.text}
        </p>
      )}

      <Row label="Model" hint={AI_MODELS.find((model) => model.id === appearance.aiModel)?.blurb ?? ''}>
        <div className="segmented segmented--inline">
          {AI_MODELS.map((model) => (
            <button
              key={model.id}
              className={`segmented__tab${appearance.aiModel === model.id ? ' is-active' : ''}`}
              onClick={() => update({ aiModel: model.id })}
            >
              <span>{model.label}</span>
            </button>
          ))}
        </div>
      </Row>

      <p className="setting__note">
        <Icon name="sparkles" size={13} />
        Every conversation is saved as a markdown note in <code>chats/</code>, so it is searchable,
        linkable and readable without this app. Nothing is sent anywhere until you send it: there is
        no telemetry, and the key goes straight from this machine to Anthropic over TLS with no relay
        of ours in between.
      </p>
    </>
  )
}

function VaultSettings({ vault, onCloseVault, onSwitchVault, attachments }: Deps): React.ReactElement {
  const [stats, setStats] = useState<IndexStats | null>(null)
  const [archive, setArchive] = useState<ArchiveState | null>(null)
  const [recent, setRecent] = useState<readonly RecentVault[]>([])
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.invoke('index:stats').then(setStats)
    void api.invoke('archive:list').then(setArchive)
    void api.invoke('vault:recent').then(setRecent)
  }, [])

  const switchTo = (target: string | null): void => {
    setSwitchError(null)
    setSwitching(true)
    void onSwitchVault(target).then((error) => {
      // On success this component is already gone with the old vault's shell.
      setSwitching(false)
      setSwitchError(error)
    })
  }

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

      <Row label="Change vault" hint="Open another folder of notes. Unsaved edits are saved to this vault first.">
        <button className="btn btn--sm" disabled={switching} onClick={() => switchTo(null)}>
          {switching ? 'Opening…' : 'Open another folder…'}
        </button>
      </Row>
      {recent.length > 0 && (
        <div className="vault-recent" role="list" aria-label="Recent vaults">
          {recent.map((item) => (
            <button
              key={item.path}
              role="listitem"
              className="vault-recent__item"
              disabled={!item.available || switching}
              onClick={() => switchTo(item.path)}
              title={item.available ? `Switch to ${item.path}` : `${item.path} — not found`}
            >
              <Icon name="folder" size={15} />
              <span className="vault-recent__name">{item.name}</span>
              <span className="vault-recent__path">{item.available ? item.path : 'Not found'}</span>
              <Icon name="arrow-right" size={13} className="vault-recent__go" />
            </button>
          ))}
        </div>
      )}
      {switchError !== null && (
        <p className="setting__note setting__note--error" role="alert">
          <Icon name="alert-triangle" size={13} />
          {switchError}
        </p>
      )}

      <Row
        label="Attachments"
        hint={
          attachments.length === 0
            ? `Images you paste or drop into notes are kept in ${ATTACHMENTS_FOLDER}/. Nothing there yet.`
            : `${attachments.length} ${attachments.length === 1 ? 'file' : 'files'} in ${ATTACHMENTS_FOLDER}/ — images you pasted or dropped into notes. Kept out of the sidebar.`
        }
      >
        <button
          className="btn btn--ghost btn--sm"
          disabled={attachments.length === 0}
          onClick={() => void api.invoke('fs:reveal', ATTACHMENTS_FOLDER)}
        >
          Show in Finder
        </button>
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
        {tab === 'templates' && <TemplateSettingsTab {...deps} />}
        {tab === 'obsidian' && <ObsidianSync />}
        {tab === 'ai' && <AiSettings {...deps} />}
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
export function SettingsDialog({ onClose, ...deps }: Deps & { onClose: () => void }): React.ReactElement {
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
        <Settings {...deps} />
      </div>
    </div>,
    document.body,
  )
}
