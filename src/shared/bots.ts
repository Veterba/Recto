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

/**
 * The eval runner's folder in the vault (found by this name anywhere) and its
 * hidden raw data. Recto never reads its own old answers: both are out of bot
 * retrieval, note cards, the task index and the vault map.
 */
export const EVALS_FOLDER_NAME = 'Evals Qwen'
export const EVALS_DATA_FOLDER = '.recto/evals'
export const isEvalsPath = (p: string): boolean =>
  new RegExp(`(^|/)${EVALS_FOLDER_NAME}(/|$)`, 'i').test(p) || p.toLowerCase().startsWith(`${EVALS_DATA_FOLDER}/`)

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

/** A bot as the app uses it: its definition, its SYSTEM.md and its few-shot examples (EXAMPLES.md, by answer kind). */
export type Bot = BotDefinition & { system: string; examples?: Record<string, string> }

/** A part of a note the bot was given to answer from. */
export type BotSource = { path: string; heading: string | null }

/** What a step does, for the status text beside the working face (shared/bot-status.ts). */
export type StepKind = 'tasks' | 'period' | 'read' | 'open' | 'search' | 'map'

/**
 * One thing the bot did while working on an answer, as the steps card shows it: "Searching notes → “Recto plan”".
 * `kind` and `subject` ("Tutta", «прошлую неделю») word the status text; older messages have neither.
 */
export type BotStep = { action: string; result: string; state: 'running' | 'done' | 'failed'; kind?: StepKind; subject?: string }

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
  /** Written while the answer streams in: the job writing it (bots/jobs.ts). */
  job?: string
  /** The answer stopped before its end (the app quit, a timeout): kept as far as it got, with Retry. */
  interrupted?: boolean
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

/**
 * Note cards built in the background (Settings → Bots: "Note cards: 412/530"):
 * running, waiting for the user to step away, paused on a low battery, or done.
 */
export type NoteCardsStatus = { done: number; total: number; state: 'idle' | 'running' | 'waiting' | 'paused-battery' | 'done' | 'off' }

/**
 * An answer being worked on, owned by main (bots/jobs.ts): queued behind
 * others (one model run at a time on this Mac), preparing (routing, tools,
 * search), streaming, or ended. The chat, History and the sidebar row show it;
 * closing the chat only stops watching it.
 */
export type JobState = 'queued' | 'preparing' | 'streaming' | 'done' | 'error' | 'cancelled'

export type BotJob = {
  id: string
  botId: string
  /** The topic file it answers in. */
  topic: string
  state: JobState
  /** Place in the queue: 0 while it runs, 1 for next, … */
  position: number
  /** The question, while it waits behind another answer in its topic (not in the file yet). */
  question: string | null
  steps: BotStep[]
  /** The question's language: the status text and the steps are in it. */
  lang: 'en' | 'ru'
  text: string
  sources: BotSource[]
  model: string
  /** When the answer began (local ISO), for its message. */
  at: string
  error: string | null
}

export const isActive = (job: Pick<BotJob, 'state'>): boolean =>
  job.state === 'queued' || job.state === 'preparing' || job.state === 'streaming'

/** A model download in progress. */
export type PullProgress = { name: string; status: string; completed: number; total: number }

/**
 * The parts of a bot's answer pipeline, each one switchable, so an eval can
 * say what was on - and a part that turns out worse can be turned off.
 */
export type BotHarness = {
  /** One short call first: what kind of message, what to search for, which period (router.ts). */
  router: boolean
  /** Before the router's model call: the question's vector against example questions (classify.ts). */
  classifier: boolean
  /** Tasks and "what did I do" questions answered from the task index and the period's notes. */
  taskIndex: boolean
  /** Tasks written as plain text, read out of the period's notes by the model (cached). */
  looseTasks: boolean
  /** Words (FTS5) and chunk vectors, fused (retrieve.ts). */
  hybridRetrieval: boolean
  /** Named notes and named scopes resolved in code (resolve.ts). */
  namedNotes: boolean
  /** Review and advice questions: the scope tools (vault map, notes of a scope, outlines, patterns), grouped task lists. */
  scopeTools: boolean
  /** Note cards, built by the local model in the background, read by the scope tools. */
  noteCards: boolean
  /** The model may call search_notes / read_note / tasks_in_period / notes_in_period itself. */
  tools: boolean
  stickyContext: boolean
  steps: boolean
}

export const DEFAULT_HARNESS: BotHarness = {
  router: true,
  classifier: true,
  taskIndex: true,
  looseTasks: true,
  hybridRetrieval: true,
  namedNotes: true,
  scopeTools: true,
  noteCards: true,
  tools: false,
  stickyContext: true,
  steps: true,
}

export type BotSettings = {
  /** The model a bot uses when its definition names none. */
  defaultModel: string
  /** A macOS notification when an answer finishes while its chat is out of sight. */
  notify: boolean
  harness: BotHarness
}

/** The model proposed for a 16 GB Apple silicon Mac: Qwen 3.5, 9B, 4-bit - about 6 GB in memory. */
export const DEFAULT_BOT_MODEL = 'qwen3.5:9b'

/** Where a bot's threads live: a folder of its own under the chats folder. */
export const botThreadFolder = (botId: string): string => `${CHATS_FOLDER}/${botId}`
