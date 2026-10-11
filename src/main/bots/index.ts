import { BrowserWindow } from 'electron'
import type { AiMessage } from '../../shared/ai'
import {
  DEFAULT_BOT_MODEL,
  DEFAULT_HARNESS,
  DEFAULT_UNLOAD_MINUTES,
  UNLOAD_CHOICES,
  isActive,
  type Bot,
  type BotMemoryStatus,
  type BotModelStatus,
  type BotSettings,
  type ModelChoice,
} from '../../shared/bots'
import { IPC_EVENT, type IpcEvents } from '../../shared/ipc'
import { botsMock } from '../config'
import { sendEvent } from '../events'
import { readState, writeState } from '../store'
import { currentVault } from '../vault'
import { cleanTitle } from '../../shared/chat-topics'
import { listBots, writeBotModel } from './definitions'
import {
  AnthropicProvider,
  MockProvider,
  OllamaProvider,
  isApiModel,
  keepAliveFor,
  type BotModelProvider,
  type LocalModels,
} from './provider'
import { localChoices } from './models/catalog'
import { switchPlan } from './models/switch'
import { initAnswers, jobs, stopAnswers } from './answers'
import { cardsStatus, startBackground as startJobs, stopBackground, yieldToAnswer } from './background'
import { botsEnabled, writeBotsEnabled } from './enabled'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { readKey } from '../secrets'

/**
 * Bots, on the main side: who they are, whether their model can run, and
 * asking one. The renderer sees text and source paths come back; the vault
 * search, the prompt and the connection to the model all happen here.
 */

const local: BotModelProvider & LocalModels = botsMock()
  ? new MockProvider()
  : new OllamaProvider(() => keepAliveFor(settings().unloadAfterMinutes))
const api: BotModelProvider = botsMock() ? new MockProvider() : new AnthropicProvider(readKey)

/** The model's provider: an Anthropic model when it is one of the API models, otherwise Ollama on this Mac. */
export const providerFor = (model: string): BotModelProvider => (isApiModel(model) ? api : local)

export function settings(): BotSettings {
  const state = readState()
  return {
    defaultModel: state.botDefaultModel ?? DEFAULT_BOT_MODEL,
    notify: state.botNotify ?? true,
    unloadAfterMinutes: state.botUnloadMinutes ?? DEFAULT_UNLOAD_MINUTES,
    harness: { ...DEFAULT_HARNESS, ...state.botHarness },
  }
}

export function setSettings(patch: Partial<BotSettings>): BotSettings {
  const model = patch.defaultModel?.trim()
  if (model !== undefined) writeState({ botDefaultModel: model === '' ? undefined : model })
  if (patch.harness !== undefined) writeState({ botHarness: { ...readState().botHarness, ...patch.harness } })
  if (patch.notify !== undefined) writeState({ botNotify: patch.notify })
  if (patch.unloadAfterMinutes !== undefined && (UNLOAD_CHOICES as readonly number[]).includes(patch.unloadAfterMinutes)) {
    writeState({ botUnloadMinutes: patch.unloadAfterMinutes })
    // A model already in memory keeps its old timer until told otherwise.
    void local.loadedModels().then((models) => Promise.all(models.map((m) => local.retime(m))))
  }
  return settings()
}

/** What the local model takes in memory now, and when it will leave (Settings → Bots). */
export async function memoryStatus(): Promise<BotMemoryStatus> {
  const loaded = botsEnabled() ? await local.loadedModels() : []
  return { loaded, bytes: loaded.length === 0 ? 0 : await ollamaResident(), unloadAfterMinutes: settings().unloadAfterMinutes }
}

/** Resident memory of Ollama's processes (the server and the model runner), from `ps`. */
function ollamaResident(): Promise<number> {
  return new Promise((resolve) =>
    execFile('ps', ['-axo', 'rss=,comm='], (_err, stdout) =>
      resolve(
        (stdout ?? '')
          .split('\n')
          .filter((line) => /ollama|llama-server/i.test(line))
          .reduce((sum, line) => sum + Number(line.trim().split(/\s+/)[0] ?? 0) * 1024, 0),
      ),
    ),
  )
}

