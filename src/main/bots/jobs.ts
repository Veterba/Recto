import { isActive, type BotJob, type JobState } from '../../shared/bots'

/**
 * The answers being worked on, owned here rather than by the chat on screen:
 * leaving the chat, switching tabs or reloading the window only stops
 * watching an answer, never the answer. One model run fits on this Mac, so
 * jobs from every topic wait in one queue and run one by one.
 *
 * The registry is the state machine and the queue; what a run does (prepare,
 * stream, write the topic file) is handed in as `run`, so this is tested
 * without a model or a vault. Every way a job ends - done, error, cancelled,
 * timed out - goes through `end`, which is the only place that frees the
 * queue: a busy flag cannot outlive its job.
 */

export type RunControls = {
  signal: AbortSignal
  /** The job changed (steps, status, text): pushed to whoever watches. */
  update: (patch: Partial<Pick<BotJob, 'state' | 'steps' | 'status' | 'text' | 'sources' | 'question'>>) => void
}

export type Runner = (job: BotJob, controls: RunControls) => Promise<void>

export type JobsOptions = {
  run: Runner
  /** Every change to a job, terminal ones included. */
  onChange: (job: BotJob) => void
  /** Something runs (true) or nothing does (false): for the power-save blocker. */
  onBusy?: (busy: boolean) => void
  /** No new text for this long while streaming: the job ends with an error (Retry). */
  stallMs?: number
  now?: () => Date
}

let counter = 0
const newId = (): string => `job-${Date.now().toString(36)}-${(++counter).toString(36)}`

export class Jobs {
  private readonly jobs = new Map<string, BotJob>()
  private readonly queue: string[] = []
  private running: { id: string; controller: AbortController; reason: 'cancel' | 'discard' | 'stall' | 'quit' | null } | null = null
  private stall: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly o: JobsOptions) {}

  list(): BotJob[] {
    return [...this.jobs.values()].map((j) => ({ ...j }))
  }

  get(id: string): BotJob | undefined {
    const job = this.jobs.get(id)
    return job === undefined ? undefined : { ...job }
  }

  /** The topic has an answer running or waiting. */
  busy(topic: string): boolean {
    return [...this.jobs.values()].some((j) => j.topic === topic && isActive(j))
  }

  /** Queue an answer for a topic; it starts at once when nothing else runs. */
  enqueue(input: { botId: string; topic: string; model: string; question: string | null }): BotJob {
    const job: BotJob = {
      id: newId(),
      botId: input.botId,
      topic: input.topic,
      state: 'queued',
      position: 0,
      question: input.question,
      steps: [],
      status: null,
      text: '',
      sources: [],
      model: input.model,
      at: localStamp(this.o.now?.() ?? new Date()),
      error: null,
    }
    // Ended jobs of the topic are forgotten: their answer is in the file now.
    for (const [id, j] of this.jobs) if (j.topic === job.topic && !isActive(j)) this.jobs.delete(id)
    this.jobs.set(job.id, job)
    this.queue.push(job.id)
    this.positions()
    this.o.onChange({ ...job, position: this.position(job.id) })
    this.next()
    return { ...job, position: this.position(job.id) }
  }

  /**
   * Stop jobs: one by id, or every job of a topic. A queued one is dropped; the
   * running one is aborted. `discard`: the topic is being deleted - nothing
   * more is written to it.
   */
  cancel(target: { id: string } | { topic: string }, discard = false): number {
    const hit = [...this.jobs.values()].filter((j) => isActive(j) && ('id' in target ? j.id === target.id : j.topic === target.topic))
    for (const job of hit) {
      if (this.running?.id === job.id) {
        this.running.reason = discard ? 'discard' : 'cancel'
        this.running.controller.abort()
      } else {
        this.queue.splice(this.queue.indexOf(job.id), 1)
        this.end(job.id, 'cancelled', null)
      }
    }
    this.positions()
    return hit.length
  }

  /** Why the running job's signal was aborted, for the runner deciding what to save. */
  abortReason(id: string): 'cancel' | 'discard' | 'stall' | 'quit' | null {
    return this.running?.id === id ? this.running.reason : null
  }

  private position(id: string): number {
    if (this.running?.id === id) return 0
    const at = this.queue.indexOf(id)
    return at === -1 ? 0 : at + (this.running === null ? 0 : 1)
  }

  /** Waiting jobs' places changed: each says so. */
  private positions(): void {
    for (const id of this.queue) {
      const job = this.jobs.get(id)
      if (job === undefined) continue
      const position = this.position(id)
      if (job.position !== position) {
        job.position = position
        this.o.onChange({ ...job })
      }
    }
  }

  private next(): void {
    if (this.running !== null) return
    const id = this.queue.shift()
    if (id === undefined) {
      this.o.onBusy?.(false)
      return
    }
    const job = this.jobs.get(id)
    if (job === undefined) return this.next()
    const controller = new AbortController()
    this.running = { id, controller, reason: null }
    this.o.onBusy?.(true)
    job.state = 'preparing'
    job.position = 0
    this.o.onChange({ ...job })
    this.positions()
    const update: RunControls['update'] = (patch) => {
      const current = this.jobs.get(id)
      if (current === undefined || !isActive(current)) return
      Object.assign(current, patch)
      if (patch.text !== undefined) this.armStall(id)
      this.o.onChange({ ...current })
    }
    void this.o.run({ ...job }, { signal: controller.signal, update }).then(
      () => this.end(id, controller.signal.aborted ? (this.running?.reason === 'stall' ? 'error' : 'cancelled') : 'done', null),
      (err: unknown) =>
        this.end(
          id,
          controller.signal.aborted && this.running?.reason !== 'stall' ? 'cancelled' : 'error',
          this.running?.reason === 'stall' ? 'No answer for a minute - stopped.' : err instanceof Error ? err.message : String(err),
        ),
    )
  }

  private armStall(id: string): void {
    if (this.stall !== null) clearTimeout(this.stall)
    this.stall = setTimeout(() => {
      if (this.running?.id !== id) return
      this.running.reason = 'stall'
      this.running.controller.abort()
    }, this.o.stallMs ?? 60_000)
  }

  /** The one way a job ends. Frees the queue if it was the running one, and starts the next. */
  private end(id: string, state: Extract<JobState, 'done' | 'error' | 'cancelled'>, error: string | null): void {
    const job = this.jobs.get(id)
    if (job !== undefined && isActive(job)) {
      job.state = state
      job.error = state === 'error' ? (error ?? job.error ?? 'The answer failed.') : null
      job.status = null
      job.position = 0
      this.o.onChange({ ...job })
    }
    if (this.running?.id === id) {
      this.running = null
      if (this.stall !== null) clearTimeout(this.stall)
      this.stall = null
      this.positions()
      this.next()
    }
  }

  /** The app is quitting: everything stops; the runner saves what the running job has. */
  stopAll(): void {
    for (const id of [...this.queue]) this.cancel({ id })
    if (this.running !== null) {
      this.running.reason = 'quit'
      this.running.controller.abort()
    }
  }
}

/** Local time to the second, as topics write it. */
function localStamp(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
