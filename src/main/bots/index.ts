import { BrowserWindow } from 'electron'
import path from 'node:path'
import type { AiMessage } from '../../shared/ai'
import {
  BOTS_FOLDER,
  CHATS_FOLDER,
  DEFAULT_BOT_MODEL,
  type Bot,
  type BotModelStatus,
  type BotSettings,
  type BotSource,
} from '../../shared/bots'
import { IPC_EVENT, type IpcEvents } from '../../shared/ipc'
import { botsMock } from '../config'
import { sendEvent } from '../events'
import { send as indexer } from '../index-client'
import { readState, writeState } from '../store'
import { currentVault } from '../vault'
import * as vaultFs from '../vault-fs'
import { buildSystem, estimateTokens, fitHistory, queryTerms, rankNotes, selectChunks, splitSections } from './context'
import { cleanTitle } from '../../shared/chat-topics'
import { listBots, writeBotModel } from './definitions'
import { AnthropicProvider, CONTEXT_TOKENS, MockProvider, OllamaProvider, isApiModel, type BotModelProvider } from './provider'
import { readKey } from '../secrets'

/**
 * Bots, on the main side: who they are, whether their model can run, and
 * asking one. The renderer sees text and source paths come back; the vault
 * search, the prompt and the connection to the model all happen here.
 */

const local: BotModelProvider = botsMock() ? new MockProvider() : new OllamaProvider()
const api: BotModelProvider = botsMock() ? new MockProvider() : new AnthropicProvider(readKey)

/** The model's provider: an Anthropic model when it is one of the API models, otherwise Ollama on this Mac. */
const providerFor = (model: string): BotModelProvider => (isApiModel(model) ? api : local)

/** Notes ranked per question, and the most of them read from disk for sections. */
const NOTES_TO_READ = 8
/** Room left in the context window for the answer itself. */
const ANSWER_TOKENS = 1024
/** The context's share of the window: the notes, in characters. */
const CONTEXT_CHARS = 6000

export function settings(): BotSettings {
  return { defaultModel: readState().botDefaultModel ?? DEFAULT_BOT_MODEL }
}

export function setSettings(patch: Partial<BotSettings>): BotSettings {
  const model = patch.defaultModel?.trim()
  if (model !== undefined) writeState({ botDefaultModel: model === '' ? undefined : model })
  return settings()
}

export function list(): Bot[] {
  const vault = currentVault()
  return vault === null ? [] : listBots(vault.path)
}

const modelOf = (bot: Bot | undefined): string => bot?.model ?? settings().defaultModel

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

/** A bot's model, changed from its chat: an API model id, an Ollama model, or null for the local default. */
export function setModel(botId: string, model: string | null): Bot[] {
  const vault = currentVault()
  if (vault !== null) writeBotModel(vault.path, botId, model)
  return list()
}

/**
 * The vault's best parts for a question, within budget, skipping chats and the
 * bot's excluded folders. Null when the message asks nothing of the vault -
 * small talk, no words worth searching for - so nothing is read at all.
 */
async function findContext(question: string, bot: Bot): Promise<ReturnType<typeof selectChunks> | null> {
  const terms = queryTerms(question)
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
  return selectChunks(
    notes.filter((n) => n !== null),
    terms,
    { max: 6, budget: CONTEXT_CHARS },
  )
}

const running = new Map<string, AbortController>()

function push<C extends typeof IPC_EVENT.botsDelta | typeof IPC_EVENT.botsDone | typeof IPC_EVENT.botsError>(
  channel: C,
  ...args: Parameters<IpcEvents[C]>
): void {
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
  const question = [...request.messages].reverse().find((m) => m.role === 'user')?.content ?? ''

  const model = modelOf(bot)
  const provider = providerFor(model)
  const ready = await provider.status(model)
  if (ready.state !== 'ready') return { ok: false, error: 'The model is not available.', status: ready }

  const chunks = await findContext(question, bot)
  const system = buildSystem(bot.system, chunks)
  const history = fitHistory(request.messages, CONTEXT_TOKENS - ANSWER_TOKENS - estimateTokens(system))

  const controller = new AbortController()
  running.set(request.id, controller)
  // Not awaited: `bots:send` resolves once the request is under way, and the
  // reply arrives on the push channels.
  void (async () => {
    try {
      for await (const text of provider.stream(history, system, { model, signal: controller.signal })) {
        push(IPC_EVENT.botsDelta, { id: request.id, text })
      }
      push(IPC_EVENT.botsDone, { id: request.id })
    } catch (err) {
      if (controller.signal.aborted) push(IPC_EVENT.botsDone, { id: request.id })
      else push(IPC_EVENT.botsError, { id: request.id, message: err instanceof Error ? err.message : String(err) })
    } finally {
      running.delete(request.id)
    }
  })()

  return { ok: true, sources: (chunks ?? []).map(({ path: p, heading }) => ({ path: p, heading })) }
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
