import { BrowserWindow } from 'electron'
import type { AiMessage } from '../../shared/ai'
import {
  DEFAULT_BOT_MODEL,
  DEFAULT_HARNESS,
  type Bot,
  type BotModelStatus,
  type BotSettings,
  type BotSource,
  type ModelChoice,
} from '../../shared/bots'
import { IPC_EVENT, type IpcEvents } from '../../shared/ipc'
import { botsMock } from '../config'
import { sendEvent } from '../events'
import { readState, writeState } from '../store'
import { currentVault } from '../vault'
import { cleanTitle } from '../../shared/chat-topics'
import { listBots, writeBotModel } from './definitions'
import { AnthropicProvider, MockProvider, OllamaProvider, isApiModel, type BotModelProvider, type LocalModels } from './provider'
import { localChoices } from './models/catalog'
import { switchPlan } from './models/switch'
import { prepare } from './prepare'
import { answerWithTools } from './model-tools'
import { cardsStatus, startBackground as startJobs, yieldToAnswer } from './background'
import os from 'node:os'
import { readKey } from '../secrets'

/**
 * Bots, on the main side: who they are, whether their model can run, and
 * asking one. The renderer sees text and source paths come back; the vault
 * search, the prompt and the connection to the model all happen here.
 */

const local: BotModelProvider & LocalModels = botsMock() ? new MockProvider() : new OllamaProvider()
const api: BotModelProvider = botsMock() ? new MockProvider() : new AnthropicProvider(readKey)

/** The model's provider: an Anthropic model when it is one of the API models, otherwise Ollama on this Mac. */
export const providerFor = (model: string): BotModelProvider => (isApiModel(model) ? api : local)

export function settings(): BotSettings {
  const state = readState()
  return { defaultModel: state.botDefaultModel ?? DEFAULT_BOT_MODEL, harness: { ...DEFAULT_HARNESS, ...state.botHarness } }
}

export function setSettings(patch: Partial<BotSettings>): BotSettings {
  const model = patch.defaultModel?.trim()
  if (model !== undefined) writeState({ botDefaultModel: model === '' ? undefined : model })
  if (patch.harness !== undefined) writeState({ botHarness: { ...readState().botHarness, ...patch.harness } })
  return settings()
}

export function list(): Bot[] {
  const vault = currentVault()
  return vault === null ? [] : listBots(vault.path)
}

export const modelOf = (bot: Bot | undefined): string => bot?.model ?? settings().defaultModel

/**
 * Whether the model can run. A bot's chat asks this when it opens, which is
 * also the moment to start loading the model: by the time the question is
 * typed, the ten-second cold start is over.
 */
export async function status(model?: string): Promise<BotModelStatus> {
  const chosen = model ?? settings().defaultModel
  const result = await providerFor(chosen).status(chosen)
  if (result.state === 'ready') providerFor(chosen).warm(result.model)
  return result
}

/**
 * On app start: load the default model if Ollama is up, so the first question
 * doesn't wait for it. On quit: take whatever local model is loaded back out
 * of memory - it was kept there for as long as the app is open.
 */
export function warmOnStart(): void {
  void status()
}

export async function unloadOnQuit(): Promise<void> {
  const model = settings().defaultModel
  const bots = list()
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

const running = new Map<string, AbortController>()

export { cardsStatus }

/**
 * Keep the open vault's chunk vectors and note cards up to date in the
 * background (bots/background.ts), on the default model.
 */
export function startBackground(): void {
  if (botsMock()) return
  startJobs({
    provider: () => providerFor(settings().defaultModel),
    model: () => settings().defaultModel,
    exclude: () => list().flatMap((b) => b.exclude ?? []),
    enabled: () => ({
      vectors: settings().harness.hybridRetrieval,
      cards: settings().harness.noteCards && !isApiModel(settings().defaultModel),
    }),
    busy: () => running.size > 0,
    ready: async () => (await providerFor(settings().defaultModel).status(settings().defaultModel)).state === 'ready',
  })
}

function push<
  C extends typeof IPC_EVENT.botsDelta | typeof IPC_EVENT.botsDone | typeof IPC_EVENT.botsError | typeof IPC_EVENT.botsProgress,
>(channel: C, ...args: Parameters<IpcEvents[C]>): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (window === undefined || window.isDestroyed()) return
  sendEvent(window, channel, ...args)
}

export async function ask(request: {
  id: string
  botId: string
  messages: AiMessage[]
  sticky?: BotSource[]
}): Promise<{ ok: true; sources: BotSource[] } | { ok: false; error: string; status?: BotModelStatus }> {
  const bot = list().find((b) => b.id === request.botId)
  if (bot === undefined) return { ok: false, error: 'That bot no longer exists.' }
  if (running.has(request.id)) return { ok: false, error: 'This bot is already answering.' }

  const model = modelOf(bot)
  const provider = providerFor(model)
  const ready = await provider.status(model)
  if (ready.state !== 'ready') return { ok: false, error: 'The model is not available.', status: ready }

  const harness = settings().harness
  yieldToAnswer()
  const { system, history, sources, preface, maxTokens, advisor, toolContext } = await prepare(bot, request.messages, {
    harness,
    provider,
    model,
    ...(request.sticky === undefined ? {} : { sticky: request.sticky }),
    onProgress: (text) => push(IPC_EVENT.botsProgress, { id: request.id, text }),
  })

  const controller = new AbortController()
  running.set(request.id, controller)
  // Not awaited: `bots:send` resolves once the request is under way, and the
  // reply arrives on the push channels.
  void (async () => {
    try {
      if (preface !== null) push(IPC_EVENT.botsDelta, { id: request.id, text: preface })
      let first = true
      const options = { model, signal: controller.signal, maxTokens }
      const reply =
        harness.tools && toolContext !== null
          ? answerWithTools(provider, history, system, {
              ...options,
              advisor,
              context: toolContext,
              result: { calls: [], parseFailures: 0 },
            })
          : provider.stream(history, system, options)
      for await (const text of reply) {
        push(IPC_EVENT.botsDelta, { id: request.id, text: preface !== null && first ? `\n\n${text.trimStart()}` : text })
        first = false
      }
      push(IPC_EVENT.botsDone, { id: request.id })
    } catch (err) {
      if (controller.signal.aborted) push(IPC_EVENT.botsDone, { id: request.id })
      else push(IPC_EVENT.botsError, { id: request.id, message: err instanceof Error ? err.message : String(err) })
    } finally {
      running.delete(request.id)
    }
  })()

  return { ok: true, sources: sources.map(({ path: p, heading }) => ({ path: p, heading })) }
}

export function cancel(id: string): { ok: boolean } {
  const controller = running.get(id)
  if (controller === undefined) return { ok: false }
  controller.abort()
  return { ok: true }
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
