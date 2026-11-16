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
    req.resume()
    req.on('end', () => {
      res.writeHead(reply.status, { 'content-type': reply.sse ? 'text/event-stream' : 'application/json' })
      res.end(reply.body)
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
