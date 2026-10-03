import { BrowserWindow } from 'electron'
import type { NoteCardsStatus } from '../../shared/bots'
import { IPC_EVENT } from '../../shared/ipc'
import { sendEvent } from '../events'
import { buildCards } from './cards'
import { syncVectors } from './vectors'
import type { BotModelProvider } from './provider'

/**
 * What the bots keep up to date while the app is open: chunk vectors (cheap,
 * whenever notes change) and note cards (the local model, only while nobody
 * is using the app or a bot, and not on a low battery). Checked every two
 * minutes; a question to a bot stops a card in progress, and the next check
 * picks up where it left off.
 */

const TICK_MS = 2 * 60_000

export type Background = {
  provider: () => BotModelProvider
  model: () => string
  exclude: () => string[]
  enabled: () => { vectors: boolean; cards: boolean }
  /** A bot is answering: the model is busy. */
  busy: () => boolean
  /** The model can run right now. */
  ready: () => Promise<boolean>
}

let timer: NodeJS.Timeout | null = null
let running: AbortController | null = null
let deps: Background | null = null
let status: NoteCardsStatus = { done: 0, total: 0, state: 'idle' }

function publish(next: NoteCardsStatus): void {
  status = next
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) sendEvent(win, IPC_EVENT.botsCardsStatus, status)
}

export const cardsStatus = (): NoteCardsStatus => status

async function tick(): Promise<void> {
  if (deps === null || running !== null) return
  const d = deps
  const on = d.enabled()
  running = new AbortController()
  try {
    if (on.vectors) await syncVectors(d.exclude()).catch((err: unknown) => console.error('[bots] vectors', err))
    if (!on.cards) {
      publish({ ...status, state: 'off' })
      return
    }
    if (d.busy() || !(await d.ready())) return
    publish(
      await buildCards({
        provider: d.provider(),
        model: d.model(),
        exclude: d.exclude(),
        background: true,
        signal: running.signal,
        onProgress: publish,
      }),
    )
  } catch (err) {
    console.error('[bots] note cards', err)
  } finally {
    running = null
  }
}

/** Start for the open vault (once its index is open). */
export function startBackground(background: Background): void {
  stopBackground()
  deps = background
  timer = setInterval(() => void tick(), TICK_MS)
  void tick()
}

export function stopBackground(): void {
  if (timer !== null) clearInterval(timer)
  timer = null
  running?.abort()
  deps = null
}

/** A bot is about to answer: the card in progress gives the model back. */
export function yieldToAnswer(): void {
  running?.abort()
}
