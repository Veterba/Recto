import { isAiModel, type AiMessage } from '../../shared/ai'
import type { BotModelStatus, PullProgress } from '../../shared/bots'
import { DirectProvider } from '../ai/provider'
import { requestFields } from './models/profiles'

/**
 * The model behind the bots, behind one small interface.
 *
 * Today that is Ollama, running on this Mac, reached over its HTTP API on
 * localhost and nothing else: no key, no cloud, nothing leaves the machine.
 * Recto, the main bot, may also run on an Anthropic model when an API key is
 * saved (AnthropicProvider below, over the app's own client); every bot works
 * with no key at all.
 *
 * TODO(bundled-model): later we replace Ollama with node-llama-cpp inside the
 * app, behind this same interface, so nothing has to be installed separately.
 */
/** What the model reports about one answer when it is done (Ollama's last line). The evals read it. */
export type StreamStats = { promptTokens: number; promptMs: number; evalTokens: number; evalMs: number; loadMs: number }

/** `maxTokens`: the longest answer, over the profile's - a review or a plan may run longer than a plain answer. */
export type StreamOptions = { model: string; signal: AbortSignal; onStats?: (stats: StreamStats) => void; maxTokens?: number }

/** A short call that is not shown to anyone: the router, extracting tasks. Greedy, short, optionally JSON. */
export type CompleteOptions = { model: string; signal: AbortSignal; json?: boolean; maxTokens: number }

/** A tool the model may call, in Ollama's (OpenAI-style) format. */
export type ToolSpec = {
  type: 'function'
  function: { name: string; description: string; parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] } }
}

/** A turn in a conversation with tool calls: the model's calls, and what each returned. */
export type ChatTurn =
  | AiMessage
  | { role: 'assistant'; content: string; tool_calls: { function: { name: string; arguments: Record<string, unknown> } }[] }
  | { role: 'tool'; content: string; tool_name: string }

/** What comes back while the model answers with tools: text, or the tools it wants called. */
export type ChatEvent = { type: 'text'; text: string } | { type: 'tools'; calls: { name: string; args: Record<string, unknown> }[] }

export interface BotModelProvider {
  /** The reply, token by token. Throws when the model cannot run; stops when `signal` aborts. */
  stream(messages: AiMessage[], system: string, options: StreamOptions): AsyncIterable<string>
  /** The whole reply at once, at temperature 0. Throws when the model cannot run. */
  complete(messages: AiMessage[], system: string, options: CompleteOptions): Promise<string>
  status(model: string): Promise<BotModelStatus>
  /** Load the model ahead of the first question, so it is not the user's wait. */
  warm(model: string): void
  /** The reply with tools offered: text as it comes, or the calls the model asks for. Only local models. */
  streamChat?(turns: ChatTurn[], system: string, tools: ToolSpec[], options: StreamOptions): AsyncIterable<ChatEvent>
}

/** How much the model is asked to hold at once, in tokens: prompt and answer together. */
export const CONTEXT_TOKENS = 8192

/**
 * How long Ollama keeps the model in memory after the last request: for as
 * long as the app is open (-1), so no question pays ten seconds of loading.
 * The app unloads it when it quits (`unloadOnQuit` in bots/index.ts).
 */
const KEEP_ALIVE = -1

/** Localhost only - the one address this module ever connects to. */
const OLLAMA = 'http://127.0.0.1:11434'

/** Does `installed` (Ollama's names, always with a tag) contain `model` (with or without one)? */
export function hasModel(installed: readonly string[], model: string): boolean {
  const want = model.includes(':') ? model : `${model}:latest`
  return installed.includes(want)
}

/** What can be done with local models besides talking to them: list, download, load and unload. */
export interface LocalModels {
  /** Installed models that can chat, with their size on disk; null when Ollama is not running. */
  installed(): Promise<{ name: string; bytes: number }[] | null>
  /** Download a model, reporting progress; stops when `signal` aborts. */
  pull(model: string, onProgress: (progress: PullProgress) => void, signal: AbortSignal): Promise<void>
  /** Load a model into memory now, so the first question does not wait for it. */
  preload(model: string): Promise<void>
  /** Take a model out of memory: on a 16 GB Mac only one fits at a time. */
  unload(model: string): Promise<void>
}

