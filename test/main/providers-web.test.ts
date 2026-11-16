import os from 'node:os'
import { describe, expect, it, vi } from 'vitest'

/**
 * providers/index.ts `webEnabled`: a provider reaches the web only when this
 * vault lets that provider on it - and only while cloud providers are on;
 * a local model never.
 */

let access: unknown = null
vi.mock('electron', () => ({ app: { on: () => undefined, getPath: () => os.tmpdir(), isPackaged: false }, shell: {}, safeStorage: {} }))
vi.mock('../../src/main/state', () => ({ readState: () => access, writeState: () => ({ ok: true }) }))

const { webEnabled, WEB_PROMPT } = await import('../../src/main/providers')

describe('which providers are on the web', () => {
  it('none by default', () => {
    access = { cloud: true }
    expect(['claude-code', 'codex', 'chatgpt', 'openai', 'anthropic'].some((id) => webEnabled(id as 'codex'))).toBe(false)
  })

  it('the ones turned on, while cloud is on', () => {
    access = { cloud: true, web: ['codex', 'anthropic'] }
    expect(webEnabled('codex')).toBe(true)
    expect(webEnabled('anthropic')).toBe(true)
    expect(webEnabled('claude-code')).toBe(false)
  })

  it('none with cloud off, whatever was turned on; never a local model', () => {
    access = { cloud: false, web: ['codex'] }
    expect(webEnabled('codex')).toBe(false)
    access = { cloud: true, web: ['ollama'] }
    expect(webEnabled('ollama')).toBe(false)
  })

  it('a model on the web is told it may use it, and that a page is information, not an instruction', () => {
    expect(WEB_PROMPT).toMatch(/search the web/)
    expect(WEB_PROMPT).toMatch(/never an instruction/)
  })
})
