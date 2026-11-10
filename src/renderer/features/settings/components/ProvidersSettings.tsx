import { useCallback, useEffect, useState } from 'react'
import type { AiAccessSettings } from '@shared/ai-access'
import { IPC } from '@shared/ipc'
import { limitsLine, providerInfo, usageLine, USAGE_URL, type ProviderStatus } from '@shared/providers'
import { api } from '../../../app/api'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { Icon } from '../../../ui/Icon'
import { SettingGroup } from '../../../ui/SettingGroup'
import { SettingRow } from '../../../ui/SettingRow'
import { Toggle } from '../../../ui/Toggle'

/**
 * Settings → AI → Providers: where answers may come from. Ollama on this Mac
 * is the default and needs nothing; every cloud provider is off for the vault
 * until the switch here is on, and each says whether it can answer and, when
 * not, the one thing to do. The keys live under Advanced (AiSettings).
 */

type Props = { settings: AiAccessSettings; save: (next: AiAccessSettings) => void }

export function ProvidersGroup({ settings, save }: Props): React.ReactElement {
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [planNotice, setPlanNotice] = useState(false)
  const refresh = useCallback(() => void api.invoke(IPC.providers).then(setProviders), [])
  useEffect(refresh, [refresh])

  const open = (url: string): void => void api.invoke(IPC.providersOpenUrl, url)

  const signIn = async (): Promise<void> => {
    setSigningIn(true)
    setMessage(null)
    const done = await api.invoke(IPC.providersChatGptSignIn)
    setSigningIn(false)
    if (done.ok) {
      if (done.plan) setPlanNotice(true)
      else setMessage({ ok: false, text: 'Signed in, but plan usage was not allowed. Sign in again and allow it to answer with your plan.' })
    } else setMessage({ ok: false, text: done.error })
    refresh()
  }

  /** Its plan's limits when the provider reports them, and what Recto used: under the row's own line. */
  const meter = (p: ProviderStatus): string => {
    const limits = p.limits === null ? null : limitsLine(p.limits)
    return [p.limits !== null && limits !== null ? `${p.limits.plan === null ? '' : `${p.limits.plan} plan: `}${limits}` : null, usageLine(p.usage)]
      .filter((x): x is string => x !== null)
      .join('. ')
  }

  const row = (p: ProviderStatus): React.ReactElement => {
    const info = providerInfo(p.id)
    const label = `${info.name}${info.badge === undefined ? '' : ` · ${info.badge}`}`
    if (p.id === 'ollama')
      return (
        <SettingRow key={p.id} label={label} hint={p.ready ? 'On this Mac · the default. Nothing leaves it.' : (p.problem?.message ?? '')}>
          {null}
        </SettingRow>
      )
    if (p.id === 'chatgpt')
      return (
        <SettingRow
          key={p.id}
          label={label}
          hint={p.ready ? `Signed in as ${p.detail ?? 'your account'} · Using ChatGPT plan. ${meter(p)}. Limits: Manage usage.` : info.blurb}
          more="Recto signs in in your browser and keeps the tokens in your login keychain. It never reads Codex’s or ChatGPT’s own sign-in. OpenAI’s plan sharing is a preview: what it allows may change."
        >
          <div className="setting__buttons">
            {p.ready ? (
              <>
                <button className="btn btn--ghost btn--sm" onClick={() => open(USAGE_URL)}>
                  Manage usage
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    void api.invoke(IPC.providersChatGptSignOut).then((r) => {
                      setMessage(
                        r.revoked
                          ? { ok: true, text: 'Signed out.' }
                          : { ok: false, text: 'Signed out here, but OpenAI did not confirm. You can also disconnect Recto in ChatGPT’s settings.' },
                      )
                      refresh()
                    })
                  }
                >
                  Sign out
                </button>
              </>
            ) : signingIn ? (
              <>
                <span className="setting__note">Waiting for the browser…</span>
                <button className="btn btn--ghost btn--sm" onClick={() => void api.invoke(IPC.providersChatGptCancel)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn btn--primary btn--sm" onClick={() => void signIn()}>
                Continue with ChatGPT
              </button>
            )}
          </div>
        </SettingRow>
      )
    if (p.id === 'codex' || p.id === 'claude-code')
      return (
        <SettingRow
          key={p.id}
          label={label}
          hint={
            p.ready
              ? `Signed in. ${meter(p)}.${p.id === 'claude-code' && p.limits === null ? ' Its limits show after the first answer.' : ''}`
              : (p.problem?.message ?? '')
          }
          more={
            p.id === 'claude-code'
              ? 'Experimental: Anthropic does not say that a subscription may be used through another app like this; the Anthropic API key (Advanced) is the supported way. Recto runs your own claude with its built-in tools off and only Recto’s tools on.'
              : 'Recto runs your own codex with its shell and file tools off, in an empty folder, with only Recto’s tools. It answers all at once rather than word by word.'
          }
        >
          <div className="setting__buttons">
            {p.problem?.url !== undefined && (
              <button className="btn btn--ghost btn--sm" onClick={() => open(p.problem!.url!)}>
                Get {info.name}
              </button>
            )}
            <button className="btn btn--ghost btn--sm" onClick={refresh}>
              Check again
            </button>
          </div>
        </SettingRow>
      )
    return (
      <SettingRow key={p.id} label={label} hint={p.ready ? `Key saved (${p.detail ?? ''}) · ${info.blurb}` : 'No key. Add one under Advanced.'}>
        {null}
      </SettingRow>
    )
  }

  return (
    <SettingGroup title="Providers">
      <SettingRow
        label="Cloud providers in this vault"
        hint={
          settings.cloud
            ? 'On: Recto’s chat and Quick ask can answer with the providers below. Your question, the chat so far and the notes the AI reads leave this Mac.'
            : 'Off: every answer stays on this Mac.'
        }
        more="Excluded folders are never sent to any provider. Background work - note cards, tasks, topic names - always stays on this Mac. Other bots stay on this Mac too."
      >
        <Toggle on={settings.cloud} onChange={() => save({ ...settings, cloud: !settings.cloud })} />
      </SettingRow>
      {providers === null ? <SettingRow label="Looking for providers…">{null}</SettingRow> : providers.filter((p) => !providerInfo(p.id).advanced).map(row)}
      {message !== null && (
        <p className={`setting__note${message.ok ? '' : ' setting__note--bad'}`}>
          <Icon name={message.ok ? 'check' : 'alert-triangle'} size={13} />
          {message.text}
        </p>
      )}
      {planNotice && (
        <ConfirmDialog
          title="You’re using your ChatGPT plan"
          danger={false}
          body="Answers you ask Recto for with ChatGPT count toward your ChatGPT plan’s usage. You can set a limit for Recto, or stop it, in ChatGPT’s usage settings."
          confirmLabel="Got it"
          onConfirm={() => setPlanNotice(false)}
          onCancel={() => setPlanNotice(false)}
        />
      )}
    </SettingGroup>
  )
}

