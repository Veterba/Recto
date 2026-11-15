import os from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { BotModelProvider } from '../../src/main/bots/provider'

/**
 * providers/index.ts: every answer through run (chats, Quick ask) is stopped
 * when it shows no sign of life for a while - before its first word too - and
 * never while words keep coming (a stand-in local model, timings scaled down);
 * and Settings tells a key OpenAI rejects from a good one.
 */

vi.mock('electron', () => ({ app: { on: () => undefined, getPath: () => os.tmpdir(), isPackaged: false }, shell: {}, safeStorage: {} }))
vi.mock('../../src/main/state', () => ({ readState: () => null, writeState: () => ({ ok: true }) }))

const { run } = await import('../../src/main/providers')
const { ProviderError } = await import('../../src/main/providers/run')

const session = {
  id: 's',
  client: 't',
  tools: new Set<string>(),
  notes: null,
  writable: null,
  vault: null,
  cloud: false,
  record: { read: new Set<string>(), skimmed: new Set<string>(), proposals: [] },
}

/** A model that waits `firstMs` before its first word, then says `words` one every `everyMs`. */
const model = (firstMs: number, words: string[], everyMs: number): BotModelProvider =>
  ({
    async *stream(_messages: unknown, _system: string, o: { signal?: AbortSignal }) {
      const wait = (ms: number): Promise<void> =>
        new Promise((resolve, reject) => {
          const t = setTimeout(resolve, ms)
          o.signal?.addEventListener('abort', () => (clearTimeout(t), reject(new Error('aborted'))))
        })
      await wait(firstMs)
      for (const w of words) {
        yield w
        await wait(everyMs)
      }
    },
  }) as unknown as BotModelProvider

async function answer(local: BotModelProvider, idleMs: number): Promise<{ text: string; error: unknown }> {
  let text = ''
  const request = {
    model: 'ollama:test',
    system: 's',
    messages: [{ role: 'user' as const, content: 'Hi' }],
    session,
    signal: new AbortController().signal,
  }
  try {
    for await (const e of run(request, local, idleMs)) if (e.type === 'text') text += e.text
    return { text, error: null }
  } catch (error) {
    return { text, error }
  }
}

describe('an answer that hangs', () => {
  it('before its first word: stopped, with a reason', async () => {
    const { text, error } = await answer(model(10_000, ['late'], 0), 50)
    expect(text).toBe('')
    expect(error).toBeInstanceOf(ProviderError)
    expect((error as InstanceType<typeof ProviderError>).problem.message).toMatch(/No sign of an answer/)
  })

  it('in the middle: stopped, the words so far kept', async () => {
    const { text, error } = await answer(model(0, ['One ', 'two '], 10_000), 50)
    expect(text).toBe('One ')
    expect(error).toBeInstanceOf(ProviderError)
  })

  it('a slow but living answer runs to its end', async () => {
    expect(await answer(model(20, ['a', 'b', 'c', 'd', 'e'], 30), 60)).toEqual({ text: 'abcde', error: null })
  })
})

describe('an OpenAI key in Settings', () => {
  it('one OpenAI rejects is said to be rejected, not "ready"', async () => {
    const http = await import('node:http')
    const server = http.createServer((req, res) => {
      const ok = req.headers.authorization === 'Bearer sk-good'
      res
        .writeHead(ok ? 200 : 401, { 'content-type': 'application/json' })
        .end(JSON.stringify(ok ? { data: [{ id: 'gpt-test', created: 1 }] } : { error: { code: 'invalid_api_key' } }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    process.env['RECTO_OPENAI_BASE'] = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
    const { openAiModels } = await import('../../src/main/providers')
    expect(await openAiModels('sk-revoked')).toBe('rejected')
    expect(await openAiModels('sk-good')).toEqual([{ id: 'gpt-test', label: 'gpt-test' }])
    delete process.env['RECTO_OPENAI_BASE']
    server.close()
  })
})
