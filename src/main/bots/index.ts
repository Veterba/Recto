import { BrowserWindow } from 'electron'
import path from 'node:path'
import type { AiMessage } from '../../shared/ai'
import {
  BOTS_FOLDER,
  CHATS_FOLDER,
  DEFAULT_BOT_MODEL,
  DEFAULT_HARNESS,
  type BotHarness,
  type Bot,
  type BotModelStatus,
  type BotSettings,
  type BotSource,
  type ModelChoice,
} from '../../shared/bots'
import { IPC_EVENT, type IpcEvents } from '../../shared/ipc'
import { botsMock } from '../config'
import { sendEvent } from '../events'
import { send as indexer } from '../index-client'
import { readState, writeState } from '../store'
import { currentVault } from '../vault'
import * as vaultFs from '../vault-fs'
import { buildSystem, estimateTokens, fitHistory, rankNotes, selectChunks, splitSections, type Chunk } from './context'
import { cleanTitle } from '../../shared/chat-topics'
import { listBots, writeBotModel } from './definitions'
import {
  AnthropicProvider,
  CONTEXT_TOKENS,
  MockProvider,
  OllamaProvider,
  isApiModel,
  type BotModelProvider,
  type LocalModels,
} from './provider'
import { localChoices } from './models/catalog'
import { route, routedTerms, type Route } from './router'
import { isoDate } from './period'
import { notesTool, tasksTool } from './tools'
import { switchPlan } from './models/switch'
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

/** Notes ranked per question, and the most of them read from disk for sections. */
const NOTES_TO_READ = 8
/** Room left in the context window for the answer itself. */
const ANSWER_TOKENS = 1024
/** The context's share of the window: the notes, in characters. */
const CONTEXT_CHARS = 6000

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

/**
 * The vault's best parts for a question, within budget, skipping chats and the
 * bot's excluded folders. Null when the message asks nothing of the vault -
 * small talk, no words worth searching for - so nothing is read at all.
 */
async function findContext(terms: readonly string[], bot: Bot): Promise<{ chunks: Chunk[]; scores: Map<string, number> } | null> {
  if (terms.length === 0) return null
  const hitsByTerm = await Promise.all(
    terms.map(async (term) => {
      const response = await indexer({ kind: 'search', query: term, limit: 12 }, 15_000).catch(() => null)
      return response?.kind === 'search-result' ? response.hits : []
    }),
  )
  // Never its own threads, nor the app's state: a bot citing its last answer is not a source.
  const exclude = [CHATS_FOLDER, path.dirname(BOTS_FOLDER), ...(bot.exclude ?? [])]
  const ranked = rankNotes(hitsByTerm, exclude).slice(0, NOTES_TO_READ)
  const notes = await Promise.all(
    ranked.map(async ({ path: notePath, score }) => {
      const read = await vaultFs.readFile(notePath)
      if (!read.ok) return null
      const title = /^#\s+(.+)$/m.exec(read.content)?.[1]?.trim() ?? path.basename(notePath).replace(/\.md$/i, '')
      return { path: notePath, title, score, sections: splitSections(read.content) }
    }),
  )
  const chunks = selectChunks(
    notes.filter((n) => n !== null),
    terms,
    { max: 6, budget: CONTEXT_CHARS },
  )
  return { chunks, scores: new Map(ranked.map((r) => [r.path, r.score])) }
}

/** A note the bot read for an answer, as the evals report it: which part, and how well its note ranked. */
export type ContextNote = { path: string; title: string; heading: string | null; score: number }

/**
 * Everything the model is given for one answer: the system prompt with the
 * notes found, and the conversation cut to fit. The chat and the evals both
 * go through this, so an eval measures what the chat does.
 */
/** A tool call made for an answer - by the harness itself, or (from 3.6) asked for by the model. */
export type ToolCall = {
  name: string
  args: Record<string, unknown>
  by: 'harness' | 'model'
  summary: string
  notes: string[]
  /** What it returned, as the model saw it (kept in eval results, not in reports). */
  result: string
}

export type Prepared = {
  system: string
  history: AiMessage[]
  chunks: Chunk[] | null
  /** Everything the answer was given to read, for the evals. */
  context: ContextNote[]
  route: Route | null
  toolCalls: ToolCall[]
  /** The notes to show under the answer. */
  sources: ContextNote[]
  /** Text the harness wrote itself, shown first; the model's reply follows it. */
  preface: string | null
}

