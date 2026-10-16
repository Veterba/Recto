import { useEffect, useState } from 'react'
import {
  BOTS_FOLDER,
  CHATS_FOLDER,
  DEFAULT_BOT_MODEL,
  UNLOAD_CHOICES,
  type BotMemoryStatus,
  type BotSettings,
  type NoteCardsStatus,
} from '@shared/bots'
import { IPC, IPC_EVENT } from '@shared/ipc'
import { api } from '../../../app/api'
import { Icon } from '../../../ui/Icon'
import { SettingRow } from '../../../ui/SettingRow'
import { SettingGroup } from '../../../ui/SettingGroup'
import { Toggle } from '../../../ui/Toggle'
import { turnBots, useBotStatus, useBotsEnabled } from '../hooks/use-bots'
import { BotStatusLine } from './BotStatusLine'

/** "Note cards 412/530 · waits for the charger": the background work, and why it isn't moving when it isn't. */
function cardsLine(cards: NoteCardsStatus | null): string {
  if (cards === null || cards.state === 'off') return 'Off'
  const count = cards.total === 0 ? 'Note cards not started' : `Note cards ${cards.done}/${cards.total}`
  if (cards.state === 'running') return `${count} · working…`
  if (cards.state === 'waiting-charger') return `${count} · waits for the charger`
  if (cards.state === 'waiting') return `${count} · waits until you're away`
  return count
}

const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`
const unloadLabel = (minutes: number): string => (minutes < 0 ? 'never, while Recto is open' : `${minutes} min after the last use`)

/** What the local model takes in memory now, looked at every few seconds while Settings is open. */
function useMemoryStatus(): BotMemoryStatus | null {
  const [memory, setMemory] = useState<BotMemoryStatus | null>(null)
  useEffect(() => {
    let live = true
    const look = (): void => {
      void api.invoke(IPC.botsMemory).then((next) => {
        if (live) setMemory(next)
      })
    }
    look()
    const timer = window.setInterval(look, 5000)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [])
  return memory
}

/**
 * Settings → Bots: which local model the bots use, whether it can run, and
 * where everything about them lives. Nothing here involves a key or a server.
 */
export function BotsSettings(): React.ReactElement {
  const on = useBotsEnabled()
  if (on === null) return <></>
  return (
    <>
      <SettingGroup title="Bots">
        <SettingRow
          label="Bots"
          badge="Experimental"
          hint="Chat with your notes through a local model (Ollama). Off, nothing of theirs runs: no model is loaded, no note cards or vectors are built, Ollama is never asked."
          more={
            <>
              <Icon name="lock" size={13} />
              Model runs locally in Ollama · Network: none. Bots talk only to Ollama on this Mac (localhost). The one exception is Recto
              with an API model picked in its chat (which needs a key in Settings → AI): then its questions, and the notes found for them,
              go to Anthropic.
            </>
          }
        >
          <Toggle on={on} onChange={() => void turnBots(!on)} label="Bots" />
        </SettingRow>
      </SettingGroup>
      {/* Hidden rather than dimmed while off: the options ask Ollama and the
          model as soon as they are on screen, and off means never asked. */}
      {on && <BotsOptions />}
    </>
  )
}

/** Everything else about bots - shown only while they are on, since none of it runs otherwise. */
function BotsOptions(): React.ReactElement {
  const [settings, setSettings] = useState<BotSettings | null>(null)
  const [draft, setDraft] = useState('')
  const { status, recheck } = useBotStatus(settings?.defaultModel)
  const [cards, setCards] = useState<NoteCardsStatus | null>(null)
  const memory = useMemoryStatus()

  useEffect(() => {
    void api.invoke(IPC.botsCards).then(setCards)
    return api.on(IPC_EVENT.botsCardsStatus, setCards)
  }, [])

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
      <SettingGroup title="Model">
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
          label="Unload the model after"
          hint="Minutes without using a bot before the model leaves memory, so its gigabytes go back to the Mac. It loads again when you open a bot chat or start typing to a bot."
        >
          <select
            className="setting__select"
            aria-label="Unload the model after"
            value={settings?.unloadAfterMinutes ?? 5}
            onChange={(event) => void api.invoke(IPC.botsSetSettings, { unloadAfterMinutes: Number(event.target.value) }).then(setSettings)}
          >
            {UNLOAD_CHOICES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes < 0 ? 'Never (while Recto is open)' : `${minutes} min`}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          label="Model in memory"
          hint={
            memory === null || memory.loaded.length === 0
              ? 'Nothing loaded. The model loads when you open a bot chat or start typing to a bot.'
              : `Leaves memory ${unloadLabel(memory.unloadAfterMinutes)}.`
          }
        >
          <span className="bot-cards" data-testid="bot-memory">
            {memory === null || memory.loaded.length === 0 ? 'None' : `${memory.loaded.join(', ')} · ${gb(memory.bytes)}`}
          </span>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="While you work">
        <SettingRow
          label="Notify when an answer is ready"
          hint="A macOS notification when Recto finishes an answer while its chat isn't on screen. Clicking it opens the topic."
        >
          <Toggle
            on={settings?.notify ?? true}
            onChange={() => {
              if (settings === null) return
              void api.invoke(IPC.botsSetSettings, { notify: !settings.notify }).then(setSettings)
            }}
          />
        </SettingRow>

        <SettingRow
          label="Background work"
          hint="Chunk vectors (for search by meaning) and note cards (a short summary of every note, for reviewing a folder or the vault). Built only on the charger, after a minute away from the keyboard; a key pressed stops them until you're away again. A question brings the vectors it needs up to date itself."
        >
          <span className="bot-cards">{cardsLine(cards)}</span>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Files">
        <SettingRow
          label="Bot definitions"
          hint="One folder per bot: bot.json (name, look, model, excluded folders) and SYSTEM.md (its character)."
        >
          <code className="bot-path">{BOTS_FOLDER}/</code>
        </SettingRow>
        <SettingRow label="Bot chats" hint="Each bot’s threads are markdown notes in a folder of its own.">
          <code className="bot-path">{CHATS_FOLDER}/&lt;bot&gt;/</code>
        </SettingRow>
      </SettingGroup>
    </>
  )
}
