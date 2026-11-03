import { useEffect, useState } from 'react'
import {
  DEFAULT_AI_ACCESS,
  type ActivityEntry,
  type AiAccessSettings,
  type ClientId,
  type ClientPlan,
  type ClientStatus,
  type WriteMode,
} from '@shared/ai-access'
import { formatText, RULES, type Finding, type FormattingProfile } from '@shared/formatting'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { Icon } from '../../../ui/Icon'
import { SettingGroup } from '../../../ui/SettingGroup'
import { SettingRow } from '../../../ui/SettingRow'
import type { SettingsDeps } from '../settings-deps'
import { NotePicker } from './NotePicker'
import { ProvidersGroup } from './ProvidersSettings'

/**
 * Settings → AI: where answers come from (Providers), then what AI clients
 * may do with this vault through Recto - AI guide, Formatting, Write mode,
 * Excluded folders, Connect a client, Activity. Every change is saved at once to
 * `.recto/ai-access.json`, which every tool call reads fresh.
 */

const SAMPLE = [
  '# Sample note',
  'A paragraph of text.',
  '## Plans',
  '',
  '* first thing',
  '+ second thing',
  '#### Details',
  'More text, then [another note](Other note.md).',
  '',
  '',
  '',
  'The last line.',
].join('\n')

const preview = (profile: FormattingProfile): string => formatText(SAMPLE, profile, { name: 'Sample note' }).text

const WRITE_MODES: { value: WriteMode; label: string; hint: string }[] = [
  { value: 'read', label: 'Read only', hint: 'AI can read and search; write tools refuse.' },
  { value: 'propose', label: 'Propose changes', hint: 'Every change waits in Suggested edits for Apply or Discard.' },
  { value: 'write', label: 'Write directly', hint: 'Changes are written at once, after a backup in .recto/backup/ai/.' },
]

export function AiAccessSettings({ notes, folders }: SettingsDeps): React.ReactElement {
  const [settings, setSettings] = useState<AiAccessSettings>(DEFAULT_AI_ACCESS)
  useEffect(() => void api.invoke(IPC.aiAccessSettings).then(setSettings), [])
  const save = (next: AiAccessSettings): void => {
    setSettings(next)
    void api.invoke(IPC.aiAccessSetSettings, next)
  }

  return (
    <>
      <ProvidersGroup settings={settings} save={save} />
      <GuideGroup settings={settings} save={save} notes={notes} />
      <FormattingGroup settings={settings} save={save} />
      <SettingGroup title="Write mode">
        <SettingRow label="When an AI writes" hint={WRITE_MODES.find((m) => m.value === settings.writeMode)!.hint}>
          <select
            className="setting__select"
            aria-label="Write mode"
            value={settings.writeMode}
            onChange={(e) => save({ ...settings, writeMode: e.target.value as WriteMode })}
          >
            {WRITE_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </SettingRow>
      </SettingGroup>
      <ExcludedGroup settings={settings} save={save} notes={notes} folders={folders} />
      <ClientsGroup />
      <ActivityGroup />
    </>
  )
}

type GroupProps = { settings: AiAccessSettings; save: (next: AiAccessSettings) => void }

function GuideGroup({ settings, save, notes }: GroupProps & { notes: readonly string[] }): React.ReactElement {
  const [draft, setDraft] = useState<{ name: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <SettingGroup title="AI guide">
      <SettingRow
        label="AI guide"
        hint="A note AI clients read before they write anything: how you keep this vault, in your words."
        more="Any note works - write your own (a system.md, say) and choose it here. Draft an AI guide starts one from how the vault is set up, for you to edit before it is saved."
      >
        <div className="setting__buttons">
          <NotePicker notes={notes} value={settings.guide} label="AI guide note" onChange={(guide) => save({ ...settings, guide })} />
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => void api.invoke(IPC.aiAccessDraftGuide).then((text) => setDraft({ name: 'AI guide', text }))}
          >
            Draft an AI guide
          </button>
        </div>
      </SettingRow>
      {draft !== null && (
        <SettingRow label="Your draft" hint="Edit it, name it, and save it as a note. It becomes the AI guide." stack>
          <input
            className="dialog__input"
            aria-label="Guide note name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <textarea
            className="dialog__input ai-access__draft"
            aria-label="Guide text"
            rows={14}
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="setting__buttons">
            <button className="btn btn--ghost btn--sm" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button
              className="btn btn--primary btn--sm"
              onClick={() =>
                void api.invoke(IPC.aiAccessSaveGuide, draft.name, draft.text).then((saved) => {
                  if (!saved.ok) return setError(saved.error)
                  setError(null)
                  setDraft(null)
                  save({ ...settings, guide: saved.path })
                })
              }
            >
              Save as a note
            </button>
          </div>
          {error !== null && <p className="setting__note setting__note--bad">{error}</p>}
        </SettingRow>
      )}
    </SettingGroup>
  )
}