export class OllamaProvider implements BotModelProvider, LocalModels {
  /** What each installed model says it can do ("completion", "thinking", "tools"...), from the last listing. */
  private readonly capabilities = new Map<string, string[]>()
  /** Models being loaded into memory right now: their status says so. */
  private readonly loading = new Set<string>()

  private async tags(): Promise<{ name: string; size: number; capabilities: string[] }[] | null> {
    try {
      const response = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2000) })
      if (!response.ok) return null
      const body = (await response.json()) as { models?: { name?: unknown; size?: unknown; capabilities?: unknown }[] }
      const models = (body.models ?? [])
        .filter((m): m is { name: string; size?: unknown; capabilities?: unknown } => typeof m.name === 'string')
        .map((m) => ({
          name: m.name,
          size: typeof m.size === 'number' ? m.size : 0,
          capabilities: Array.isArray(m.capabilities) ? m.capabilities.filter((c): c is string => typeof c === 'string') : ['completion'],
        }))
      for (const m of models) this.capabilities.set(m.name, m.capabilities)
      return models
    } catch {
      return null
    }
  }

  async installed(): Promise<{ name: string; bytes: number }[] | null> {
    const models = await this.tags()
    // An embedding model is installed too, but cannot hold a conversation.
    return models === null
      ? null
      : models.filter((m) => m.capabilities.includes('completion')).map((m) => ({ name: m.name, bytes: m.size }))
  }

  async status(model: string): Promise<BotModelStatus> {
    const models = await this.tags()
    if (models === null) return { state: 'not-running', model }
    const names = models.map((m) => m.name)
    if (!hasModel(names, model)) return { state: 'no-model', model, installed: names }
    return this.loading.has(model) ? { state: 'loading', model } : { state: 'ready', model }
  }

  async preload(model: string): Promise<void> {
    this.loading.add(model)
    try {
      // A generate request with no prompt only loads the model; nothing is written. Loaded with
      // the same options as a real request, or the first question would load it again.
      await fetch(`${OLLAMA}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          keep_alive: KEEP_ALIVE,
          options: requestFields(model, this.capabilities.get(model) ?? null).options,
        }),
      })
    } catch {
      // Not running, or the model went away: the status says so on the next look.
    } finally {
      this.loading.delete(model)
    }
  }

  warm(model: string): void {
    if (!this.loading.has(model)) void this.preload(model)
  }

  async unload(model: string): Promise<void> {
    await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 }),
    }).catch(() => undefined)
  }

  async pull(model: string, onProgress: (progress: PullProgress) => void, signal: AbortSignal): Promise<void> {
    const response = await fetch(`${OLLAMA}/api/pull`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    })
    if (!response.ok || response.body === null) throw new Error(`Ollama answered ${response.status}`)
    const decoder = new TextDecoder()
    let pending = ''
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      pending += decoder.decode(chunk, { stream: true })
      let newline = pending.indexOf('\n')
      while (newline !== -1) {
        const line = pending.slice(0, newline).trim()
        pending = pending.slice(newline + 1)
        newline = pending.indexOf('\n')
        if (line === '') continue
        const event = JSON.parse(line) as { status?: unknown; total?: unknown; completed?: unknown; error?: unknown }
        if (typeof event.error === 'string') throw new Error(event.error)
        onProgress({
          name: model,
          status: typeof event.status === 'string' ? event.status : '',
          completed: typeof event.completed === 'number' ? event.completed : 0,
          total: typeof event.total === 'number' ? event.total : 0,
        })
      }
    }
  }

  async complete(messages: AiMessage[], system: string, { model, signal, json = false, maxTokens }: CompleteOptions): Promise<string> {
    const fields = requestFields(model, this.capabilities.get(model) ?? null)
    const response = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: KEEP_ALIVE,
        ...fields,
        ...(json ? { format: 'json' } : {}),
        options: { ...fields.options, temperature: 0, num_predict: maxTokens },
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    })
    if (!response.ok) throw new Error(`Ollama answered ${response.status}`)
    const body = (await response.json()) as { message?: { content?: unknown } }
    return typeof body.message?.content === 'string' ? body.message.content : ''
  }

  async *stream(messages: AiMessage[], system: string, { model, signal, onStats, maxTokens }: StreamOptions): AsyncIterable<string> {
    const fields = requestFields(model, this.capabilities.get(model) ?? null)
    const response = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        keep_alive: KEEP_ALIVE,
        // How thinking is turned off, the context size, the answer's length: the model's profile.
        ...fields,
        ...(maxTokens === undefined ? {} : { options: { ...fields.options, num_predict: maxTokens } }),
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    })
    if (!response.ok || response.body === null) {
      let detail = `Ollama answered ${response.status}`
      try {
        const body = (await response.json()) as { error?: unknown }
        if (typeof body.error === 'string') detail = body.error
      } catch {
        // No JSON body: the status is all there is.
      }
      throw new Error(detail)
    }
    yield* readLines(response.body, onStats)
  }

  async *streamChat(
    turns: ChatTurn[],
    system: string,
    tools: ToolSpec[],
    { model, signal, onStats, maxTokens }: StreamOptions,
  ): AsyncIterable<ChatEvent> {
    const fields = requestFields(model, this.capabilities.get(model) ?? null)
    const response = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        keep_alive: KEEP_ALIVE,
        ...fields,
        ...(maxTokens === undefined ? {} : { options: { ...fields.options, num_predict: maxTokens } }),
        tools,
        messages: [{ role: 'system', content: system }, ...turns],
      }),
    })
    if (!response.ok || response.body === null) throw new Error(`Ollama answered ${response.status}`)
    yield* readChatLines(response.body, onStats)
  }
}

/** Ollama's stream with tools: each line carries text, or (once) the tool calls. */
export async function* readChatLines(body: ReadableStream<Uint8Array>, onStats?: (stats: StreamStats) => void): AsyncIterable<ChatEvent> {
  const decoder = new TextDecoder()
  let pending = ''
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(chunk, { stream: true })
    let newline = pending.indexOf('\n')
    while (newline !== -1) {
      const line = pending.slice(0, newline).trim()
      pending = pending.slice(newline + 1)
      newline = pending.indexOf('\n')
      if (line === '') continue
      const event = JSON.parse(line) as {
        message?: { content?: unknown; tool_calls?: { function?: { name?: unknown; arguments?: unknown } }[] }
        error?: unknown
        done?: unknown
        prompt_eval_count?: unknown
        prompt_eval_duration?: unknown
        eval_count?: unknown
        eval_duration?: unknown
        load_duration?: unknown
      }
      if (typeof event.error === 'string') throw new Error(event.error)
      const calls = (event.message?.tool_calls ?? [])
        .map((c) => ({
          name: typeof c.function?.name === 'string' ? c.function.name : '',
          args:
            typeof c.function?.arguments === 'object' && c.function.arguments !== null
              ? (c.function.arguments as Record<string, unknown>)
              : {},
        }))
        .filter((c) => c.name !== '')
      if (calls.length > 0) yield { type: 'tools', calls }
      const text = event.message?.content
      if (typeof text === 'string' && text !== '') yield { type: 'text', text }
      if (event.done === true) {
        const n = (v: unknown): number => (typeof v === 'number' ? v : 0)
        onStats?.({
          promptTokens: n(event.prompt_eval_count),
          promptMs: n(event.prompt_eval_duration) / 1e6,
          evalTokens: n(event.eval_count),
          evalMs: n(event.eval_duration) / 1e6,
          loadMs: n(event.load_duration) / 1e6,
        })
        return
      }
    }
  }
}

/** Ollama streams one JSON object per line; each carries the next piece of the message. */
export async function* readLines(body: ReadableStream<Uint8Array>, onStats?: (stats: StreamStats) => void): AsyncIterable<string> {
  const decoder = new TextDecoder()
  let pending = ''
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(chunk, { stream: true })
    let newline = pending.indexOf('\n')
    while (newline !== -1) {
      const line = pending.slice(0, newline).trim()
      pending = pending.slice(newline + 1)
      newline = pending.indexOf('\n')
      if (line === '') continue
      const event = JSON.parse(line) as {
        message?: { content?: unknown }
        error?: unknown
        done?: unknown
        prompt_eval_count?: unknown
        prompt_eval_duration?: unknown
        eval_count?: unknown
        eval_duration?: unknown
        load_duration?: unknown
      }
      if (typeof event.error === 'string') throw new Error(event.error)
      const text = event.message?.content
      if (typeof text === 'string' && text !== '') yield text
      if (event.done === true) {
        const n = (v: unknown): number => (typeof v === 'number' ? v : 0)
        onStats?.({
          promptTokens: n(event.prompt_eval_count),
          promptMs: n(event.prompt_eval_duration) / 1e6,
          evalTokens: n(event.eval_count),
          evalMs: n(event.eval_duration) / 1e6,
          loadMs: n(event.load_duration) / 1e6,
        })
        return
      }
    }
  }
}

/**
 * An Anthropic model, for a bot whose chosen model is one of AI_MODELS and
 * only while a key is saved. The app's own client, behind the bots'
 * interface: its callbacks become the same token stream Ollama gives.
 */
export class AnthropicProvider implements BotModelProvider {
  constructor(private readonly key: () => string | null) {}

  async status(model: string): Promise<BotModelStatus> {
    return this.key() === null ? { state: 'no-key', model } : { state: 'ready', model }
  }

  warm(): void {}

  async complete(messages: AiMessage[], system: string, { model, signal, json = false }: CompleteOptions): Promise<string> {
    let text = ''
    const instruction = json ? `${system}\n\nReply with the JSON object only.` : system
    for await (const piece of this.stream(messages, instruction, { model, signal })) text += piece
    return text
  }

  async *stream(messages: AiMessage[], system: string, { model, signal, maxTokens = 1024 }: StreamOptions): AsyncIterable<string> {
    const key = this.key()
    if (key === null) throw new Error('No API key saved. Add one in Settings → AI.')
    const queue: string[] = []
    let finished = false
    let failure: string | null = null
    let wake: (() => void) | null = null
    const poke = (): void => wake?.()
    const running = new DirectProvider(key).stream(
      { model, system, messages, maxTokens },
      {
        onDelta: (text) => {
          queue.push(text)
          poke()
        },
        onDone: () => {
          finished = true
          poke()
        },
        onError: (message) => {
          failure = message
          finished = true
          poke()
        },
      },
      signal,
    )
    for (;;) {
      const next = queue.shift()
      if (next !== undefined) {
        yield next
        continue
      }
      if (finished) break
      await new Promise<void>((resolve) => (wake = resolve))
      wake = null
    }
    await running
    if (failure !== null && !signal.aborted) throw new Error(failure)
  }
}

/** Is this one of the API models rather than a local one? */
export const isApiModel = (model: string): boolean => isAiModel(model)

/**
 * A stand-in for the snapshot run (RECTO_BOTS_MOCK=1): always ready, and
 * always the same reply, so screenshots of a bot chat need no Ollama and come
 * out identical every time.
 */
export class MockProvider implements BotModelProvider, LocalModels {
  warm(): void {}

  async installed(): Promise<{ name: string; bytes: number }[]> {
    return [{ name: 'qwen3.5:9b', bytes: 6_590_000_000 }]
  }

  async pull(model: string, onProgress: (progress: PullProgress) => void): Promise<void> {
    onProgress({ name: model, status: 'success', completed: 1, total: 1 })
  }

  async preload(): Promise<void> {}

  async unload(): Promise<void> {}

  async status(model: string): Promise<BotModelStatus> {
    return { state: 'ready', model }
  }

  /** The router's answer for the snapshot run: every question is about the notes. */
  async complete(messages: AiMessage[]): Promise<string> {
    const content = messages.at(-1)?.content ?? ''
    const question = content.slice(content.lastIndexOf('Message: ') + 'Message: '.length)
    return JSON.stringify({ kind: 'notes', query: question, keywords_en: [], keywords_ru: [], notes: [], when: null })
  }

  async *stream(_messages: AiMessage[], system: string, { signal }: { model: string; signal: AbortSignal }): AsyncIterable<string> {
    if (system.startsWith('Write a title')) {
      yield 'Soil mix'
      return
    }
    const reply = 'Your notes keep the soil mix simple: compost, loam and grit, tested for pH before planting.'
    // All at once, the way a real model's last tokens and its end arrive: the
    // case where the renderer gets the end before it has drawn the last token.
    // RECTO_BOTS_MOCK_DELAY (ms a word): slow enough for a test to leave the chat mid-answer.
    const delay = Number(process.env['RECTO_BOTS_MOCK_DELAY'] ?? 0)
    for (const word of reply.split(/(?<= )/)) {
      if (signal.aborted) return
      if (delay > 0) await new Promise((r) => setTimeout(r, delay))
      if (signal.aborted) return
      yield word
    }
  }
}
