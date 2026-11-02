import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

/**
 * Plan limits and Recto's own usage: Codex's limits read from its app
 * server (a fake one, answering in the shape a real one gave), Claude Code's
 * from the event in its stream, tokens counted per provider per day, and the
 * lines the picker and Settings show.
 */

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-limits-'))
vi.mock('electron', () => ({ app: { getPath: () => userData, getVersion: () => '0.0.0-test' } }))
vi.mock('../../src/main/vault-tools', () => ({ callTool: async () => ({ ok: true, blocks: [] }) }))

const { claudeLimits, codexLimits, limitsOf, readCodexLimits, recordUsage, usageOf, windowLabel } = await import('../../src/main/providers/limits')
const { parseLine } = await import('../../src/main/providers/cli')
const { limitsLine, usageLine } = await import('../../src/shared/providers')

afterAll(() => fs.rmSync(userData, { recursive: true, force: true }))

describe('Codex', () => {
  const real = {
    rateLimits: {
      limitId: 'codex',
      primary: { usedPercent: 6, windowDurationMins: 43200, resetsAt: 1794917533 },
      secondary: null,
      planType: 'free',
      rateLimitReachedType: null,
      spendControlReached: false,
    },
  }

  it('reads the plan and its windows from account/rateLimits/read', () => {
    expect(codexLimits(real, 1)).toEqual({
      plan: 'free',
      windows: [{ label: '30 days', usedPercent: 6, resetsAt: 1794917533000 }],
      at: 1,
      blocked: false,
    })
    const pro = { rateLimits: { ...real.rateLimits, primary: { usedPercent: 81, windowDurationMins: 300, resetsAt: 1 }, secondary: { usedPercent: 40, windowDurationMins: 10080 } } }
    expect(codexLimits(pro)?.windows.map((w) => w.label)).toEqual(['5 hours', 'week'])
    expect(codexLimits({ rateLimits: { ...real.rateLimits, rateLimitReachedType: 'primary' } })?.blocked).toBe(true)
    expect(codexLimits({})).toBeNull()
  })

  it('asks a (fake) app server, with nothing sent to a model, and keeps the answer', async () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-limits-bin-'))
    const file = path.join(bin, 'codex')
    fs.copyFileSync(path.resolve('test/fixtures/fake-cli/fake-agent.mjs'), file)
    fs.chmodSync(file, 0o755)
    const limits = await readCodexLimits(file, process.env)
    expect(limits).toMatchObject({ plan: 'free', windows: [{ usedPercent: 6, label: '30 days' }] })
    expect(limitsOf('codex')).toMatchObject({ plan: 'free' })
    fs.rmSync(bin, { recursive: true, force: true })
  })
})

describe('Claude Code', () => {
  it('reads the unified windows of a rate_limit_event, utilization as a fraction', () => {
    const info = { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.38, resetsAt: 100 }, seven_day: { utilization: 0.12, resetsAt: 200 } } }
    expect(claudeLimits(info, 5)).toEqual({
      plan: null,
      at: 5,
      blocked: false,
      windows: [
        { label: '5 hours', usedPercent: 38, resetsAt: 100_000 },
        { label: 'week', usedPercent: 12, resetsAt: 200_000 },
      ],
    })
    expect(claudeLimits({ status: 'rejected', rateLimitType: 'five_hour', utilization: 1, resetsAt: 9 })).toMatchObject({
      blocked: true,
      windows: [{ label: '5 hours', usedPercent: 100 }],
    })
  })

  it('finds the event and the tokens in its stream; Codex’s tokens in turn.completed', () => {
    expect(parseLine('claude', JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }))).toEqual({ limits: { status: 'allowed' } })
    expect(parseLine('claude', JSON.stringify({ type: 'result', is_error: false, usage: { input_tokens: 1200, output_tokens: 80 } }))).toEqual({ tokens: 1280 })
    expect(parseLine('codex', JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 900, output_tokens: 40 } }))).toEqual({ tokens: 940 })
  })
})

describe('what Recto used', () => {
  it('counts tokens per provider per day, today and the last seven days', () => {
    const day = 86_400_000
    const now = new Date('2026-11-02T12:00:00').getTime()
    recordUsage('chatgpt', 1000, now - 8 * day)
    recordUsage('chatgpt', 2000, now - 3 * day)
    recordUsage('chatgpt', 500, now)
    recordUsage('chatgpt', 0, now)
    expect(usageOf('chatgpt', now)).toEqual({ today: 500, week: 2500 })
    expect(usageOf('openai', now)).toEqual({ today: 0, week: 0 })
  })

  it('says it in one line', () => {
    expect(usageLine({ today: 500, week: 12_400 })).toBe('Recto used 500 tokens today · 12k this week')
    expect(usageLine({ today: 0, week: 0 })).toBe('Not used by Recto yet')
    expect(windowLabel(300)).toBe('5 hours')
    const line = limitsLine({ plan: null, at: 0, blocked: false, windows: [{ label: 'week', usedPercent: 12, resetsAt: null }, { label: '5 hours', usedPercent: 38.4, resetsAt: null }] })
    expect(line).toBe('38% of 5 hours used; 12% of week used')
  })
})
