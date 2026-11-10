import { syncVectors } from './vectors'
import { BrowserWindow, Notification, powerSaveBlocker } from 'electron'
import type { AiMessage } from '../../shared/ai'
import { botThreadFolder, isActive, type Bot, type BotJob, type BotMessage, type BotSource, type BotStep } from '../../shared/bots'
import { appendTurns, cleanTitle, createdStamp, parseTopic, topicFile, topicFileName, type ChatTopicMeta } from '../../shared/chat-topics'
import { langOfText } from '../../shared/bot-status'
import { answerLang, honestAnswer } from './honesty'
import { IPC_EVENT } from '../../shared/ipc'
import { sendEvent } from '../events'
import { markSelfWrite } from '../watcher'
import * as vaultFs from '../vault-fs'
import { currentVault } from '../vault'
import { ensureReadme } from '../boards'
import { Jobs, type RunControls } from './jobs'
import { answerWithTools } from './model-tools'
import { prepare } from './prepare'
import type { BotModelProvider } from './provider'
import type { BotHarness, BotModelStatus, BotSettings } from '../../shared/bots'
import { AI_ACCESS_STATE, coerceAiAccess } from '../../shared/ai-access'
import { isCloudModel, providerInfo, providerOf } from '../../shared/providers'
import { readState } from '../state'
import { closeSession, openSession, recordOf } from '../vault-tools'
import { sourcesOf } from '../../shared/answer-record'
import { proposal } from '../vault-tools/proposals'
import { run as runProvider } from '../providers'
import { ProviderError } from '../providers/run'
import { chatSystem, forCloud } from '../providers/prompts'

/**
 * Answers, run by main from the question to the last token and written into
 * the topic file as they stream (bots/jobs.ts is the queue). The chat only
 * watches: it can close, reopen or reload and find the answer where it got
 * to. A topic file is only written here while it has a job, so the question
 * and the answer can never overwrite each other.
 */

export type AnswerDeps = {
  bots: () => Bot[]
  modelOf: (bot: Bot) => string
  providerFor: (model: string) => BotModelProvider
  /** Whether the model can answer: a local model's state, or a cloud provider's readiness. */
  status: (model: string) => Promise<BotModelStatus>
  settings: () => BotSettings
  /** Before a run: the background note cards give the model back. */
  beforeRun: () => void
}

/** The title a topic has until its first exchange names it. */
const UNTITLED = 'New topic'
/** How often a streaming answer is written to its topic file. */
const WRITE_EVERY_MS = 1000
/** How often a streaming answer is pushed to the chat. */
const PUSH_EVERY_MS = 60

let deps: AnswerDeps | null = null
let blocker: number | null = null
/** What each bot's chat is showing, and whether it is on screen (the renderer says). */
const viewing = new Map<string, { topic: string | null; visible: boolean }>()

const window0 = (): BrowserWindow | null => {
  const w = BrowserWindow.getAllWindows()[0]
  return w === undefined || w.isDestroyed() ? null : w
}

let lastPush = 0
let pushTimer: NodeJS.Timeout | null = null
const pendingPush = new Map<string, BotJob>()
function pushJob(job: BotJob): void {
  pendingPush.set(job.id, job)
  const flush = (): void => {
    pushTimer = null
    lastPush = Date.now()
    const w = window0()
    for (const j of pendingPush.values()) if (w !== null) sendEvent(w, IPC_EVENT.botsJob, j)
    pendingPush.clear()
  }
  // Text arrives token by token: pushed at most every PUSH_EVERY_MS; anything else at once.
  if (job.state !== 'streaming') flush()
  else if (pushTimer === null) pushTimer = setTimeout(flush, Math.max(0, PUSH_EVERY_MS - (Date.now() - lastPush)))
}

