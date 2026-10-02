import { afterEach, describe, expect, it, vi } from 'vitest'
import { previewOf, shortTime } from '../../../../src/renderer/features/bots/threads'
import { fromFileName, topicPaths } from '../../../../src/renderer/features/bots/chat-topics-model'
import { appendTurns, parseTopic, topicFile } from '../../../../src/shared/chat-topics'
import { describeStatus } from '../../../../src/renderer/features/bots/hooks/use-bots'
import { OllamaProvider } from '../../../../src/main/bots/provider'
import type { BotMessage } from '../../../../src/shared/bots'
import type { FileNode } from '../../../../src/shared/vault'

describe('chat topics', () => {
  const messages: BotMessage[] = [
    { role: 'user', content: 'How do I mix soil?' },
    {
      role: 'assistant',
      content: 'Compost, loam and grit.',
      sources: [
        { path: 'Garden/Soil.md', heading: 'Mix' },
        { path: 'Odd -- name.md', heading: null },
      ],
    },
  ]
  const file = topicFile({ bot: 'recto', created: '2026-09-20T10:00', title: 'Soil' }, [], appendTurns('', messages, 'Recto'))

  it('round-trips, sources included, under the bot’s own name', () => {
    expect(file).toContain('## Recto')
    const parsed = parseTopic(file, ['Recto'])
    expect(parsed.meta).toEqual({ bot: 'recto', created: '2026-09-20T10:00', title: 'Soil' })
    expect(parsed.messages.map(({ role, content, sources }) => ({ role, content, ...(sources ? { sources } : {}) }))).toEqual(messages)
  })

  it('keeps sources out of the answer as a comment that `--` cannot close early, and not as links', () => {
    const comment = /<!-- recto:sources (.*) -->/.exec(file)![1]!
    expect(comment).not.toContain('--')
    expect(file).not.toContain('[[')
  })

  it('previews the last thing said on one line', () => {
    expect(previewOf(messages)).toBe('Compost, loam and grit.')
    expect(previewOf([{ role: 'user', content: '# Big **question**\nsecond line' }])).toBe('You: Big question second line')
    expect(previewOf([])).toBe('')
  })

  it('finds a bot’s topics, newest first, and reads a title from a file name', () => {
    const tree: FileNode[] = [
      {
        path: 'chats',
        name: 'chats',
        kind: 'folder',
        children: [
          {
            path: 'chats/recto',
            name: 'recto',
            kind: 'folder',
            children: [
              { path: 'chats/recto/2026-09-01 10-00 — Old.md', name: '2026-09-01 10-00 — Old.md', kind: 'file' },
              { path: 'chats/recto/2026-09-20 10-00 — Soil mix.md', name: '2026-09-20 10-00 — Soil mix.md', kind: 'file' },
              { path: 'chats/recto/notes.txt', name: 'notes.txt', kind: 'file' },
            ],
          },
        ],
      },
    ]
    expect(topicPaths(tree, 'recto')).toEqual(['chats/recto/2026-09-20 10-00 — Soil mix.md', 'chats/recto/2026-09-01 10-00 — Old.md'])
    expect(topicPaths(tree, 'calm')).toEqual([])
    const sameMinute: FileNode[] = [
      {
        path: 'chats',
        name: 'chats',
        kind: 'folder',
        children: [
          {
            path: 'chats/recto',
            name: 'recto',
            kind: 'folder',
            children: ['2026-09-20 10-00 — Soil mix.md', '2026-09-20 10-00 — Soil mix (2).md', '2026-09-20 09-59 — Zebra.md'].map(
              (name) => ({
                path: `chats/recto/${name}`,
                name,
                kind: 'file' as const,
              }),
            ),
          },
        ],
      },
    ]
    expect(topicPaths(sameMinute, 'recto').map((p) => p.slice(12))).toEqual([
      '2026-09-20 10-00 — Soil mix (2).md',
      '2026-09-20 10-00 — Soil mix.md',
      '2026-09-20 09-59 — Zebra.md',
    ])
    expect(fromFileName('2026-09-20 10-00 — Soil mix.md')).toEqual({ created: '2026-09-20T10:00', title: 'Soil mix' })
    expect(fromFileName('2026-09-20 10-00 — Soil mix (2).md')).toEqual({ created: '2026-09-20T10:00', title: 'Soil mix' })
  })

  it('says when, briefly', () => {
    const now = new Date('2026-09-20T15:00:00').getTime()
    expect(shortTime(new Date('2026-09-20T10:00:00').getTime(), now)).toBe('10:00')
    expect(shortTime(new Date('2026-09-17T10:00:00').getTime(), now)).toBe('Thu')
    expect(shortTime(new Date('2026-08-02T10:00:00').getTime(), now)).toBe('2 Aug')
  })
})

describe('model status', () => {
  it('says what is wrong and what to run', () => {
    expect(describeStatus({ state: 'ready', model: 'qwen3.5:9b' })).toEqual({
      label: 'Ollama running · model ready',
      fix: null,
      command: null,
    })
    expect(describeStatus({ state: 'not-running', model: 'qwen3.5:9b' })).toMatchObject({
      label: 'Ollama not running',
      command: 'ollama serve',
    })
    const missing = describeStatus({ state: 'no-model', model: 'qwen3.5:9b', installed: [] })
    expect(missing).toMatchObject({ label: 'Model not downloaded', command: 'ollama pull qwen3.5:9b' })
    expect(missing.fix).toContain('about 6 GB')
    expect(describeStatus({ state: 'no-model', model: 'other:1b', installed: [] }).fix).not.toContain('6 GB')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports Ollama not running when nothing answers on localhost', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    expect(await new OllamaProvider().status('qwen3.5:9b')).toEqual({ state: 'not-running', model: 'qwen3.5:9b' })
  })

  it('reports the model missing, and talks only to localhost', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ models: [{ name: 'llama3:latest' }] })))
    vi.stubGlobal('fetch', fetch)
    expect(await new OllamaProvider().status('qwen3.5:9b')).toEqual({
      state: 'no-model',
      model: 'qwen3.5:9b',
      installed: ['llama3:latest'],
    })
    expect(String(fetch.mock.calls[0]![0])).toMatch(/^http:\/\/127\.0\.0\.1:11434\//)
  })
})
