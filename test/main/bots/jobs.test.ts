import { describe, expect, it } from 'vitest'
import { Jobs, type RunControls } from '../../../src/main/bots/jobs'
import type { BotJob } from '../../../src/shared/bots'

/** A runner the test drives by hand: each run waits until told how to end. */
function harness(stallMs?: number) {
  const runs = new Map<string, { controls: RunControls; finish: () => void; fail: (e: Error) => void }>()
  const changes: BotJob[] = []
  const busy: boolean[] = []
  const jobs = new Jobs({
    run: (job, controls) =>
      new Promise<void>((resolve, reject) => {
        runs.set(job.id, { controls, finish: resolve, fail: reject })
        controls.signal.addEventListener('abort', () => reject(new Error('aborted')))
      }),
    onChange: (job) => changes.push(job),
    onBusy: (b) => busy.push(b),
    ...(stallMs === undefined ? {} : { stallMs }),
  })
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  const state = (id: string): string | undefined => jobs.get(id)?.state
  return { jobs, runs, changes, busy, tick, state }
}

const input = (topic: string) => ({ botId: 'recto', topic, model: 'qwen3.5:9b', question: null })

describe('the job registry', () => {
  it('runs one job at a time, in the order they came, across topics', async () => {
    const h = harness()
    const a = h.jobs.enqueue(input('a.md'))
    const b = h.jobs.enqueue(input('b.md'))
    const c = h.jobs.enqueue(input('a.md'))
    expect(h.state(a.id)).toBe('preparing')
    expect([h.jobs.get(b.id)!.position, h.jobs.get(c.id)!.position]).toEqual([1, 2])
    h.runs.get(a.id)!.finish()
    await h.tick()
    expect(h.state(a.id)).toBe('done')
    expect(h.state(b.id)).toBe('preparing')
    expect(h.jobs.get(c.id)!.position).toBe(1)
    h.runs.get(b.id)!.finish()
    await h.tick()
    h.runs.get(c.id)!.finish()
    await h.tick()
    expect(h.busy.at(-1)).toBe(false)
  })

  it('every way a job ends frees the queue: error, cancel, discard, a queued cancel', async () => {
    const h = harness()
    const a = h.jobs.enqueue(input('a.md'))
    const b = h.jobs.enqueue(input('b.md'))
    const c = h.jobs.enqueue(input('c.md'))
    const d = h.jobs.enqueue(input('d.md'))
    // A queued job is dropped without ever running.
    expect(h.jobs.cancel({ id: c.id })).toBe(1)
    expect(h.state(c.id)).toBe('cancelled')
    h.runs.get(a.id)!.fail(new Error('Ollama answered 500'))
    await h.tick()
    expect(h.jobs.get(a.id)).toMatchObject({ state: 'error', error: 'Ollama answered 500' })
    expect(h.state(b.id)).toBe('preparing')
    // Clear all / delete topic: the running job is aborted and nothing more is written.
    h.jobs.cancel({ topic: 'b.md' }, true)
    expect(h.jobs.abortReason(b.id)).toBe('discard')
    await h.tick()
    expect(h.state(b.id)).toBe('cancelled')
    expect(h.state(d.id)).toBe('preparing')
    h.jobs.cancel({ id: d.id })
    await h.tick()
    expect(h.state(d.id)).toBe('cancelled')
    expect(h.jobs.busy('d.md')).toBe(false)
    expect(h.busy.at(-1)).toBe(false)
    // And the next message runs at once.
    const e = h.jobs.enqueue(input('b.md'))
    expect(h.state(e.id)).toBe('preparing')
  })

  it('a stream that stalls ends in an error, and frees the queue', async () => {
    const h = harness(20)
    const a = h.jobs.enqueue(input('a.md'))
    const b = h.jobs.enqueue(input('b.md'))
    h.runs.get(a.id)!.controls.update({ state: 'streaming', text: 'Hel' })
    await new Promise((r) => setTimeout(r, 40))
    expect(h.jobs.get(a.id)).toMatchObject({ state: 'error', error: 'No answer for a minute - stopped.', text: 'Hel' })
    expect(h.state(b.id)).toBe('preparing')
  })

  it('reports updates to watchers, never after the end', async () => {
    const h = harness()
    const a = h.jobs.enqueue(input('a.md'))
    const controls = h.runs.get(a.id)!.controls
    controls.update({ steps: [{ action: 'Searching notes', result: '', state: 'running' }] })
    controls.update({ state: 'streaming', text: 'Your notes' })
    h.runs.get(a.id)!.finish()
    await h.tick()
    controls.update({ text: 'late' })
    expect(h.jobs.get(a.id)).toMatchObject({ state: 'done', text: 'Your notes' })
    expect(h.changes.map((c) => c.state)).toEqual(['queued', 'preparing', 'preparing', 'streaming', 'done'])
  })

  it('a new job forgets the ended jobs of its topic', async () => {
    const h = harness()
    const a = h.jobs.enqueue(input('a.md'))
    h.runs.get(a.id)!.finish()
    await h.tick()
    h.jobs.enqueue(input('a.md'))
    expect(h.jobs.list().filter((j) => j.topic === 'a.md')).toHaveLength(1)
  })
})
