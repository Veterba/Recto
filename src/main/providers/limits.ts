import { app } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { weekStart as mondayOf } from '../../shared/overview'
import type { LimitWindow, ProviderId, ProviderLimits, ProviderUsage } from '../../shared/providers'
import { sharedUserData } from '../dev-guard'

/**
 * How much of a plan is left, where a provider says, and how much Recto
 * itself used.
 *
 * - Codex: its app server's `account/rateLimits/read` - the plan's windows,
 *   read without asking the model anything, so it costs nothing.
 * - Claude Code: the `rate_limit_event` its stream carries with an answer -
 *   so its meter fills in after the first question, and is kept.
 * - ChatGPT plan, API keys: no provider says what is left. What Recto used
 *   (each answer's token count) is all that can be shown.
 *
 * Kept in the installed app's folder (`provider-usage.json`), never the vault -
 * shared with a dev build, which spends from the same accounts (dev-guard.ts).
 */

type Saved = { usage: Record<string, Record<string, number>>; limits: Record<string, ProviderLimits> }

const FILE = (): string => path.join(sharedUserData(), 'provider-usage.json')
/** Days of usage kept: a week shows, a little more is slack. */
const KEEP_DAYS = 10

/**
 * Read from the file each time, never kept in memory: the installed app and a
 * dev build both write it, and a copy held from the start overwrote what the
 * other had written since - usage and limit readings went missing.
 */
function load(): Saved {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), 'utf8')) as Partial<Saved>
    return { usage: raw.usage ?? {}, limits: raw.limits ?? {} }
  } catch {
    return { usage: {}, limits: {} }
  }
}

