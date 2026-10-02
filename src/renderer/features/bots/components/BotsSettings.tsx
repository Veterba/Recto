import { useEffect, useState } from 'react'
import { BOTS_FOLDER, CHATS_FOLDER, DEFAULT_BOT_MODEL, type BotSettings } from '@shared/bots'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'
import { Icon } from '../../../ui/Icon'
import { SettingRow } from '../../../ui/SettingRow'
import { useBotStatus } from '../hooks/use-bots'
import { BotStatusLine } from './BotStatusLine'

/**
 * Settings → Bots: which local model the bots use, whether it can run, and
 * where everything about them lives. Nothing here involves a key or a server.
 */
export function BotsSettings(): React.ReactElement {
  const [settings, setSettings] = useState<BotSettings | null>(null)
  const [draft, setDraft] = useState('')
  const { status, recheck } = useBotStatus(settings?.defaultModel)

  useEffect(() => {
    void api.invoke(IPC.botsSettings).then((s) => {
      setSettings(s)
      setDraft(s.defaultModel)
    })
  }, [])

  const save = (): void => {
    const model = draft.trim()
    if (settings === null || model === settings.defaultModel) return
    void api.invoke(IPC.botsSetSettings, { defaultModel: model }).then((s) => {
      setSettings(s)
      setDraft(s.defaultModel)
    })
  }

  return (
    <>
      <SettingRow
        label="Default bot model"
        hint={`Used by every bot that names no model of its own. Proposed for this Mac: ${DEFAULT_BOT_MODEL} — Qwen 3.5, 9B, about 6 GB in memory, good in Russian and English.`}
      >
        <div className="setting__buttons">
          <input
            className="dialog__input"
            value={draft}
            spellCheck={false}
            autoComplete="off"
            aria-label="Default bot model"
            placeholder={DEFAULT_BOT_MODEL}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') save()
            }}
          />
        </div>
      </SettingRow>

      <div className="bots-settings__status">
        <BotStatusLine status={status} onRecheck={recheck} />
      </div>

      <SettingRow
        label="Bot definitions"
        hint="One folder per bot: bot.json (name, look, model, excluded folders) and SYSTEM.md (its character)."
      >
        <code className="bot-path">{BOTS_FOLDER}/</code>
      </SettingRow>
      <SettingRow label="Bot chats" hint="Each bot’s threads are markdown notes in a folder of its own.">
        <code className="bot-path">{CHATS_FOLDER}/&lt;bot&gt;/</code>
      </SettingRow>

      <p className="setting__note">
        <Icon name="lock" size={13} />
        Model runs locally in Ollama · Network: none. Bots talk only to Ollama on this Mac (localhost). The one exception is Recto with an
        API model picked in its chat (which needs a key in Settings → AI): then its questions, and the notes found for them, go to
        Anthropic.
      </p>
    </>
  )
}
