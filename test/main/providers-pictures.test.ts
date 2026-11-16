import os from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { BotModelProvider } from '../../src/main/bots/provider'

/**
 * providers/index.ts `picturesFor`: every cloud provider is sent a person's
 * pictures; a local model only when Ollama says it can look at them. A
 * question with a picture to one that cannot is refused plainly, and earlier
 * pictures go to it as their names. (Reading the pictures from the vault is
 * test/main/chat-pictures.test.ts.)
 */

vi.mock('electron', () => ({ app: { on: () => undefined, getPath: () => os.tmpdir(), isPackaged: false }, shell: {}, safeStorage: {} }))
vi.mock('../../src/main/state', () => ({ readState: () => null, writeState: () => ({ ok: true }) }))
vi.mock('../../src/main/chat-pictures', async (actual) => ({
  ...(await actual<typeof import('../../src/main/chat-pictures')>()),
  // Every embed read as a picture.
  withPictures: async (messages: { role: string; content: string }[]) =>
    messages.map((m) => (m.role === 'user' && m.content.includes('![[') ? { ...m, images: [{ mime: 'image/png', data: 'QUJD' }] } : m)),
}))

const { picturesFor } = await import('../../src/main/providers')
const { ProviderError } = await import('../../src/main/providers/run')

const local = (sees: boolean): BotModelProvider => ({ canSee: async () => sees }) as unknown as BotModelProvider
const question = [{ role: 'user' as const, content: 'What is this? ![[a.png]]' }]
const earlier = [{ role: 'user' as const, content: 'This ![[a.png]]' }, { role: 'assistant' as const, content: 'A cat.' }, { role: 'user' as const, content: 'And?' }]

describe('pictures, by what the model can see', () => {
  it('a cloud model gets them', async () => {
    for (const model of ['anthropic:claude-sonnet-5-5', 'codex:', 'claude-code:', 'openai:gpt-5', 'chatgpt:gpt-5'])
      expect((await picturesFor(model, question, local(false)))[0]!.images).toHaveLength(1)
  })

  it('a local model that can look at pictures gets them', async () => {
    expect((await picturesFor('gemma3:4b', question, local(true)))[0]!.images).toHaveLength(1)
  })

  it('a question with a picture to a local model that cannot is refused, saying what to do', async () => {
    const refused = await picturesFor('qwen3.5:9b', question, local(false)).catch((err: unknown) => err)
    expect(refused).toBeInstanceOf(ProviderError)
    expect((refused as InstanceType<typeof ProviderError>).problem.message).toMatch(/qwen3\.5:9b cannot look at pictures\. Pick a model that can/)
  })

  it('a later question without one goes to it, the earlier pictures left out', async () => {
    const out = await picturesFor('qwen3.5:9b', earlier, local(false))
    expect(out.some((m) => m.images !== undefined)).toBe(false)
    expect(out.at(-1)!.content).toBe('And?')
  })
})
