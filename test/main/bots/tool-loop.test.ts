import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false, getAppPath: () => '/tmp', on: () => undefined },
  shell: {},
  powerMonitor: { isOnBatteryPower: () => false, getSystemIdleTime: () => 999 },
}))
vi.mock('../../../src/main/index-client', () => ({ send: vi.fn() }))
vi.mock('../../../src/main/vault', () => ({ currentVault: () => null }))

import { answerWithTools, MAX_CALLS, type ToolContext, type ToolLoopResult } from '../../../src/main/bots/model-tools'
import type { BotModelProvider, ChatEvent } from '../../../src/main/bots/provider'

/** A model that asks for a tool every time, offered or not, must not keep the answer going forever. */
describe('the tool loop', () => {
  it('ends once the calls are spent, even if the model keeps asking', async () => {
    let requests = 0
    const provider = {
      stream: async function* () {},
      streamChat: async function* (): AsyncIterable<ChatEvent> {
        requests++
        if (requests > 20) throw new Error('still looping')
        yield { type: 'tools', calls: [{ name: 'no_such_tool', args: {} }] }
      },
    } as unknown as BotModelProvider
    const result: ToolLoopResult = { calls: [], parseFailures: 0 }
    const out: string[] = []
    for await (const piece of answerWithTools(provider, [], '', {
      model: 'm',
      signal: new AbortController().signal,
      advisor: false,
      context: {} as ToolContext,
      result,
    }))
      out.push(piece)
    expect(result.calls).toHaveLength(MAX_CALLS)
    expect(requests).toBe(MAX_CALLS + 1)
  })
})
