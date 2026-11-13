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

const { claudeLimits, codexLimits, forgetCodexLimits, limitsOf, readCodexLimits, recordLimits, recordUsage, usageOf, windowLabel } = await import('../../src/main/providers/limits')
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

describe('one file for the installed app and a dev build', () => {
  const file = (): string => path.join(userData, 'provider-usage.json')

  it('what the other build wrote meanwhile is kept, not overwritten from memory', () => {
    recordUsage('codex', 100)
    // The other build records Claude's usage and limits in the same file.
    const other = JSON.parse(fs.readFileSync(file(), 'utf8')) as { usage: Record<string, Record<string, number>>; limits: Record<string, unknown> }
    const today = new Date().toLocaleDateString('en-CA')
    other.usage['claude-code'] = { [today]: 70 }
    other.limits['claude-code'] = { plan: 'max', windows: [], at: Date.now(), blocked: false }
    fs.writeFileSync(file(), JSON.stringify(other))
    recordUsage('codex', 50)
    expect(usageOf('claude-code').today).toBe(70)
    expect(limitsOf('claude-code')).toMatchObject({ plan: 'max' })
    expect(usageOf('codex').today).toBeGreaterThanOrEqual(150)
    expect(fs.readdirSync(userData).filter((f) => f.startsWith('provider-usage') && f !== 'provider-usage.json')).toEqual([])
  })

  it('a Codex read that fails keeps showing the last reading, also from the cache', async () => {
    recordLimits('codex', { plan: 'plus', windows: [], at: Date.now(), blocked: false })
    forgetCodexLimits()
    const missing = path.join(userData, 'no-codex-here')
    expect(await readCodexLimits(missing, process.env)).toMatchObject({ plan: 'plus' })
    expect(await readCodexLimits(missing, process.env)).toMatchObject({ plan: 'plus' })
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
  it('counts tokens per provider per day, today and this week since Monday - as the overview counts a week', () => {
    const day = 86_400_000
    // Thursday 5 November: the week began on Monday the 2nd.
    const now = new Date('2026-11-05T12:00:00').getTime()
    recordUsage('chatgpt', 1000, now - 4 * day) // Sunday the 1st: last week
    recordUsage('chatgpt', 2000, now - 3 * day) // Monday the 2nd
    recordUsage('chatgpt', 500, now)
    recordUsage('chatgpt', 0, now)
    expect(usageOf('chatgpt', now)).toEqual({ today: 500, week: 2500 })
    expect(usageOf('openai', now)).toEqual({ today: 0, week: 0 })
  })

  it('says it in one line', () => {
    expect(usageLine({ today: 500, week: 12_400 })).toBe('Recto used 500 tokens today · 12k this week')
    expect(usageLine({ today: 0, week: 0 })).toBe('Not used by Recto yet')
    expect(windowLabel(300)).toBe('5 hours')
    const now = Date.now()
    const line = limitsLine({ plan: null, at: now, blocked: false, windows: [{ label: 'week', usedPercent: 12, resetsAt: null }, { label: '5 hours', usedPercent: 38.4, resetsAt: null }] }, now)
    expect(line).toBe('38% of 5 hours used; 12% of week used')
  })

  it("an old reading: a window that has reset since is left out, and the rest says when it was read", () => {
    // Read on 7 November at 23:24 (Claude Code reports only with an answer); looked at on the 9th at 12:28.
    const at = new Date('2026-11-07T23:24:00').getTime()
    const now = new Date('2026-11-09T12:28:00').getTime()
    const stale = {
      plan: null,
      at,
      blocked: false,
      windows: [
        { label: '5 hours', usedPercent: 27, resetsAt: new Date('2026-11-08T02:10:00').getTime() },
        { label: 'week', usedPercent: 56, resetsAt: new Date('2026-11-12T19:00:00').getTime() },
      ],
    }
    const line = limitsLine(stale, now)!
    expect(line).not.toContain('5 hours')
    expect(line).toMatch(/^56% of week used · resets .*\(as of .*\)$/)
    // Every window reset since: nothing left to say.
    expect(limitsLine({ ...stale, windows: [stale.windows[0]!] }, now)).toBeNull()
  })
})
