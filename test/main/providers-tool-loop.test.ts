import { describe, expect, it, vi } from 'vitest'

/** providers/run.ts `toolLoop`: the last round of calls says it is the last, and gets a turn to answer; a Stop between calls ends it there. */

const ran: string[] = []
let afterCall = (): void => undefined
vi.mock('../../src/main/vault-tools', () => ({
  callTool: async (name: string) => {
    ran.push(name)
    afterCall()
    return { ok: true, blocks: [{ kind: 'data', data: { ok: name } }] }
  },
}))

const { LAST_CALLS, MAX_TURNS, toolLoop } = await import('../../src/main/providers/run')

const session = { id: 's', client: 't', tools: null, notes: null, writable: null, vault: null, cloud: true, record: { read: new Set<string>(), skimmed: new Set<string>(), proposals: [] } }

/** A model that calls a tool every turn until it has been told the last round came; then answers. */
function model(calls = 1) {
  const seen: string[][] = []
  return {
    seen,
    start: () => ({ told: false }),
    async *turn(state: { told: boolean }) {
      if (state.told) {
        yield { type: 'text' as const, text: 'Here is what I found.' }
        return
      }
      for (let i = 0; i < calls; i++) yield { type: 'call' as const, id: String(i), name: `tool_${i}`, args: '{}' }
    },
    answer(state: { told: boolean }, results: { output: string }[]) {
      seen.push(results.map((r) => r.output))
      if (results.some((r) => r.output.includes(LAST_CALLS))) state.told = true
    },
  }
}

describe('the tool loop', () => {
  it('the last round of calls is told so, and the model answers instead of being cut off', async () => {
    const m = model()
    let text = ''
    for await (const e of toolLoop(m, { model: 'm', system: 'S', messages: [], session, signal: new AbortController().signal })) if (e.type === 'text') text += e.text
    expect(m.seen).toHaveLength(MAX_TURNS)
    expect(m.seen.at(-1)!.at(-1)).toContain(LAST_CALLS)
    expect(text).toBe('Here is what I found.')
  })

  it('a Stop between calls: the calls after it are not made', async () => {
    ran.length = 0
    const stop = new AbortController()
    // Stopped while the first of three calls runs.
    afterCall = () => stop.abort()
    for await (const _ of toolLoop(model(3), { model: 'm', system: 'S', messages: [], session, signal: stop.signal })) void _
    afterCall = () => undefined
    expect(ran).toEqual(['tool_0'])
  })
})
