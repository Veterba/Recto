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

/** One thing the bot did while working on an answer, as the steps card shows it: "Searching notes → “Recto plan”". */
export type BotStep = { action: string; result: string; state: 'running' | 'done' | 'failed' }

/**
 * What is known about a message besides its text, kept with it in the topic
 * file (`<!-- recto:meta {...} -->`). Every field is optional and only the
 * ones that exist are written.
 */
export type MessageMeta = {
  /** When it was written: local ISO time, to the second. */
  at?: string
  /** The model that wrote an answer. */
  model?: string
  /** What the bot read for an answer. */
  sources?: BotSource[]
  /** What the bot did on the way to an answer. */
  steps?: BotStep[]
  /** Milliseconds to the first token, and to the end. */
  ttftMs?: number
  totalMs?: number
}

/** A turn in a bot's thread: the text, and what is known about it. */
export type BotMessage = AiMessage & MessageMeta

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
  /** Being loaded into memory (after a switch, or on opening the chat): Send waits for it. */
  | { state: 'loading'; model: string }

/** A local model in the picker: installed or recommended, its size on disk, and what it means on this Mac. */
export type ModelChoice = {
  name: string
  bytes: number
  installed: boolean
  /** "Recommended", "Too big for this Mac", "Better languages, slower, tight on 16 GB"... */
  hint: string
  /** False when it would not fit this Mac's memory: shown, not selectable. */
  fits: boolean
  /** No profile was written for its family. */
  untested: boolean
}

/** A model download in progress. */
export type PullProgress = { name: string; status: string; completed: number; total: number }

export type BotSettings = {
  /** The model a bot uses when its definition names none. */
  defaultModel: string
}

/** The model proposed for a 16 GB Apple silicon Mac: Qwen 3.5, 9B, 4-bit - about 6 GB in memory. */
export const DEFAULT_BOT_MODEL = 'qwen3.5:9b'

/** Where a bot's threads live: a folder of its own under the chats folder. */
export const botThreadFolder = (botId: string): string => `${CHATS_FOLDER}/${botId}`