/**
 * Load a bot's model ahead of its question: called when someone starts typing
 * in its composer. Loading it again when it is in memory costs nothing and
 * restarts its unload timer, which is right - typing is using the bot.
 */
export function warm(botId: string): void {
  if (!botsEnabled() || botsMock()) return
  const model = modelOf(list().find((b) => b.id === botId))
  if (!isApiModel(model)) local.warm(model)
}

/** The open vault's bots - none while bots are off, so nothing scaffolds their folder either. */
export function list(): Bot[] {
  const vault = currentVault()
  return vault === null || !botsEnabled() ? [] : listBots(vault.path)
}

export { botsEnabled }

/**
 * Bots on or off for this vault. On starts their background work (the model
 * loads when a bot is used); off stops all of it - a running answer is stopped and
 * saved, the background loop ends, and the local model goes out of memory.
 */
export async function setEnabled(on: boolean): Promise<boolean> {
  if (on === botsEnabled()) return on
  if (on) {
    writeBotsEnabled(true)
    startBackground()
  } else {
    await stopAnswers()
    stopBackground()
    // The last call to Ollama: take the model out of memory.
    await unloadModels()
    writeBotsEnabled(false)
  }
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) sendEvent(win, IPC_EVENT.botsEnabledChanged, on)
  return on
}

export const modelOf = (bot: Bot | undefined): string => bot?.model ?? settings().defaultModel

/**
 * Whether the model can run. A bot's chat asks this when it opens (`warm`),
 * which is also the moment to start loading the model: by the time the
 * question is typed, the ten-second cold start is over. Settings asks without
 * loading anything.
 */
export async function status(model?: string, warmUp = false): Promise<BotModelStatus> {
  const chosen = model ?? settings().defaultModel
  // Off: not a single request to Ollama, not even to ask.
  if (!botsEnabled()) return { state: 'not-running', model: chosen }
  const result = await providerFor(chosen).status(chosen)
  if (warmUp && result.state === 'ready') providerFor(chosen).warm(result.model)
  return result
}

/**
 * When a vault opens with bots on: load the default model if Ollama is up, so
 * the first question doesn't wait for it. On quit: take whatever local model
 * is loaded back out of memory - it was kept there for as long as the app is open.
 */

export async function unloadOnQuit(): Promise<void> {
  // Off means nothing was loaded, and nothing is asked of Ollama on the way out.
  if (!botsEnabled()) return
  await unloadModels()
}

async function unloadModels(): Promise<void> {
  const model = settings().defaultModel
  const vault = currentVault()
  const bots = vault === null ? [] : listBots(vault.path)
  const models = new Set([model, ...bots.map((b) => modelOf(b))].filter((m) => !isApiModel(m)))
  await Promise.all([...models].map((m) => local.unload(m)))
}

/**
 * A bot's model, changed from its chat. On this Mac only one local model fits
 * in memory at a time, so the one it used is unloaded and the new one loaded
 * straight away - the chat shows "Loading…" until it is in, then Send is on.
 */
export function setModel(botId: string, model: string | null): Bot[] {
  const vault = currentVault()
  if (vault === null) return []
  const before = modelOf(list().find((b) => b.id === botId))
  writeBotModel(vault.path, botId, model)
  const after = modelOf(list().find((b) => b.id === botId))
  const plan = switchPlan(before, after)
  void (async () => {
    if (plan.unload !== null) await local.unload(plan.unload)
    if (plan.preload !== null) await local.preload(plan.preload)
  })()
  return list()
}

/** The picker's local models: installed ones that can chat, then the recommended ones to download. */
export async function models(): Promise<{ local: ModelChoice[]; running: boolean; ramBytes: number }> {
  if (!botsEnabled()) return { local: [], running: false, ramBytes: os.totalmem() }
  const installed = await local.installed()
  // The snapshot run pretends to be the 16 GB Mac the hints are written for.
  const ramBytes = botsMock() ? 16 * 2 ** 30 : os.totalmem()
  return { local: localChoices(installed ?? [], ramBytes), running: installed !== null, ramBytes }
}