function FormattingGroup({ settings, save }: GroupProps): React.ReactElement {
  const [detected, setDetected] = useState<{ profile: FormattingProfile; findings: Finding[]; linter: string; notes: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (key: keyof FormattingProfile, value: string): void =>
    save({ ...settings, formatting: { ...settings.formatting, [key]: value } as FormattingProfile })
  return (
    <SettingGroup title="Formatting">
      <SettingRow
        label="Detect from my notes"
        hint="Reads Obsidian Linter’s settings if it is on, then counts your habits: a rule 80% of your notes agree on is filled in, mixed habits stay “Leave as written”."
        more="Recto applies these rules only to lines an AI adds or changes, before you see its suggestion. Your own text is never reformatted, and a rule left as written changes nothing."
      >
        <button
          className="btn btn--ghost btn--sm"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void api.invoke(IPC.aiAccessDetectFormatting).then((result) => {
              setDetected(result)
              setBusy(false)
            })
          }}
        >
          {busy ? 'Reading notes…' : 'Detect from my notes'}
        </button>
      </SettingRow>
      {detected !== null && (
        <SettingRow
          label="What Recto found"
          hint={`${detected.notes} notes read. Obsidian Linter: ${detected.linter === 'imported' ? 'on, its settings imported' : detected.linter === 'off' ? 'installed but off, not read' : 'not installed'}.`}
          stack
        >
          <ul className="ai-access__findings">
            {detected.findings.map((f) => (
              <li key={f.rule}>
                <strong>{RULES.find((r) => r.key === f.rule)!.label}:</strong>{' '}
                {RULES.find((r) => r.key === f.rule)!.options.find((o) => o.value === f.value)?.label} — {f.text}
              </li>
            ))}
          </ul>
          <div className="ai-access__compare">
            <div>
              <span className="setting__hint">Now</span>
              <pre className="ai-access__pre">{preview(settings.formatting)}</pre>
            </div>
            <div>
              <span className="setting__hint">With these</span>
              <pre className="ai-access__pre">{preview(detected.profile)}</pre>
            </div>
          </div>
          <div className="setting__buttons">
            <button className="btn btn--ghost btn--sm" onClick={() => setDetected(null)}>
              Keep mine
            </button>
            <button
              className="btn btn--primary btn--sm"
              onClick={() => {
                save({ ...settings, formatting: detected.profile })
                setDetected(null)
              }}
            >
              Use these
            </button>
          </div>
        </SettingRow>
      )}
      {RULES.map((rule) => (
        <SettingRow key={rule.key} label={rule.label} {...(rule.linter === null ? {} : { hint: `Like Obsidian Linter’s ${rule.linter}.` })}>
          <select
            className="setting__select"
            aria-label={rule.label}
            value={settings.formatting[rule.key]}
            onChange={(e) => set(rule.key, e.target.value)}
          >
            {rule.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </SettingRow>
      ))}
    </SettingGroup>
  )
}

function ExcludedGroup({
  settings,
  save,
  notes,
  folders,
}: GroupProps & { notes: readonly string[]; folders: readonly string[] }): React.ReactElement {
  const choices = [...folders.map((f) => `${f}/`), ...notes.filter((n) => n.toLowerCase().endsWith('.md'))].filter(
    (c) => !settings.excluded.includes(c.replace(/\/$/, '')),
  )
  return (
    <SettingGroup title="Excluded folders">
      <SettingRow
        label="Never shown to AI"
        hint="No tool returns, searches, counts, links into or writes these - not in a snippet, a backlink or a summary."
      >
        <select
          className="setting__select"
          aria-label="Exclude a folder or note"
          value=""
          onChange={(e) => {
            if (e.target.value !== '') save({ ...settings, excluded: [...settings.excluded, e.target.value.replace(/\/$/, '')] })
          }}
        >
          <option value="">Add a folder or note…</option>
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </SettingRow>
      {settings.excluded.map((entry) => (
        <SettingRow key={entry} label={entry}>
          <button
            className="btn btn--ghost btn--sm"
            aria-label={`Stop excluding ${entry}`}
            onClick={() => save({ ...settings, excluded: settings.excluded.filter((e) => e !== entry) })}
          >
            Remove
          </button>
        </SettingRow>
      ))}
    </SettingGroup>
  )
}

const STATE_TEXT: Record<ClientStatus['state'], string> = {
  connected: 'Connected',
  'not-connected': 'Not connected',
  broken: 'Broken config',
}

