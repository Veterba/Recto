import fs from 'node:fs'
import os from 'node:os'
import type { AiMessage } from '../../shared/ai'
import { send as indexer, openIndexForVault } from '../index-client'
import { openVault } from '../vault'
import { list, prepare, providerFor, type ContextNote, type ToolCall } from './index'
import { buildCards } from './cards'
import { syncVectors } from './vectors'
import type { BotSource, BotStep } from '../../shared/bots'
import { profileFor } from './models/profiles'
import type { StreamStats } from './provider'
import { answerWithTools } from './model-tools'
import type { Route } from './router'
import { DEFAULT_HARNESS, type BotHarness } from '../../shared/bots'

/**
 * The evals' way into the app (`npm run bots:eval`): with RECTO_EVAL_JOB set,
 * the app opens no window. It opens the job's vault - always a scratch copy -
 * waits for the index, and puts each case to Recto through `prepare` and the
 * model's provider, exactly as the chat does. One line per case goes to the
 * job's results file as soon as it is answered, so a crash keeps what was
 * done; the runner turns them into the report.
 */

export type EvalJob = {
  vault: string
  model: string
  /** JSON lines out: a `run` line first, then one `case` line per case. */
  out: string
  cases: { id: string; messages: AiMessage[] }[]
  /** The date the vault lives in (the fixture's 2026-09-30); the real date when absent. */
  today?: string
  /** Pipeline parts switched on or off for this run, over the defaults. */
  harness?: Partial<BotHarness>
  /**
   * Note cards and loose-task readings from earlier runs on the same vault
   * and model (JSON: the index's model cache). Read before the run, written
   * after, so they are built once, as the app builds them once.
   */
  cache?: string
}

export type EvalCaseResult = {
  type: 'case'
  id: string
  context: ContextNote[]
  answer: string
  error: string | null
  /** From sending to the first token, and to the end. */
  ttftMs: number | null
  totalMs: number
  /** Retrieval and prompt building, before the model is asked. */
  prepareMs: number
  stats: StreamStats | null
  router: Route | null
  toolCalls: ToolCall[]
  /** What the harness wrote itself before the model's words (a task list). */
  preface: string | null
  steps: BotStep[]
  /** The prompt the model answered from, for telling a quote from the notes apart from a claim. */
  contextText: string
  /** Tool calls the model wrote as text instead of calling. */
  toolParseFailures: number
}

/** No case may take longer than this: a stuck model fails the case, not the run. */
const CASE_TIMEOUT_MS = 180_000

const write = (out: string, line: object): void => fs.appendFileSync(out, `${JSON.stringify(line)}\n`)