export const jobs = new Jobs({
  run: (job, controls) => runJob(job, controls),
  onChange: (job) => {
    pushJob(job)
    if (job.state === 'done') notify(job)
  },
  onBusy: (busy) => {
    // Keep running with the window hidden or the app in the background: no App Nap while an answer runs.
    if (busy && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension')
    if (!busy && blocker !== null) {
      powerSaveBlocker.stop(blocker)
      blocker = null
    }
  },
})

export function initAnswers(d: AnswerDeps): void {
  deps = d
}

const botOf = (id: string): Bot | undefined => deps?.bots().find((b) => b.id === id)
const assistantsOf = (bot: Bot): string[] => (bot.id === 'recto' ? [bot.name, 'Claude'] : [bot.name])

type TopicText = { meta: ChatTopicMeta; extra: string[]; body: string }

async function readTopic(path: string, bot: Bot): Promise<TopicText | null> {
  const read = await vaultFs.readFile(path)
  if (!read.ok) return null
  const parsed = parseTopic(read.content, assistantsOf(bot))
  const name = path.slice(path.lastIndexOf('/') + 1)
  return {
    meta: { bot: parsed.meta.bot ?? bot.id, created: parsed.meta.created ?? name.slice(0, 16), title: parsed.meta.title ?? UNTITLED },
    extra: parsed.extra,
    body: parsed.body,
  }
}

/** Throws when the write fails: an answer that never reached the file must not end as done. */
async function writeTopic(path: string, t: TopicText): Promise<void> {
  markSelfWrite(path)
  const written = await vaultFs.writeFile(path, topicFile(t.meta, t.extra, t.body))
  if (!written.ok) throw new Error(`Could not save the topic: ${written.error ?? 'unknown error'}`)
}

/**
 * A question for a bot: written into its topic (a new one when `topic` is
 * null) and queued. A topic already answering keeps the question in the
 * job until its turn, so the file never gets it ahead of the answer before.
 */
export async function send(request: {
  botId: string
  topic: string | null
  text: string
  at?: string
}): Promise<{ ok: true; topic: string; job: BotJob } | { ok: false; error: string; status?: BotModelStatus }> {
  const bot = botOf(request.botId)
  if (bot === undefined || deps === null) return { ok: false, error: 'That bot no longer exists.' }
  const text = request.text.trim()
  if (text === '') return { ok: false, error: 'Nothing to send.' }
  const model = deps.modelOf(bot)
  const ready = await deps.status(model)
  if (ready.state !== 'ready' && ready.state !== 'loading') return { ok: false, error: 'The model is not available.', status: ready }

  let topic = request.topic
  const at = request.at !== undefined && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(request.at) ? request.at : createdStamp(new Date())
  const turn: BotMessage = { role: 'user', content: text, at }
  if (topic === null) {
    const meta: ChatTopicMeta = { bot: bot.id, created: at, title: UNTITLED }
    const name = topicFileName(meta.created, meta.title)
    markSelfWrite(`${botThreadFolder(bot.id)}/${name}`)
    const created = await vaultFs.create(botThreadFolder(bot.id), name, 'file')
    const vault = currentVault()
    if (created.ok && vault !== null) ensureReadme(vault.path)
    if (!created.ok) return { ok: false, error: 'Could not start a topic.' }
    topic = created.path
    const first = await writeTopic(topic, { meta, extra: [], body: appendTurns('', [turn], bot.name) }).catch((err: unknown) => err)
    if (first instanceof Error) return { ok: false, error: first.message }
    return { ok: true, topic, job: jobs.enqueue({ botId: bot.id, topic, model, question: null, lang: langOfText(text) }) }
  }
  if (jobs.busy(topic))
    return { ok: true, topic, job: jobs.enqueue({ botId: bot.id, topic, model, question: text, lang: langOfText(text) }) }
  const current = await readTopic(topic, bot)
  if (current === null) return { ok: false, error: 'That topic is gone.' }
  const added = await writeTopic(topic, { ...current, body: appendTurns(current.body, [turn], bot.name) }).catch((err: unknown) => err)
  if (added instanceof Error) return { ok: false, error: added.message }
  return { ok: true, topic, job: jobs.enqueue({ botId: bot.id, topic, model, question: null, lang: langOfText(text) }) }
}

/**
 * A Quick ask thread kept: a new topic with the bot, holding the thread's
 * turns as they were, so it continues in the chat panel like any other.
 */
export async function saveThread(request: { botId: string; messages: BotMessage[] }): Promise<{ ok: true; topic: string } | { ok: false; error: string }> {
  const bot = botOf(request.botId)
  if (bot === undefined) return { ok: false, error: 'That bot no longer exists.' }
  const first = request.messages.find((m) => m.role === 'user')
  if (first === undefined) return { ok: false, error: 'Nothing to keep yet.' }
  const at = first.at !== undefined && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(first.at) ? first.at : createdStamp(new Date())
  const meta: ChatTopicMeta = { bot: bot.id, created: at, title: cleanTitle(first.content) ?? UNTITLED }
  const name = topicFileName(meta.created, meta.title)
  markSelfWrite(`${botThreadFolder(bot.id)}/${name}`)
  const created = await vaultFs.create(botThreadFolder(bot.id), name, 'file')
  if (!created.ok) return { ok: false, error: 'Could not keep it as a chat.' }
  const vault = currentVault()
  if (vault !== null) ensureReadme(vault.path)
  const written = await writeTopic(created.path, { meta, extra: [], body: appendTurns('', request.messages, bot.name) }).catch((err: unknown) => err)
  if (written instanceof Error) return { ok: false, error: written.message }
  return { ok: true, topic: created.path }
}

/** Ask again for the topic as it stands: after an error or an interrupted answer. */
export function retry(request: { botId: string; topic: string }): { ok: boolean; job?: BotJob } {
  const bot = botOf(request.botId)
  if (bot === undefined || deps === null || jobs.busy(request.topic)) return { ok: false }
  return { ok: true, job: jobs.enqueue({ botId: bot.id, topic: request.topic, model: deps.modelOf(bot), question: null }) }
}

export function setViewing(v: { botId: string; topic: string | null; visible: boolean }): void {
  viewing.set(v.botId, { topic: v.topic, visible: v.visible })
}

/** An answer finished out of sight: a macOS notification, unless they are off or the chat is on screen. */
function notify(job: BotJob): void {
  const w = window0()
  const view = viewing.get(job.botId)
  const onScreen = w !== null && w.isVisible() && !w.isMinimized() && w.isFocused() && view?.visible === true && view.topic === job.topic
  if (onScreen) return
  if (w !== null) sendEvent(w, IPC_EVENT.botsUnread, { botId: job.botId, topic: job.topic })
  if (deps?.settings().notify === false || !Notification.isSupported()) return
  const bot = botOf(job.botId)
  void readTopic(job.topic, bot ?? ({ id: job.botId, name: job.botId } as Bot)).then((t) => {
    const n = new Notification({ title: `${bot?.name ?? 'Recto'} answered`, body: t?.meta.title ?? '', silent: false })
    n.on('click', () => {
      const win = window0()
      if (win === null) return
      win.show()
      win.focus()
      sendEvent(win, IPC_EVENT.botsOpenTopic, { botId: job.botId, topic: job.topic })
    })
    n.show()
  })
}

/** One answer, from reading its topic to its last token; written into the topic as it streams. */
async function runJob(job: BotJob, controls: RunControls): Promise<void> {
  const d = deps
  let bot = botOf(job.botId)
  if (d === null || bot === undefined) throw new Error('That bot no longer exists.')
  const started = performance.now()
  d.beforeRun()
  let topic = await readTopic(job.topic, bot)
  if (topic === null) throw new Error('That topic is gone.')
  // A question that waited for the answer before it goes in now.
  if (job.question !== null) {
    topic = { ...topic, body: appendTurns(topic.body, [{ role: 'user', content: job.question, at: createdStamp(new Date()) }], bot.name) }
    await writeTopic(job.topic, topic)
    controls.update({ question: null })
  }
  const parsed = parseTopic(topicFile(topic.meta, topic.extra, topic.body), assistantsOf(bot))
  const excluded = coerceAiAccess(readState(AI_ACCESS_STATE)).excluded
  // An interrupted answer is not part of the conversation the model sees - nor one left half
  // written by a job that never finished (the app was killed): it still carries the job's id.
  const turns = parsed.messages.filter((m) => !(m.role === 'assistant' && (m.interrupted === true || m.job !== undefined)))
  const messages: AiMessage[] = turns.map(({ role, content }) => ({ role, content }))
  // A retry knows its question only now.
  const question = messages.findLast((m) => m.role === 'user')?.content
  if (question !== undefined) controls.update({ lang: langOfText(question) })
  const sticky: BotSource[] = turns
    .filter((m) => m.role === 'assistant')
    .slice(-2)
    .flatMap((m) => m.sources ?? [])

  if (isCloudModel(job.model)) return runCloudJob(job, controls, d, bot, topic, forCloud(turns, excluded, (id) => proposal(id)?.status ?? null), started)

  const harness: BotHarness = d.settings().harness
  const provider = d.providerFor(job.model)
  // Folders excluded from AI (Settings → AI) are excluded for every provider, this Mac's too.
  bot = { ...bot, exclude: [...(bot.exclude ?? []), ...excluded] }
  // The vectors are built in the background only on the charger and while
  // you are away (background-gate.ts): here, the notes changed since are
  // brought up to date first, so a question never searches stale ones.
  if (harness.hybridRetrieval) await syncVectors(bot.exclude ?? []).catch((err: unknown) => console.error('[bots] vectors', err))
  const prepared = await prepare(bot, messages, {
    harness,
    provider,
    model: job.model,
    sticky,
    onSteps: (steps) => controls.update({ steps }),
  })
  const sources = prepared.sources.map(({ path, heading }) => ({ path, heading }))
  controls.update({ sources })
  if (controls.signal.aborted) throw new Error('cancelled')

  const base = topic.body
  let text = prepared.preface ?? ''
  let first = 0
  const turn = (final: boolean, interrupted = false): BotMessage => ({
    role: 'assistant',
    content: text,
    at: job.at,
    model: job.model,
    sources,
    ...(prepared.steps.length > 0 ? { steps: prepared.steps } : {}),
    ...(final ? {} : { job: job.id }),
    ...(final && first > 0 ? { ttftMs: Math.round(first - started) } : {}),
    ...(final ? { totalMs: Math.round(performance.now() - started) } : {}),
    ...(interrupted ? { interrupted: true } : {}),
  })
  const save = (final: boolean, interrupted = false): Promise<void> =>
    text.trim() === ''
      ? Promise.resolve()
      : writeTopic(job.topic, { ...topic, body: appendTurns(base, [turn(final, interrupted)], bot.name) })
  let lastWrite = 0
  let writing: Promise<void> = Promise.resolve()

  if (prepared.preface !== null) {
    first = performance.now()
    controls.update({ state: 'streaming', text })
  }
  try {
    const options = { model: job.model, signal: controls.signal, maxTokens: prepared.maxTokens }
    const reply =
      harness.tools && prepared.toolContext !== null
        ? answerWithTools(provider, prepared.history, prepared.system, {
            ...options,
            advisor: prepared.advisor,
            context: prepared.toolContext,
            result: { calls: [], parseFailures: 0 },
          })
        : provider.stream(prepared.history, prepared.system, options)
    let joined = prepared.preface === null
    // What the model says, and what is shown and saved: the same, except that
    // a claim to have changed a note - Recto cannot - becomes the honest sentence.
    let raw = text
    const lang = answerLang(question ?? '')
    for await (const piece of reply) {
      if (first === 0) first = performance.now()
      raw += joined ? piece : `\n\n${piece.trimStart()}`
      text = honestAnswer(raw, lang)
      joined = true
      controls.update({ state: 'streaming', text })
      if (Date.now() - lastWrite > WRITE_EVERY_MS) {
        lastWrite = Date.now()
        // A failed in-between save is not the end: the final one below is
        // what must land, and it throws if it does not.
        writing = writing.then(() => save(false)).catch((err: unknown) => console.error('[bots] save', err))
      }
    }
  } catch (err) {
    await writing
    const reason = jobs.abortReason(job.id)
    // Deleted: nothing more is written. Stopped: kept as it is. Failed or stalled: kept, marked for Retry.
    if (reason !== 'discard') await save(true, reason !== 'cancel')
    throw err
  }
  await writing
  if (controls.signal.aborted) {
    if (jobs.abortReason(job.id) !== 'discard') await save(true, jobs.abortReason(job.id) !== 'cancel')
    return
  }
  await save(true)
}

/**
 * An answer from a cloud provider: an agent with Recto's tools, not the
 * local pipeline (router, retrieval, scope tools) a small model needs. It
 * streams into the topic like any answer; its steps are its tool calls, its
 * sources the notes those calls returned, its writes Suggested edits.
 */
async function runCloudJob(
  job: BotJob,
  controls: RunControls,
  d: AnswerDeps,
  bot: Bot,
  topic: TopicText,
  messages: AiMessage[],
  started: number,
): Promise<void> {
  const session = openSession({ client: `recto-chat · ${providerInfo(providerOf(job.model)).name}`, tools: null, notes: null, writable: null })
  const base = topic.body
  let text = ''
  let steps: BotStep[] = []
  let first = 0
  const sources = (): BotSource[] => sourcesOf(recordOf(session)).map((path) => ({ path, heading: null }))
  const turn = (final: boolean, interrupted = false): BotMessage => ({
    role: 'assistant',
    content: text,
    at: job.at,
    model: job.model,
    sources: sources(),
    ...(steps.length > 0 ? { steps } : {}),
    record: recordOf(session),
    ...(final ? {} : { job: job.id }),
    ...(final && first > 0 ? { ttftMs: Math.round(first - started) } : {}),
    ...(final ? { totalMs: Math.round(performance.now() - started) } : {}),
    ...(interrupted ? { interrupted: true } : {}),
  })
  const save = (final: boolean, interrupted = false): Promise<void> =>
    text.trim() === '' ? Promise.resolve() : writeTopic(job.topic, { ...topic, body: appendTurns(base, [turn(final, interrupted)], bot.name) })
  let lastWrite = 0
  let writing: Promise<void> = Promise.resolve()
  try {
    const system = await chatSystem(session)
    for await (const event of runProvider({ model: job.model, system, messages, session, signal: controls.signal }, d.providerFor(''))) {
      if (event.type === 'steps') {
        steps = event.steps
        controls.update({ steps, sources: sources() })
        continue
      }
      if (first === 0) first = performance.now()
      text += event.text
      controls.update({ state: 'streaming', text })
      if (Date.now() - lastWrite > WRITE_EVERY_MS) {
        lastWrite = Date.now()
        writing = writing.then(() => save(false)).catch((err: unknown) => console.error('[bots] save', err))
      }
    }
  } catch (err) {
    await writing
    if (err instanceof ProviderError) controls.update({ problem: err.problem })
    const reason = jobs.abortReason(job.id)
    if (reason !== 'discard') await save(true, reason !== 'cancel')
    throw err
  } finally {
    closeSession(session.id)
  }
  await writing
  if (controls.signal.aborted) {
    if (jobs.abortReason(job.id) !== 'discard') await save(true, jobs.abortReason(job.id) !== 'cancel')
    return
  }
  controls.update({ sources: sources() })
  await save(true)
}

/**
 * Quitting with an answer running: it is stopped and saved as far as it got,
 * marked interrupted (with Retry). Resolves once nothing runs, or after 5 s.
 */
export function stopAnswers(): Promise<void> {
  if (!jobs.list().some(isActive)) return Promise.resolve()
  jobs.stopAll()
  const until = Date.now() + 5000
  return new Promise((resolve) => {
    const check = (): void => {
      if (!jobs.list().some(isActive) || Date.now() > until) resolve()
      else setTimeout(check, 50)
    }
    check()
  })
}
