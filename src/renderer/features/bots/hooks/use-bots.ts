import { useEffect, useState } from 'react'
import { DEFAULT_BOT_MODEL, type Bot, type BotModelStatus } from '@shared/bots'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'

/**
 * The open vault's bots, read once and shared by the sidebar and every bot
 * view. Definitions are files the user edits by hand, outside the watched
 * notes, so `reloadBots` is called where a change can be expected (opening
 * the AI section, a vault switch).
 */

let cached: Bot[] | null = null
const listeners = new Set<(bots: Bot[]) => void>()

export function reloadBots(): void {
  void api.invoke(IPC.botsList).then((bots) => {
    cached = bots
    for (const listener of listeners) listener(bots)
  })
}

export function useBots(): Bot[] | null {
  const [bots, setBots] = useState<Bot[] | null>(cached)
  useEffect(() => {
    listeners.add(setBots)
    if (cached === null) reloadBots()
    else setBots(cached)
    return () => {
      listeners.delete(setBots)
    }
  }, [])
  return bots
}

/** How often to look again while the model is not available: starting Ollama should be noticed without a click. */
const RECHECK_MS = 5000
const LOADING_RECHECK_MS = 1000

/**
 * Whether a bot's model can run right now. Checked on mount, when the window
 * regains focus, and every few seconds while it cannot.
 */
export function useBotStatus(model: string | undefined): { status: BotModelStatus | null; recheck: () => void } {
  const [status, setStatus] = useState<BotModelStatus | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    void api.invoke(IPC.botsStatus, ...(model === undefined ? [] : [model])).then((next) => {
      if (!cancelled) setStatus(next)
    })
    return () => {
      cancelled = true
    }
  }, [model, tick])

  useEffect(() => {
    const again = (): void => setTick((t) => t + 1)
    window.addEventListener('focus', again)
    // A model being loaded is done in seconds: Send should come on when it is.
    const every = status?.state === 'loading' ? LOADING_RECHECK_MS : RECHECK_MS
    const timer = status !== null && status.state !== 'ready' ? window.setInterval(again, every) : 0
    return () => {
      window.removeEventListener('focus', again)
      window.clearInterval(timer)
    }
  }, [status])

  return { status, recheck: () => setTick((t) => t + 1) }
}

/** What a status means, and what to do about it - the same words in the chat and in Settings. */
export function describeStatus(status: BotModelStatus): { label: string; fix: string | null; command: string | null } {
  switch (status.state) {
    case 'ready':
      return { label: 'Ollama running · model ready', fix: null, command: null }
    case 'not-running':
      return { label: 'Ollama not running', fix: 'Open the Ollama app, or run this in a terminal:', command: 'ollama serve' }
    case 'loading':
      return { label: `Loading ${status.model}…`, fix: null, command: null }
    case 'no-key':
      return { label: 'No API key', fix: 'Add your Anthropic key in Settings → AI, or pick the local model.', command: null }
    case 'no-model':
      return {
        label: 'Model not downloaded',
        fix: `Download ${status.model} once${status.model === DEFAULT_BOT_MODEL ? ' (about 6 GB)' : ''}, in a terminal:`,
        command: `ollama pull ${status.model}`,
      }
  }
}