/** The download running now, if any: one at a time, and it can be stopped. */
let pulling: { name: string; controller: AbortController } | null = null

/**
 * Download a model through Ollama - only ever because the user picked it and
 * confirmed. Progress, the end and any failure arrive on `bots:pull-progress`.
 */
export function pull(name: string): { ok: boolean; error?: string } {
  if (!botsEnabled()) return { ok: false, error: 'Bots are off.' }
  if (pulling !== null) return { ok: false, error: `Already downloading ${pulling.name}.` }
  const controller = new AbortController()
  pulling = { name, controller }
  void (async () => {
    try {
      await local.pull(name, (progress) => pushPull({ ...progress, done: false }), controller.signal)
      pushPull({ name, status: 'success', completed: 1, total: 1, done: true })
    } catch (err) {
      pushPull({
        name,
        status: controller.signal.aborted ? 'cancelled' : 'error',
        completed: 0,
        total: 0,
        done: true,
        ...(controller.signal.aborted ? {} : { error: err instanceof Error ? err.message : String(err) }),
      })
    } finally {
      pulling = null
    }
  })()
  return { ok: true }
}

export function cancelPull(): { ok: boolean } {
  pulling?.controller.abort()
  return { ok: pulling !== null }
}

function pushPull(progress: Parameters<IpcEvents[typeof IPC_EVENT.botsPullProgress]>[0]): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (window !== undefined && !window.isDestroyed()) sendEvent(window, IPC_EVENT.botsPullProgress, progress)
}

export { prepare, type ContextNote, type Prepared, type ToolCall } from './prepare'

export { cardsStatus }

/** Answers run in main, queued one at a time (bots/answers.ts, bots/jobs.ts). */
initAnswers({ bots: list, modelOf, providerFor, settings: () => settings(), beforeRun: yieldToAnswer })
export { stopAnswers }

/**
 * Keep the open vault's chunk vectors and note cards up to date in the
 * background (bots/background.ts), on the default model.
 */
export function startBackground(): void {
  if (!botsEnabled()) return
  // No model is loaded here: it loads when a bot chat opens or someone types
  // to a bot, and leaves memory a few minutes after the last use.
  if (botsMock()) return
  startJobs({
    provider: () => providerFor(settings().defaultModel),
    model: () => settings().defaultModel,
    exclude: () => list().flatMap((b) => b.exclude ?? []),
    enabled: () => ({
      vectors: settings().harness.hybridRetrieval,
      cards: settings().harness.noteCards && !isApiModel(settings().defaultModel),
    }),
    busy: () => jobs.list().some(isActive),
    ready: async () => (await providerFor(settings().defaultModel).status(settings().defaultModel)).state === 'ready',
  })
}

const TITLE_SYSTEM = [
  'Write a title for this conversation: two to five words, in the language the conversation is in.',
  'Name what it is about, like the title of a note ("Soil mix for raised beds"), never the conversation itself',
  '("Conversation history", "Greeting").',
  'Sentence case: only the first word and names capitalised.',
  'Reply with the title only - no quotes, no full stop, no "Title:".',
].join(' ')

/**
 * A title for a chat topic, from its first exchange, by the bot's own model.
 * Null when the model cannot run or gives nothing usable; the renderer falls
 * back to the first question.
 */
export async function title(request: { botId: string; messages: AiMessage[] }): Promise<string | null> {
  if (!botsEnabled()) return null
  const bot = list().find((b) => b.id === request.botId)
  const model = modelOf(bot)
  const provider = providerFor(model)
  if ((await provider.status(model)).state !== 'ready') return null
  const conversation = request.messages
    .slice(0, 2)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 1500)}`)
    .join('\n\n')
  let text = ''
  try {
    const signal = AbortSignal.timeout(30_000)
    for await (const piece of provider.stream([{ role: 'user', content: conversation }], TITLE_SYSTEM, { model, signal })) text += piece
  } catch {
    return null
  }
  return cleanTitle(text)
}
