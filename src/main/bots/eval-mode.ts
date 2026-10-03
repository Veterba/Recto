import fs from 'node:fs'
import os from 'node:os'
import type { AiMessage } from '../../shared/ai'
import { send as indexer, openIndexForVault } from '../index-client'
import { openVault } from '../vault'
import { list, prepare, providerFor, type ContextNote } from './index'
import { profileFor } from './models/profiles'
import type { StreamStats } from './provider'

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
  const provider = providerFor(job.model)
  const status = await provider.status(job.model)
  if (status.state !== 'ready') throw new Error(`Model ${job.model} is not ready: ${status.state}`)

  const stats = await indexer({ kind: 'stats' })
  write(job.out, {
    type: 'run',
    system: bot.system,
    profile: profileFor(job.model),
    // The harness parts the bots have; each becomes a setting when it is built.
    harness: { router: false, hybridRetrieval: false, namedNotes: false, tools: false, stickyContext: false },
    notes: stats.kind === 'stats-result' ? stats.notes : null,
    cpu: os.cpus()[0]?.model ?? '',
    ramBytes: os.totalmem(),
  })

  for (const item of job.cases) {
    const started = performance.now()
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
    }
    try {
      const prepared = await prepare(bot, item.messages)
      result.context = prepared.context
      result.prepareMs = performance.now() - started
      const signal = AbortSignal.timeout(CASE_TIMEOUT_MS)
      for await (const text of provider.stream(prepared.history, prepared.system, {
        model: job.model,
        signal,
        onStats: (s) => (result.stats = s),
      })) {
        result.ttftMs ??= performance.now() - started
        result.answer += text
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err)
    }
    result.totalMs = performance.now() - started
    write(job.out, result)
  }
}
