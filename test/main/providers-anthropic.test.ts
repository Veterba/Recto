import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The Claude API through Recto's tool loop, against a stand-in server on
 * 127.0.0.1 speaking Anthropic's streaming format: an answer cut at the
 * length limit says so, and an API refusal reads as a sentence, not JSON.
 */

vi.mock('electron', () => ({ app: { isPackaged: false, on: () => undefined, getPath: () => '/tmp' } }))

type Reply = { status: number; body: string; sse: boolean }
let reply: Reply = { status: 200, body: '', sse: true }
/** Replies for the requests to come, in order (then `reply`), and the requests' bodies as they came. */
let queued: Reply[] = []
const bodies: Record<string, unknown>[] = []
let server: http.Server

const sse = (events: [string, unknown][]): string => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')
const message = (stop: string, text: string): string =>
  sse([
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'm1',
          type: 'message',
          role: 'assistant',
          model: 'claude-test',
          content: [],
          stop_reason: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
    ],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }],
  ])

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString()))
    req.on('end', () => {
      try {
        bodies.push(JSON.parse(body) as Record<string, unknown>)
      } catch {
        bodies.push({})
      }
      const now = queued.shift() ?? reply
      res.writeHead(now.status, { 'content-type': now.sse ? 'text/event-stream' : 'application/json' })
      res.end(now.body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.env['RECTO_ANTHROPIC_BASE'] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  delete process.env['RECTO_ANTHROPIC_BASE']
  server.close()
})

const { messagesModel } = await import('../../src/main/providers/anthropic')

async function answer(): Promise<string> {
  const model = messagesModel('claude-sonnet-5-5', 'sk-test', [])
  const state = model.start('Be brief.', [{ role: 'user', content: 'Hi' }])
  let text = ''
  for await (const event of model.turn(state, new AbortController().signal)) if (event.type === 'text') text += event.text
  return text
}

describe('the Claude API', () => {
  it('an answer that ends normally is just its text', async () => {
    reply = { status: 200, body: message('end_turn', 'All done.'), sse: true }
    expect(await answer()).toBe('All done.')
  })

  it('an answer stopped at the length limit says it was cut short', async () => {
    reply = { status: 200, body: message('max_tokens', 'The first half'), sse: true }
    expect(await answer()).toBe('The first half\n\n(The answer was cut short: it reached the length limit.)')
  })

  it('a refusal is the API’s own sentence, not raw JSON', async () => {
    reply = {
      status: 404,
      body: JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'model: claude-old' } }),
      sse: false,
    }
    const error = await answer().catch((err: unknown) => err as { problem?: { message: string } })
    expect((error as { problem: { message: string } }).problem.message).toBe(
      'The Anthropic API does not know this model: model: claude-old',
    )
  })
})

describe('a person’s pictures, for the Claude API', () => {
  it('go after their words in the same turn, as images; a turn without any stays text', () => {
    const state = messagesModel('claude-sonnet-5-5', 'sk-test', []).start('S', [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'This? [picture 1: a.png]', images: [{ mime: 'image/png', data: 'QUJD' }] },
    ])
    expect(state.messages[0]).toEqual({ role: 'user', content: 'Hi' })
    expect(state.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'This? [picture 1: a.png]' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
      ],
    })
  })
})

/** A streamed message: `text` citing `cites` (web search results), stopping for `stop`. */
const citing = (stop: string, text: string, cites: { url: string; title: string }[]): string =>
  sse([
    ['message_start', { type: 'message_start', message: { id: 'm2', type: 'message', role: 'assistant', model: 'claude-test', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: [] } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ...cites.map((c): [string, unknown] => [
      'content_block_delta',
      { type: 'content_block_delta', index: 0, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: c.url, title: c.title, cited_text: 'x', encrypted_index: 'e' } } },
    ]),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }],
  ])

describe('the Claude API on the web', () => {
  const ask = async (web: boolean): Promise<string> => {
    const model = messagesModel('claude-sonnet-5-5', 'sk-test', [], web)
    const state = model.start('S', [{ role: 'user', content: 'News?' }])
    let text = ''
    for await (const event of model.turn(state, new AbortController().signal)) if (event.type === 'text') text += event.text
    return text
  }

  it('gets Anthropic’s web search and web fetch only when the vault lets it', async () => {
    reply = { status: 200, body: message('end_turn', 'Fine.'), sse: true }
    bodies.length = 0
    await ask(false)
    expect(JSON.stringify(bodies.at(-1)!['tools'])).not.toContain('web_')
    await ask(true)
    expect(bodies.at(-1)!['tools']).toEqual(
      expect.arrayContaining([
        { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
        { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 5 },
      ]),
    )
  })

  it('a turn paused mid-search goes on, as it is; the pages cited and not linked are listed under the answer', async () => {
    bodies.length = 0
    queued = [
      { status: 200, body: citing('pause_turn', 'Looking. ', []), sse: true },
      { status: 200, body: citing('end_turn', 'It rained in Kyoto, see https://a.example/rain.', [{ url: 'https://a.example/rain', title: 'Rain' }, { url: 'https://b.example/news', title: 'Kyoto [news]' }]), sse: true },
    ]
    const text = await ask(true)
    expect(bodies).toHaveLength(2)
    // The paused turn's content goes back as the assistant's, for it to carry on from.
    expect((bodies[1]!['messages'] as { role: string }[]).at(-1)!.role).toBe('assistant')
    expect(text).toBe('Looking. It rained in Kyoto, see https://a.example/rain.\n\nSources:\n- [Kyoto news](https://b.example/news)')
  })
})