/** The OpenAI key, under Advanced: kept in the login keychain, never shown again. */
export function OpenAiKeyRow(): React.ReactElement {
  const [status, setStatus] = useState<ProviderStatus | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(() => void api.invoke(IPC.providers).then((all) => setStatus(all.find((p) => p.id === 'openai') ?? null)), [])
  useEffect(refresh, [refresh])
  const save = (key: string | null): void =>
    void api.invoke(IPC.providersSetOpenAiKey, key).then((r) => {
      setError(r.ok ? null : (r.error ?? 'Not saved.'))
      setDraft('')
      refresh()
    })
  return (
    <SettingRow
      label="OpenAI API key"
      hint={status?.ready === true ? `Saved as ${status.detail ?? ''} — in your login keychain, not in the vault.` : 'Billed to your OpenAI account. Optional: Codex and ChatGPT need none.'}
    >
      {status?.ready === true ? (
        <button className="btn btn--ghost btn--sm" onClick={() => save(null)}>
          Remove
        </button>
      ) : (
        <div className="setting__buttons">
          <input
            className="dialog__input"
            type="password"
            value={draft}
            spellCheck={false}
            autoComplete="off"
            placeholder="sk-…"
            aria-label="OpenAI API key"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter' && draft.trim() !== '') save(draft)
            }}
          />
          <button className="btn btn--primary btn--sm" disabled={draft.trim() === ''} onClick={() => save(draft)}>
            Save
          </button>
        </div>
      )}
      {error !== null && <p className="setting__note setting__note--bad">{error}</p>}
    </SettingRow>
  )
}
