import { afterEach, describe, expect, it, vi } from 'vitest'

/** A provider's address from the environment reaches a test build only: a packaged app never sends a key elsewhere. */

const electron = { app: { isPackaged: false } }
vi.mock('electron', () => electron)
const { providerBase } = await import('../../src/main/config')

afterEach(() => {
  delete process.env['RECTO_ANTHROPIC_BASE']
  electron.app.isPackaged = false
})

describe('provider addresses', () => {
  it('taken from the environment in development and tests', () => {
    process.env['RECTO_ANTHROPIC_BASE'] = 'http://127.0.0.1:9999'
    expect(providerBase('RECTO_ANTHROPIC_BASE')).toBe('http://127.0.0.1:9999')
  })

  it('ignored by a packaged app', () => {
    process.env['RECTO_ANTHROPIC_BASE'] = 'http://127.0.0.1:9999'
    electron.app.isPackaged = true
    expect(providerBase('RECTO_ANTHROPIC_BASE')).toBeUndefined()
  })
})
