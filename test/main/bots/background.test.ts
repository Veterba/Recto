import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** The Mac as the test sets it: on battery or not, seconds since the last key. */
const mac = { battery: false, idle: 999 }
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  powerMonitor: { isOnBatteryPower: () => mac.battery, getSystemIdleTime: () => mac.idle },
}))
const syncVectors = vi.fn(async (_exclude: readonly string[], _signal?: AbortSignal) => ({ notes: 0, embedded: 0, removed: 0, ms: 0 }))
const buildCards = vi.fn(async () => ({ done: 3, total: 3, state: 'done' as const }))
vi.mock('../../../src/main/bots/vectors', () => ({ syncVectors: (e: readonly string[], s?: AbortSignal) => syncVectors(e, s) }))
vi.mock('../../../src/main/bots/cards', () => ({ buildCards: () => buildCards() }))

import { backgroundGate, shouldPause } from '../../../src/main/bots/background-gate'
import { cardsStatus, startBackground, stopBackground } from '../../../src/main/bots/background'
import { keepAliveFor } from '../../../src/main/bots/provider'
import type { BotModelProvider } from '../../../src/main/bots/provider'

const deps = {
  provider: () => ({}) as BotModelProvider,
  model: () => 'gemma4:e4b',
  exclude: () => [],
  enabled: () => ({ vectors: true, cards: true }),
  busy: () => false,
  ready: async () => true,
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

describe('background work: only on the charger, with nobody at the keyboard', () => {
  beforeEach(() => {
    mac.battery = false
    mac.idle = 999
    syncVectors.mockClear()
    buildCards.mockClear()
  })
  afterEach(() => stopBackground())

  it('the gate', () => {
    expect(backgroundGate()).toBe('ok')
    mac.idle = 30
    expect(backgroundGate()).toBe('idle')
    mac.battery = true
    expect(backgroundGate()).toBe('charger')
    mac.battery = false
    mac.idle = 1
    expect(shouldPause()).toBe(true)
  })

  it('on battery: no vectors, no cards, and Settings says it waits for the charger', async () => {
    mac.battery = true
    startBackground(deps)
    await settle()
    expect(syncVectors).not.toHaveBeenCalled()
    expect(buildCards).not.toHaveBeenCalled()
    expect(cardsStatus().state).toBe('waiting-charger')
  })

  it('someone typing: nothing starts, it waits until they are away', async () => {
    mac.idle = 10
    startBackground(deps)
    await settle()
    expect(syncVectors).not.toHaveBeenCalled()
    expect(cardsStatus().state).toBe('waiting')
  })

  it('on the charger and idle: vectors, then cards', async () => {
    startBackground(deps)
    await settle()
    expect(syncVectors).toHaveBeenCalledTimes(1)
    // The background passes a signal, so a key pressed can stop it halfway.
    expect(syncVectors.mock.calls[0]![1]).toBeInstanceOf(AbortSignal)
    expect(buildCards).toHaveBeenCalledTimes(1)
    expect(cardsStatus().state).toBe('done')
  })
})

describe('unloading the model', () => {
  it('Ollama is told minutes, or -1 to keep it', () => {
    expect(keepAliveFor(5)).toBe('5m')
    expect(keepAliveFor(1)).toBe('1m')
    expect(keepAliveFor(-1)).toBe(-1)
  })
})
