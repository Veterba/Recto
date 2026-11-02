import { shell } from 'electron'
import os from 'node:os'
import { AI_ACCESS_STATE, coerceAiAccess } from '../../shared/ai-access'
import { AI_MODELS } from '../../shared/ai'
import { modelPart, PROVIDERS, providerInfo, providerOf, type ProviderId, type ProviderModel, type ProviderProblem, type ProviderStatus } from '../../shared/providers'
import { readKey } from '../secrets'
import { readState } from '../state'
import { launcherPath } from '../vault-tools/launcher'
import { messagesModel } from './anthropic'
import { ChatGptAuth } from './chatgpt-auth'
import { cliRunner, signedIn, INSTALL_URL } from './cli'
import { findCli, loginShellPath, runPath, type CliName } from './detect'
import { OPENAI_BASE, responsesModel } from './openai'
import { ollamaModel } from './ollama'
import { ProviderError, toolLoop, toolsOf, withSteps, type RunEvent, type RunRequest, type Runner } from './run'
import { keychainStore } from './store'
import { forgetCodexLimits, limitsOf, readCodexLimits, recordLimits, recordUsage, usageOf } from './limits'
import type { BotModelProvider } from '../bots/provider'

/**
 * Recto's providers, on the main side: which can answer, and one answer from
 * any of them (run.ts's shape). Ollama is the default and stays on this Mac;
 * the others are cloud providers, off in a vault until turned on there.
 */

export const chatgpt = new ChatGptAuth({ store: keychainStore, open: (url) => void shell.openExternal(url) })

const OPENAI_KEY = 'openai'

export const openAiKey = (): string | null => keychainStore.read(OPENAI_KEY)
export const setOpenAiKey = (key: string | null): { ok: boolean; error?: string } =>
  keychainStore.write(OPENAI_KEY, key === null || key.trim() === '' ? null : key.trim())

/** Cloud providers may answer in the open vault. */
export const cloudEnabled = (): boolean => coerceAiAccess(readState(AI_ACCESS_STATE)).cloud

/**
 * Where a CLI is. `RECTO_CLI_DIRS` (tests) replaces every place it would be
 * looked for, so a test's fake CLI is found and the real one never is.
 */
async function find(name: CliName): Promise<string | null> {
  const only = process.env['RECTO_CLI_DIRS']
  if (only !== undefined) return findCli(name, { home: '/nonexistent', envPath: only, loginPath: null, root: '/nonexistent' })
  return findCli(name, { home: os.homedir(), envPath: process.env['PATH'] ?? '', loginPath: await loginShellPath() })
}

const cliPath = async (): Promise<string> =>
  process.env['RECTO_CLI_DIRS'] !== undefined
    ? `${process.env['RECTO_CLI_DIRS']}:${process.env['PATH'] ?? ''}`
    : runPath(await loginShellPath(), process.env['PATH'] ?? '')

const cliDeps = { find, path: cliPath, launcher: () => launcherPath() }
const CLI: Record<'codex' | 'claude-code', CliName> = { codex: 'codex', 'claude-code': 'claude' }

/** What each provider says about itself, for Settings and the picker. Asks nothing that costs. */
export async function statuses(local: () => Promise<ProviderModel[]>): Promise<ProviderStatus[]> {
  return Promise.all(PROVIDERS.map((p) => statusOf(p.id, local)))
}

async function statusOf(id: ProviderId, local: () => Promise<ProviderModel[]>): Promise<ProviderStatus> {
  const base = { id, problem: null, detail: null, models: [] as ProviderModel[], limits: limitsOf(id), usage: usageOf(id) }
  if (id === 'ollama') {
    const models = await local()
    return { ...base, ready: models.length > 0, models, problem: models.length > 0 ? null : { kind: 'down', message: 'Ollama is not running, or has no models.' } }
  }
  if (id === 'codex' || id === 'claude-code') {
    const name = CLI[id]
    const file = await find(name)
    if (file === null) return { ...base, ready: false, problem: { kind: 'cli-missing', message: 'Not installed, or not found.', url: INSTALL_URL[name] } }
    const env = { ...process.env, PATH: await cliPath() }
    const ok = await signedIn(name, file, env)
    // Codex says its limits on request, for free; Claude Code only with an answer (kept from the last one).
    const limits = ok && id === 'codex' ? await readCodexLimits(file, env) : base.limits
    const models = id === 'claude-code' ? ['opus', 'sonnet', 'haiku'].map((m) => ({ id: m, label: m[0]!.toUpperCase() + m.slice(1) })) : []
    return {
      ...base,
      limits,
      ready: ok,
      detail: file,
      models: [{ id: '', label: 'Default model' }, ...models],
      problem: ok ? null : { kind: 'signed-out', message: `Not signed in. Run \`${name === 'codex' ? 'codex login' : 'claude'}\` in a terminal.` },
    }
  }
  if (id === 'chatgpt') {
    const record = chatgpt.record()
    if (!chatgpt.signedIn()) return { ...base, ready: false, problem: { kind: 'signed-out', message: 'Not signed in.' } }
    if (!chatgpt.planAllowed())
      return { ...base, ready: false, detail: record?.email ?? null, problem: { kind: 'signed-out', message: 'Plan usage was not allowed at sign-in.' } }
    const models = await chatgpt.models().catch(() => [])
    return { ...base, ready: true, detail: record?.email ?? null, models }
  }
  if (id === 'openai') {
    const key = openAiKey()
    if (key === null) return { ...base, ready: false, problem: { kind: 'no-key', message: 'No key saved.' } }
    return { ...base, ready: true, detail: `sk-…${key.slice(-4)}`, models: await openAiModels(key) }
  }
  const key = readKey()
  if (key === null) return { ...base, ready: false, problem: { kind: 'no-key', message: 'No key saved.' } }
  return { ...base, ready: true, detail: `sk-ant-…${key.slice(-4)}`, models: AI_MODELS.map((m) => ({ id: m.id, label: m.label })) }
}