/** What `prepare` may be told besides the conversation: the evals pin the date and switch parts off; the chat hears progress. */
export type PrepareOptions = { harness?: BotHarness; today?: Date; onProgress?: (text: string) => void }

export async function prepare(bot: Bot, messages: readonly AiMessage[], options: PrepareOptions = {}): Promise<Prepared> {
  const harness = options.harness ?? settings().harness
  const today = options.today ?? new Date()
  const model = modelOf(bot)
  const question = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const routed = harness.router ? await route(providerFor(model), model, messages, today) : null
  // Small talk and questions about Recto itself ask nothing of the vault: no search, no sources.
  const skip = routed !== null && (routed.kind === 'smalltalk' || routed.kind === 'self')
  const provider = providerFor(model)
  const toolOptions = {
    bot,
    question,
    provider,
    model,
    today: isoDate(today),
    looseTasks: harness.looseTasks,
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  }
  const toolCalls: ToolCall[] = []

  // Tasks and "what did I do" questions: the harness looks them up itself, for the period they name.
  if (routed !== null && harness.taskIndex && (routed.kind === 'tasks' || routed.kind === 'recent')) {
    const kind = routed.kind
    const period = routed.period ?? { from: isoDate(addDays(today, kind === 'tasks' ? -13 : -6)), to: isoDate(today) }
    options.onProgress?.(kind === 'tasks' ? 'Checking your tasks…' : 'Going through the notes of the period…')
    const result =
      kind === 'tasks'
        ? await tasksTool(period, 'all', routedTerms(question, routed), toolOptions)
        : await notesTool(period, [...routed.keywordsEn, ...routed.keywordsRu], toolOptions)
    toolCalls.push({
      name: kind === 'tasks' ? 'tasks_in_period' : 'notes_in_period',
      args: { from: period.from, to: period.to },
      by: 'harness',
      summary: result.summary,
      notes: result.notes.map((n) => n.title),
      result: result.text,
    })
    if (result.answer !== undefined) {
      // A task list a small model would drop items from: the harness shows it as it is, and the
      // model only adds one line of its own after it.
      const system = `${bot.system.trim()}\n\n## What the user was just shown, in answer to their message\n\n${result.answer}\n\nWrite ONE short sentence to follow it, in the language of the user's message - a remark or an offer. Don't repeat or change the list.`
      const history = fitHistory(messages, CONTEXT_TOKENS - ANSWER_TOKENS - estimateTokens(system))
      return {
        system,
        history,
        chunks: null,
        context: result.notes,
        route: routed,
        toolCalls,
        sources: result.notes,
        preface: result.answer,
      }
    }
    const system = `${bot.system.trim()}\n\n${result.text}`
    const history = fitHistory(messages, CONTEXT_TOKENS - ANSWER_TOKENS - estimateTokens(system))
    return { system, history, chunks: null, context: result.notes, route: routed, toolCalls, sources: result.notes, preface: null }
  }

  const found = skip ? null : await findContext(routedTerms(question, routed), bot)
  const chunks = found?.chunks ?? null
  const system = buildSystem(bot.system, chunks)
  const history = fitHistory(messages, CONTEXT_TOKENS - ANSWER_TOKENS - estimateTokens(system))
  const context = (chunks ?? []).map((c) => ({ path: c.path, title: c.title, heading: c.heading, score: found?.scores.get(c.path) ?? 0 }))
  return { system, history, chunks, context, route: routed, toolCalls, sources: context, preface: null }
}

const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

const running = new Map<string, AbortController>()

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
}): Promise<{ ok: true; sources: BotSource[] } | { ok: false; error: string; status?: BotModelStatus }> {
  const bot = list().find((b) => b.id === request.botId)
  if (bot === undefined) return { ok: false, error: 'That bot no longer exists.' }
  if (running.has(request.id)) return { ok: false, error: 'This bot is already answering.' }

  const model = modelOf(bot)
  const provider = providerFor(model)
  const ready = await provider.status(model)
  if (ready.state !== 'ready') return { ok: false, error: 'The model is not available.', status: ready }

  const { system, history, sources, preface } = await prepare(bot, request.messages, {
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
      for await (const text of provider.stream(history, system, { model, signal: controller.signal })) {
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