export async function runEvalJob(jobPath: string): Promise<void> {
  const job = JSON.parse(fs.readFileSync(jobPath, 'utf8')) as EvalJob
  const opened = openVault(job.vault)
  if (!opened.ok) throw new Error(`Could not open the eval vault: ${'error' in opened ? opened.error : 'cancelled'}`)
  await openIndexForVault()

  const recto = list().find((b) => b.id === 'recto')
  if (recto === undefined) throw new Error('The eval vault has no Recto bot.')
  const bot = { ...recto, model: job.model }
  const harness: BotHarness = { ...DEFAULT_HARNESS, ...job.harness }
  // Noon, so no time zone turns the fixture's day into the one before.
  const today = job.today === undefined ? new Date() : new Date(`${job.today}T12:00:00`)
  const provider = providerFor(job.model)
  const status = await provider.status(job.model)
  if (status.state !== 'ready') throw new Error(`Model ${job.model} is not ready: ${status.state}`)

  // Chunk vectors, then note cards, before the first case - timed, since the app builds both in the background.
  let started = performance.now()
  const vectors = harness.hybridRetrieval ? await syncVectors(bot.exclude ?? []) : null
  const vectorsMs = performance.now() - started
  if (job.cache !== undefined && fs.existsSync(job.cache)) {
    const cached = JSON.parse(fs.readFileSync(job.cache, 'utf8')) as { cards: never[]; inferred: never[] }
    await indexer({ kind: 'model-cache-import', cards: cached.cards, inferred: cached.inferred }, 60_000)
  }
  started = performance.now()
  const cards = harness.noteCards
    ? await buildCards({
        provider,
        model: job.model,
        exclude: bot.exclude ?? [],
        background: false,
        signal: AbortSignal.timeout(3_600_000),
      })
    : null
  const cardsMs = performance.now() - started
  const saveCache = async (): Promise<void> => {
    if (job.cache === undefined) return
    const cache = await indexer({ kind: 'model-cache-export' }, 60_000)
    if (cache.kind === 'model-cache') fs.writeFileSync(job.cache, JSON.stringify({ cards: cache.cards, inferred: cache.inferred }))
  }
  await saveCache()

  const stats = await indexer({ kind: 'stats' })
  write(job.out, {
    type: 'run',
    system: bot.system,
    profile: profileFor(job.model),
    harness,
    notes: stats.kind === 'stats-result' ? stats.notes : null,
    cpu: os.cpus()[0]?.model ?? '',
    ramBytes: os.totalmem(),
    build: {
      vectors: vectors === null ? null : { ...vectors, ms: vectorsMs },
      cards: cards === null ? null : { ...cards, ms: cardsMs },
    },
  })

  for (const item of job.cases) {
    let started = performance.now()
    const loop = { calls: [] as ToolCall[], parseFailures: 0 }
    const result: EvalCaseResult = {
      type: 'case',
      id: item.id,
      context: [],
      answer: '',
      error: null,
      ttftMs: null,
      totalMs: 0,
      prepareMs: 0,
      stats: null,
      router: null,
      toolCalls: [],
      preface: null,
      steps: [],
      contextText: '',
      toolParseFailures: 0,
    }
    try {
      // A follow-up stands on what the earlier answer read: its sources are worked out the same way first.
      const earlier = item.messages.slice(0, -1)
      let sticky: BotSource[] | undefined
      if (harness.stickyContext && earlier.some((m) => m.role === 'assistant')) {
        const upTo = earlier.map((m) => m.role).lastIndexOf('user')
        if (upTo >= 0) {
          const before = await prepare(bot, earlier.slice(0, upTo + 1), { harness, provider, model: job.model, today })
          sticky = before.sources.map((c) => ({ path: c.path, heading: c.heading }))
        }
      }
      // The earlier answer's own search is not this answer's time.
      started = performance.now()
      const prepared = await prepare(bot, item.messages, {
        harness,
        provider,
        model: job.model,
        today,
        ...(sticky === undefined ? {} : { sticky }),
      })
      result.steps = prepared.steps
      result.contextText = prepared.system
      result.preface = prepared.preface
      result.context = prepared.context
      result.router = prepared.route
      result.toolCalls = prepared.toolCalls
      result.prepareMs = performance.now() - started
      if (prepared.preface !== null) {
        result.ttftMs = performance.now() - started
        result.answer = `${prepared.preface}\n\n`
      }
      const signal = AbortSignal.timeout(CASE_TIMEOUT_MS)
      const options = { model: job.model, signal, maxTokens: prepared.maxTokens, onStats: (s: StreamStats) => (result.stats = s) }
      const reply =
        harness.tools && prepared.toolContext !== null
          ? answerWithTools(provider, prepared.history, prepared.system, {
              ...options,
              advisor: prepared.advisor,
              context: prepared.toolContext,
              result: loop,
              onStep: (st) => result.steps.push(st),
            })
          : provider.stream(prepared.history, prepared.system, options)
      for await (const text of reply) {
        result.ttftMs ??= performance.now() - started
        result.answer += text
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err)
    }
    result.totalMs = performance.now() - started
    result.toolCalls = [...result.toolCalls, ...loop.calls]
    result.toolParseFailures = loop.parseFailures
    write(job.out, result)
  }
  await saveCache()
}
