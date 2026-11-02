/**
 * Where an answer comes from. Ollama runs on this Mac and is the default;
 * everything else is a cloud provider, off for a vault until it is turned on
 * there (Settings → AI → Providers).
 *
 * A bot's model is one string, so a provider rides in it as a prefix:
 * `codex`, `codex:<model>`, `chatgpt:<slug>`, `claude-code`, `openai:<model>`,
 * `anthropic:<id>`. A bare name is an Ollama model; a bare Anthropic id (one
 * of AI_MODELS, from before providers) is the Anthropic key's. Every answer
 * keeps the string it was written with, so a topic records who answered.
 */

import { AI_MODELS, isAiModel } from './ai'

export type ProviderId = 'ollama' | 'codex' | 'chatgpt' | 'claude-code' | 'openai' | 'anthropic'

/** Who makes the models: the picker groups the ways in by it. Ollama runs many makers' models, so it has none. */
export type Vendor = 'anthropic' | 'openai'

export const VENDORS: readonly { id: Vendor; name: string }[] = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'openai', name: 'OpenAI' },
]

export type ProviderInfo = {
  id: ProviderId
  name: string
  vendor?: Vendor
  where: 'mac' | 'cloud'
  /** Agents run their own loop with only Recto's tools; models are driven by Recto's loop. */
  kind: 'agent' | 'model'
  badge?: 'Preview' | 'Experimental'
  /** Under "Advanced" in Settings: an API key, billed by the provider. */
  advanced?: boolean
  /** One line under its name in Settings. */
  blurb: string
}

export const PROVIDERS: readonly ProviderInfo[] = [
  { id: 'ollama', name: 'Ollama', where: 'mac', kind: 'model', blurb: 'Runs on this Mac. Nothing leaves it.' },
  { id: 'codex', name: 'Codex', vendor: 'openai', where: 'cloud', kind: 'agent', blurb: 'Your Codex CLI, signed in with your ChatGPT plan or key.' },
  { id: 'chatgpt', name: 'ChatGPT plan', vendor: 'openai', where: 'cloud', kind: 'model', badge: 'Preview', blurb: 'Sign in with ChatGPT; answers use your plan.' },
  {
    id: 'claude-code',
    name: 'Claude Code',
    vendor: 'anthropic',
    where: 'cloud',
    kind: 'agent',
    badge: 'Experimental',
    blurb: 'Your Claude Code CLI. Not an Anthropic-supported use of a subscription; the API key is.',
  },
  { id: 'openai', name: 'OpenAI API key', vendor: 'openai', where: 'cloud', kind: 'model', advanced: true, blurb: 'Billed to your OpenAI account.' },
  { id: 'anthropic', name: 'Anthropic API key', vendor: 'anthropic', where: 'cloud', kind: 'model', advanced: true, blurb: 'Billed to your Anthropic account.' },
]

export const providerInfo = (id: ProviderId): ProviderInfo => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]!

const PREFIXED: readonly ProviderId[] = ['codex', 'chatgpt', 'claude-code', 'openai', 'anthropic']

/** The provider a model string names. */
export function providerOf(model: string): ProviderId {
  // `codex` and `claude-code` stand alone (the CLI's own default); the others always name a model.
  if (model === 'codex' || model === 'claude-code') return model
  const prefixed = PREFIXED.find((p) => model.startsWith(`${p}:`))
  if (prefixed !== undefined) return prefixed
  return isAiModel(model) ? 'anthropic' : 'ollama'
}

/** The model inside a provider's string: '' for an agent's own default. */
export function modelPart(model: string): string {
  const provider = providerOf(model)
  if (provider === 'ollama') return model
  if (provider === 'anthropic' && !model.startsWith('anthropic:')) return model
  return model.includes(':') ? model.slice(model.indexOf(':') + 1) : ''
}

export const isCloudModel = (model: string): boolean => providerOf(model) !== 'ollama'

