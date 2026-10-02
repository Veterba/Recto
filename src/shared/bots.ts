/**
 * Bots: small assistants under the main chat, each with its own character,
 * running on a local model. Shared by main (which reads their definitions,
 * builds their prompts and runs the model) and the renderer (which lists them
 * and shows their chats).
 */

import type { AiMessage } from './ai'
import type { BotLook, BotPersonality } from './bot-presets'

/** Where conversations live, the main chat's and the bots'. A real folder, hidden from the file tree. */
export const CHATS_FOLDER = 'chats'

/** Where bot definitions live in the vault: one folder per bot. */
export const BOTS_FOLDER = '.recto/bots'

/** What `.recto/bots/<id>/bot.json` holds. */
export type BotDefinition = {
  id: string
  name: string
  /** One line: what this bot is good at. */
  specialty: string
  look: BotLook
  personality: BotPersonality
  /** The Ollama model; absent or empty means the default bot model from Settings → Bots. */
  model?: string
  /** Vault folders this bot never reads, e.g. "Journal". Default: none. */
  exclude?: string[]
}

/** A bot as the app uses it: its definition and its SYSTEM.md. */
export type Bot = BotDefinition & { system: string }

/** A part of a note the bot was given to answer from. */
export type BotSource = { path: string; heading: string | null }

/** A turn in a bot's thread: the main chat's message, plus what the bot read for it. */
export type BotMessage = AiMessage & { sources?: BotSource[] }

/**
 * Whether a bot's model can run, each state with its own fix: Ollama not
 * running (open it), the model not downloaded (pull it), an API model with no
 * key saved (add one), or ready.
 */
export type BotModelStatus =
  | { state: 'ready'; model: string }
  | { state: 'not-running'; model: string }
  | { state: 'no-model'; model: string; installed: string[] }
  | { state: 'no-key'; model: string }

export type BotSettings = {
  /** The model a bot uses when its definition names none. */
  defaultModel: string
}

/** The model proposed for a 16 GB Apple silicon Mac: Qwen 3.5, 9B, 4-bit - about 6 GB in memory. */
export const DEFAULT_BOT_MODEL = 'qwen3.5:9b'

/** Where a bot's threads live: a folder of its own under the chats folder. */
export const botThreadFolder = (botId: string): string => `${CHATS_FOLDER}/${botId}`