/** Read, changed, written back at once - through a temp file, so the other build never reads half of it. */
function update(change: (saved: Saved) => void): void {
  const saved = load()
  change(saved)
  try {
    const tmp = `${FILE()}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(saved))
    fs.renameSync(tmp, FILE())
  } catch (err) {
    console.error('[providers] usage', err)
  }
}

const dayOf = (at: number): string => new Date(at).toLocaleDateString('en-CA')

export function recordUsage(id: ProviderId, tokens: number, now = Date.now()): void {
  if (!(tokens > 0)) return
  update((saved) => {
    const days = (saved.usage[id] ??= {})
    const today = dayOf(now)
    days[today] = (days[today] ?? 0) + Math.round(tokens)
    const cutoff = dayOf(now - KEEP_DAYS * 86_400_000)
    for (const day of Object.keys(days)) if (day < cutoff) delete days[day]
  })
}

/** "This week" as the overview counts it: since Monday (shared/overview.ts weekStart). */
export function usageOf(id: ProviderId, now = Date.now()): ProviderUsage {
  const days = load().usage[id] ?? {}
  const today = dayOf(now)
  const weekStart = mondayOf(today)
  let week = 0
  for (const [day, n] of Object.entries(days)) if (day >= weekStart && day <= today) week += n
  return { today: days[today] ?? 0, week }
}

export function recordLimits(id: ProviderId, limits: ProviderLimits): void {
  update((saved) => {
    saved.limits[id] = limits
  })
}

export const limitsOf = (id: ProviderId): ProviderLimits | null => load().limits[id] ?? null

/** "5 hours", "Week", "30 days" - a window's length as people say it. */
export function windowLabel(minutes: number): string {
  if (minutes === 300) return '5 hours'
  if (minutes === 10_080) return 'week'
  if (minutes % 1440 === 0) return `${minutes / 1440} days`
  if (minutes % 60 === 0) return `${minutes / 60} hours`
  return `${minutes} min`
}

type CodexWindow = { usedPercent?: unknown; windowDurationMins?: unknown; resetsAt?: unknown } | null | undefined

/** Codex's `account/rateLimits/read` result, as limits. */
export function codexLimits(result: unknown, now = Date.now()): ProviderLimits | null {
  const limits = (result as { rateLimits?: Record<string, unknown> } | null)?.rateLimits
  if (limits === undefined || limits === null) return null
  const window = (w: CodexWindow): LimitWindow[] =>
    w === null || w === undefined || typeof w.usedPercent !== 'number'
      ? []
      : [
          {
            label: typeof w.windowDurationMins === 'number' ? windowLabel(w.windowDurationMins) : 'the window',
            usedPercent: w.usedPercent,
            resetsAt: typeof w.resetsAt === 'number' ? w.resetsAt * 1000 : null,
          },
        ]
  return {
    plan: typeof limits['planType'] === 'string' ? limits['planType'] : null,
    windows: [...window(limits['primary'] as CodexWindow), ...window(limits['secondary'] as CodexWindow)],
    at: now,
    blocked: (limits['rateLimitReachedType'] ?? null) !== null || limits['spendControlReached'] === true,
  }
}

const CLAUDE_WINDOWS: Record<string, string> = {
  five_hour: '5 hours',
  seven_day: 'week',
  seven_day_opus: 'week (Opus)',
  seven_day_sonnet: 'week (Sonnet)',
  seven_day_overage_included: 'week, with extra usage',
}

/** Claude Code reports utilization as a fraction; a value over 1 is taken as already a percentage. */
const percent = (utilization: number): number => (utilization <= 1 ? utilization * 100 : utilization)

/** Claude Code's `rate_limit_info`, as limits. */
export function claudeLimits(info: unknown, now = Date.now()): ProviderLimits | null {
  if (info === null || typeof info !== 'object') return null
  const i = info as {
    status?: unknown
    resetsAt?: unknown
    rateLimitType?: unknown
    utilization?: unknown
    unifiedWindows?: Record<string, { utilization?: unknown; resetsAt?: unknown } | undefined>
  }
  const windows: LimitWindow[] = Object.entries(i.unifiedWindows ?? {}).flatMap(([key, w]) =>
    w === undefined || typeof w.utilization !== 'number'
      ? []
      : [{ label: CLAUDE_WINDOWS[key] ?? key, usedPercent: percent(w.utilization), resetsAt: typeof w.resetsAt === 'number' ? w.resetsAt * 1000 : null }],
  )
  if (windows.length === 0 && typeof i.utilization === 'number')
    windows.push({
      label: CLAUDE_WINDOWS[String(i.rateLimitType)] ?? 'the window',
      usedPercent: percent(i.utilization),
      resetsAt: typeof i.resetsAt === 'number' ? i.resetsAt * 1000 : null,
    })
  return { plan: null, windows, at: now, blocked: i.status === 'rejected' }
}

let codexCache: { at: number; value: ProviderLimits | null } | null = null

/**
 * Codex's limits, from its app server: started, asked, stopped - no thread,
 * no model call. Remembered for a minute; null when it cannot say.
 */
export function readCodexLimits(file: string, env: NodeJS.ProcessEnv, timeoutMs = 10_000): Promise<ProviderLimits | null> {
  // A failed read remembered: the last reading still shows, as it did the first time.
  if (codexCache !== null && Date.now() - codexCache.at < 60_000) return Promise.resolve(codexCache.value ?? limitsOf('codex'))
  return new Promise((resolve) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-limits-'))
    const child = spawn(file, ['app-server'], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] })
    let pending = ''
    let done = false
    const finish = (value: ProviderLimits | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.kill()
      fs.rmSync(cwd, { recursive: true, force: true })
      codexCache = { at: Date.now(), value }
      if (value !== null) recordLimits('codex', value)
      resolve(value ?? limitsOf('codex'))
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    child.on('error', () => finish(null))
    child.on('close', () => finish(null))
    // Started on each Settings open: an app server gone before it read the request must not take main down (EPIPE).
    child.stdin.on('error', () => undefined)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      pending += chunk
      let at = pending.indexOf('\n')
      while (at !== -1) {
        const line = pending.slice(0, at)
        pending = pending.slice(at + 1)
        at = pending.indexOf('\n')
        try {
          const message = JSON.parse(line) as { id?: unknown; result?: unknown; error?: unknown }
          if (message.id === 2) finish(message.error === undefined ? codexLimits(message.result) : null)
        } catch {
          // Not a line of the protocol.
        }
      }
    })
    child.stdin.write(
      [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'recto', title: 'Recto', version: app.getVersion() } } },
        { jsonrpc: '2.0', method: 'initialized' },
        { jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read' },
      ]
        .map((m) => JSON.stringify(m))
        .join('\n') + '\n',
    )
  })
}

export const forgetCodexLimits = (): void => {
  codexCache = null
}