function ClientsGroup(): React.ReactElement {
  const [clients, setClients] = useState<ClientStatus[]>([])
  const [asking, setAsking] = useState<{ id: ClientId; action: 'connect' | 'disconnect'; plan: Extract<ClientPlan, { ok: true }> } | null>(
    null,
  )
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const refresh = (): void => void api.invoke(IPC.aiClients).then(setClients)
  useEffect(refresh, [])

  const ask = (id: ClientId, action: 'connect' | 'disconnect'): void =>
    void api
      .invoke(IPC.aiClientPlan, id, action)
      .then((plan) => (plan.ok ? setAsking({ id, action, plan }) : setMessage({ ok: false, text: plan.error })))

  const confirm = async (): Promise<void> => {
    if (asking === null) return
    const { id, action, plan } = asking
    setAsking(null)
    const done = await api.invoke(action === 'connect' ? IPC.aiClientConnect : IPC.aiClientDisconnect, id)
    setMessage(
      done.ok
        ? {
            ok: true,
            text: `${action === 'connect' ? 'Connected' : 'Disconnected'}.${plan.note !== null && plan.note.startsWith('Quit') ? ` ${plan.note}` : ''}`,
          }
        : { ok: false, text: done.error ?? 'It did not work.' },
    )
    refresh()
  }

  return (
    <SettingGroup title="Connect a client">
      <SettingRow
        label="Test connection"
        hint="Runs the same launcher the clients run, and asks this Recto for an answer."
        more="Clients run ~/Library/Application Support/Recto/bin/recto-mcp, which Recto rewrites on every start: updating or moving Recto never breaks a client. Recto must be open for a client to use it."
      >
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => void api.invoke(IPC.aiClientTest).then((r) => setMessage({ ok: r.ok, text: r.message }))}
        >
          Test connection
        </button>
      </SettingRow>
      {clients.map((c) => (
        <SettingRow
          key={c.id}
          label={c.name}
          hint={
            c.installed ? `${STATE_TEXT[c.state]}${c.detail !== null && c.state === 'broken' ? ` — ${c.detail}` : ''}` : 'Not installed'
          }
        >
          <div className="setting__buttons">
            {!c.installed ? (
              <button className="btn btn--ghost btn--sm" onClick={() => void api.invoke(IPC.shellOpenExternal, c.url)}>
                Get {c.name}
              </button>
            ) : (
              <>
                {c.id === 'claude-desktop' && c.state !== 'connected' && (
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={() =>
                      void api
                        .invoke(IPC.aiClientInstallExtension)
                        .then((r) =>
                          setMessage(
                            r.ok
                              ? {
                                  ok: true,
                                  text: 'Claude Desktop opened the Recto extension: press Install there, then quit and reopen Claude Desktop.',
                                }
                              : { ok: false, text: r.error ?? 'Could not open it.' },
                          ),
                        )
                    }
                  >
                    Install extension
                  </button>
                )}
                {c.state !== 'not-connected' && (
                  <button className="btn btn--ghost btn--sm" onClick={() => ask(c.id, 'disconnect')}>
                    Disconnect
                  </button>
                )}
                {c.state !== 'connected' && (
                  <button
                    className={`btn btn--sm ${c.id === 'claude-desktop' ? 'btn--ghost' : 'btn--primary'}`}
                    onClick={() => ask(c.id, 'connect')}
                  >
                    {c.id === 'claude-desktop' ? 'Use config file' : c.state === 'broken' ? 'Repair' : 'Connect'}
                  </button>
                )}
              </>
            )}
          </div>
        </SettingRow>
      ))}
      {message !== null && (
        <p className={`setting__note${message.ok ? '' : ' setting__note--bad'}`}>
          <Icon name={message.ok ? 'check' : 'alert-triangle'} size={13} />
          {message.text}
        </p>
      )}
      {asking !== null && (
        <ConfirmDialog
          title={`${asking.action === 'connect' ? 'Connect' : 'Disconnect'} ${clients.find((c) => c.id === asking.id)?.name ?? ''}`}
          danger={asking.action === 'disconnect'}
          confirmLabel={asking.action === 'connect' ? 'Connect' : 'Disconnect'}
          body={
            <>
              {asking.plan.note ?? `In ${asking.plan.file}:`} A backup of the file is kept first; other servers’ entries are not touched.
              <pre className="ai-access__pre">{asking.plan.lines}</pre>
            </>
          }
          onConfirm={() => void confirm()}
          onCancel={() => setAsking(null)}
        />
      )}
    </SettingGroup>
  )
}

function ActivityGroup(): React.ReactElement {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const refresh = (): void => void api.invoke(IPC.aiAccessActivity).then(setEntries)
  useEffect(refresh, [])
  return (
    <SettingGroup title="Activity">
      <SettingRow label="Every AI call" hint="Which client, which tool, what it asked for and when. Never note text." stack>
        <div className="setting__buttons">
          <button className="btn btn--ghost btn--sm" onClick={refresh}>
            Refresh
          </button>
        </div>
        {entries.length === 0 ? (
          <p className="setting__hint">No calls yet.</p>
        ) : (
          <ul className="ai-access__activity">
            {entries.slice(0, 100).map((e, i) => (
              <li key={i} className={e.outcome === 'error' ? 'is-error' : ''}>
                <time>{new Date(e.at).toLocaleString()}</time> <strong>{e.tool}</strong> <span>{e.client}</span> <span>{e.args}</span>{' '}
                <em>
                  {e.outcome}
                  {e.error === undefined ? '' : `: ${e.error}`}
                </em>
              </li>
            ))}
          </ul>
        )}
      </SettingRow>
    </SettingGroup>
  )
}