/** The key's chat models, newest first; no call when it fails. */
async function openAiModels(key: string): Promise<ProviderModel[]> {
  try {
    const response = await fetch(`${OPENAI_BASE()}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) })
    if (!response.ok) return []
    const body = (await response.json()) as { data?: { id?: unknown; created?: unknown }[] }
    return (body.data ?? [])
      .filter((m): m is { id: string; created?: unknown } => typeof m.id === 'string' && /^(gpt-|o\d)/.test(m.id))
      .filter((m) => !/audio|realtime|image|tts|transcribe|search|instruct/.test(m.id))
      .sort((a, b) => Number(b.created ?? 0) - Number(a.created ?? 0))
      .map((m) => ({ id: m.id, label: m.id }))
  } catch {
    return []
  }
}

function runnerFor(model: string, local: BotModelProvider): Runner {
  const id = providerOf(model)
  const inner = modelPart(model)
  if (id === 'codex' || id === 'claude-code') return cliRunner(CLI[id], cliDeps)
  return (request: RunRequest) => {
    const tools = toolsOf(request.session)
    if (id === 'chatgpt')
      return toolLoop(responsesModel(inner, { token: () => chatgpt.token(), refreshed: () => chatgpt.refresh(), plan: true }, tools), request)
    if (id === 'openai') {
      const key = openAiKey()
      if (key === null) throw new ProviderError({ kind: 'no-key', message: 'No OpenAI key saved. Add one in Settings → AI.' })
      return toolLoop(responsesModel(inner, { token: async () => key, plan: false }, tools), request)
    }
    if (id === 'anthropic') {
      const key = readKey()
      if (key === null) throw new ProviderError({ kind: 'no-key', message: 'No Anthropic key saved. Add one in Settings → AI.' })
      return toolLoop(messagesModel(inner, key, tools), request)
    }
    return toolLoop(ollamaModel(inner, local, tools), request)
  }
}

/**
 * One answer, with its steps. A cloud provider in a vault where cloud is off
 * refuses before anything is sent anywhere.
 */
export async function* run(request: RunRequest, local: BotModelProvider): AsyncIterable<Exclude<RunEvent, { type: 'usage' | 'limits' }>> {
  const id = providerOf(request.model)
  if (id !== 'ollama' && !cloudEnabled())
    throw new ProviderError({ kind: 'cloud-off', message: 'Cloud providers are off for this vault. Turn them on in Settings → AI → Providers.' })
  try {
    // What the answer used, and the plan's limits, are kept for Settings and the picker; the answer gets the rest.
    for await (const event of withSteps(runnerFor(request.model, local), request)) {
      if (event.type === 'usage') recordUsage(id, event.tokens)
      else if (event.type === 'limits') recordLimits(id, event.limits)
      else yield event
    }
  } finally {
    if (id === 'codex') forgetCodexLimits()
  }
}

/** Whether a cloud model can answer now, without asking anything that costs; null when it can. */
export async function readiness(model: string): Promise<ProviderProblem | null> {
  const id = providerOf(model)
  if (id === 'ollama') return null
  if (!cloudEnabled()) return { kind: 'cloud-off', message: 'Cloud providers are off for this vault. Turn them on in Settings → AI → Providers.' }
  if (id === 'codex' || id === 'claude-code') {
    const name = CLI[id]
    const file = await find(name)
    if (file === null) return { kind: 'cli-missing', message: `${providerInfo(id).name} is not installed, or Recto cannot find it.`, url: INSTALL_URL[name] }
    if (!(await signedIn(name, file, { ...process.env, PATH: await cliPath() })))
      return { kind: 'signed-out', message: `${providerInfo(id).name} is not signed in. Run \`${name === 'codex' ? 'codex login' : 'claude'}\` in a terminal.` }
    return null
  }
  if (id === 'chatgpt') {
    if (!chatgpt.signedIn()) return { kind: 'signed-out', message: 'Sign in with ChatGPT in Settings → AI → Providers.' }
    if (!chatgpt.planAllowed()) return { kind: 'signed-out', message: 'Plan usage was not allowed at sign-in. Sign in again and allow it.' }
    return null
  }
  if (id === 'openai') return openAiKey() === null ? { kind: 'no-key', message: 'No OpenAI key saved. Add one in Settings → AI → Providers.' } : null
  return readKey() === null ? { kind: 'no-key', message: 'No Anthropic key saved. Add one in Settings → AI.' } : null
}
