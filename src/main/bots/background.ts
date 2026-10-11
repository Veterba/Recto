import { BrowserWindow } from 'electron'
import type { NoteCardsStatus } from '../../shared/bots'
import { IPC_EVENT } from '../../shared/ipc'
import { sendEvent } from '../events'
import { buildCards } from './cards'
import { syncVectors } from './vectors'
import { backgroundGate, shouldPause } from './background-gate'
import type { BotModelProvider } from './provider'

/**
 * What the bots keep up to date while the app is open: chunk vectors (the
 * embedder) and note cards (the local model). Both only on the charger, with
 * nobody at the keyboard for a minute (background-gate.ts); a key pressed, the
 * charger pulled or a question to a bot stops the work in progress, and the
 * next check - every two minutes - picks up where it left off. An answer
 * brings the vectors it needs up to date itself (answers.ts), so they are
 * never stale for a question, on battery or not.
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
  if (!on.vectors && !on.cards) {
    publish({ ...status, state: 'off' })
    return
  }
  const gate = backgroundGate()
  if (gate !== 'ok') {
    publish({ ...status, state: gate === 'charger' ? 'waiting-charger' : on.cards ? 'waiting' : status.state })
    return
  }
  const controller = new AbortController()
  running = controller
  // Someone starts typing, or pulls the charger: stop within two seconds,
  // rather than at the end of a card that takes twenty.
  let paused: 'waiting' | 'waiting-charger' | null = null
  const watch = setInterval(() => {
    if (!shouldPause()) return
    paused = backgroundGate() === 'charger' ? 'waiting-charger' : 'waiting'
    controller.abort()
  }, 2000)
  try {
    if (on.vectors) await syncVectors(d.exclude(), controller.signal).catch((err: unknown) => console.error('[bots] vectors', err))
    if (!on.cards) {
      publish({ ...status, state: 'off' })
      return
    }
    if (controller.signal.aborted || d.busy() || !(await d.ready())) return
    const result = await buildCards({
      provider: d.provider(),
      model: d.model(),
      exclude: d.exclude(),
      background: true,
      signal: controller.signal,
      onProgress: publish,
    })
    publish(paused === null ? result : { ...result, state: paused })
  } catch (err) {
    if (paused !== null) publish({ ...status, state: paused })
    else console.error('[bots] note cards', err)
  } finally {
    clearInterval(watch)
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
