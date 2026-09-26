import type { SettingsDeps } from '../settings-deps'
import { useState, useEffect } from 'react'
import { api } from '../../../app/api'
import { IPC } from '@shared/ipc'
import { SettingRow } from '../../../ui/SettingRow'
import { Icon } from '../../../ui/Icon'
import { AI_MODELS } from '@shared/ai'

/**
 * The API key, and what the app will do with it.
 *
 * The key goes in and never comes back out: there is no IPC channel that
 * returns it, so this screen can show a masked hint and nothing more. Saving
 * hands it to main, which encrypts it into the OS keychain outside the vault -
 * a vault is a folder people push to git, and a secret in one is a secret
 * published.
 */
export function AiSettings({ appearance, update }: SettingsDeps): React.ReactElement {
  const [status, setStatus] = useState<{ present: boolean; hint: string | null; available: boolean } | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const refresh = (): void => {
    void api.invoke(IPC.aiKeyStatus).then(setStatus)
  }
  useEffect(refresh, [])

  const save = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    const saved = await api.invoke(IPC.aiSetKey, draft)
    if (!saved.ok) {
      setResult({ ok: false, text: saved.error ?? 'Could not save the key.' })
      setBusy(false)
      return
    }
    setDraft('')
    refresh()
    // Saving and then finding out it was wrong an hour later is the failure
    // this avoids: one token, one round trip, an answer now.
    const tested = await api.invoke(IPC.aiTest, appearance.aiModel)
    setResult(
      tested.ok ? { ok: true, text: 'Saved and working.' } : { ok: false, text: tested.error ?? 'The key was saved but the test failed.' },
    )
    setBusy(false)
  }

  return (
    <>
      <SettingRow
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
                void api.invoke(IPC.aiTest, appearance.aiModel).then((tested) => {
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
                void api.invoke(IPC.aiClearKey).then(() => {
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
      </SettingRow>

      {result !== null && (
        <p className={`setting__note${result.ok ? '' : ' setting__note--bad'}`}>
          <Icon name={result.ok ? 'check' : 'alert-triangle'} size={13} />
          {result.text}
        </p>
      )}

      <SettingRow label="Model" hint={AI_MODELS.find((model) => model.id === appearance.aiModel)?.blurb ?? ''}>
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
      </SettingRow>

      <p className="setting__note">
        <Icon name="sparkles" size={13} />
        Every conversation is saved as a markdown note in <code>chats/</code>, so it is searchable, linkable and readable without this app.
        Nothing is sent anywhere until you send it: there is no telemetry, and the key goes straight from this machine to Anthropic over TLS
        with no relay of ours in between.
      </p>
    </>
  )
}
