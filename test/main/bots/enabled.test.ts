import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bots are experimental: off in a new vault, on in one that already has them,
 * and whatever was decided is written down so it never flips by itself.
 */

let root = ''
vi.mock('../../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))
const { botsEnabled, writeBotsEnabled } = await import('../../../src/main/bots/enabled')

const stored = (): unknown => JSON.parse(fs.readFileSync(path.join(root, '.recto', 'bots-settings.json'), 'utf8'))

describe('bots on or off', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-bots-on-'))
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('a new vault starts with bots off, and stays off when their folders appear later', () => {
    expect(botsEnabled()).toBe(false)
    expect(stored()).toEqual({ enabled: false })
    fs.mkdirSync(path.join(root, '.recto', 'bots'), { recursive: true })
    expect(botsEnabled()).toBe(false)
  })

  it('a vault that already has bots keeps them on', () => {
    fs.mkdirSync(path.join(root, '.recto', 'bots', 'recto'), { recursive: true })
    expect(botsEnabled()).toBe(true)
    expect(stored()).toEqual({ enabled: true })
  })

  it('so does one with chats from before', () => {
    fs.mkdirSync(path.join(root, 'chats'))
    expect(botsEnabled()).toBe(true)
  })

  it('the switch is remembered either way', () => {
    writeBotsEnabled(true)
    expect(botsEnabled()).toBe(true)
    writeBotsEnabled(false)
    fs.mkdirSync(path.join(root, 'chats'))
    expect(botsEnabled()).toBe(false)
  })
})