export const modelString = (provider: ProviderId, model: string): string =>
  provider === 'ollama' ? model : model === '' ? provider : `${provider}:${model}`

/** How a model is shown: "Codex", "ChatGPT plan · gpt-6.1", "qwen3.5 · 9b". */
export function modelLabel(model: string): string {
  const provider = providerOf(model)
  const inner = modelPart(model)
  if (provider === 'ollama') return inner.replace(':', ' · ')
  const known = provider === 'anthropic' ? AI_MODELS.find((m) => m.id === inner)?.label : undefined
  const name = providerInfo(provider).name.replace(' API key', '')
  return inner === '' ? name : `${name} · ${known ?? inner}`
}

/** A model a provider offers in the picker. */
export type ProviderModel = { id: string; label: string }

/** What is wrong with a provider, each with its own way out. */
export type ProviderProblemKind =
  | 'cloud-off'
  | 'cli-missing'
  | 'signed-out'
  | 'expired'
  | 'no-key'
  | 'limit'
  | 'not-eligible'
  | 'down'
  | 'excluded'
  | 'failed'

export type ProviderProblem = {
  kind: ProviderProblemKind
  message: string
  /** Where to fix it: a page to open, or Settings. */
  url?: string
}

/** One of a plan's usage windows, as the provider reports it: "5 hours", 38% used, resets at… */
export type LimitWindow = { label: string; usedPercent: number; resetsAt: number | null }

/** A plan's limits as last reported (only Codex and Claude Code report them), and when. */
export type ProviderLimits = { plan: string | null; windows: LimitWindow[]; at: number; blocked: boolean }

/** Tokens Recto itself used with a provider: what it spent, not what is left. */
export type ProviderUsage = { today: number; week: number }

export type ProviderStatus = {
  id: ProviderId
  /** Ready to answer; otherwise `problem` says why not. */
  ready: boolean
  problem: ProviderProblem | null
  /** For a CLI: where it was found. For ChatGPT: the signed-in account. For a key: its hint. */
  detail: string | null
  models: ProviderModel[]
  limits: ProviderLimits | null
  usage: ProviderUsage
}

/** "38% of 5 hours · resets 14:20" - the tightest window first. */
export function limitsLine(limits: ProviderLimits, now = Date.now()): string {
  const windows = [...limits.windows].sort((a, b) => b.usedPercent - a.usedPercent)
  return windows
    .map((w) => {
      const reset = w.resetsAt === null ? '' : ` · resets ${resetLabel(w.resetsAt, now)}`
      return `${Math.round(w.usedPercent)}% of ${w.label} used${reset}`
    })
    .join('; ')
}

function resetLabel(at: number, now: number): string {
  const date = new Date(at)
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (at - now < 20 * 3600_000) return time
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** "12.4k tokens today · 81k this week" */
export function usageLine(usage: ProviderUsage): string {
  const n = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : String(v))
  return usage.week === 0 ? 'Not used by Recto yet' : `Recto used ${n(usage.today)} tokens today · ${n(usage.week)} this week`
}

/** The cloud providers, each with the vault's switch: off until turned on there. */
export type CloudSettings = { enabled: boolean }

/** What a problem tells the person, by kind, when the provider gave nothing better. */
export const PROBLEM_TEXT: Record<ProviderProblemKind, string> = {
  'cloud-off': 'Cloud providers are off for this vault. Turn them on in Settings → AI → Providers.',
  'cli-missing': 'The CLI is not installed, or Recto cannot find it.',
  'signed-out': 'Not signed in.',
  expired: 'The sign-in expired. Sign in again.',
  'no-key': 'No API key saved.',
  limit: 'The plan’s usage limit is reached.',
  'not-eligible': 'This account cannot use its plan in other apps.',
  down: 'The provider is not answering right now. Try again in a moment.',
  excluded: 'That note is in a folder AI may not see (Settings → AI → Excluded).',
  failed: 'The provider could not answer.',
}

export const USAGE_URL = 'https://chatgpt.com/settings/usage'
