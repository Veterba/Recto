import { isAiModel, type AiMessage } from '../../shared/ai'
import type { BotModelStatus } from '../../shared/bots'
import { DirectProvider } from '../ai/provider'

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
export interface BotModelProvider {
  /** The reply, token by token. Throws when the model cannot run; stops when `signal` aborts. */
  stream(messages: AiMessage[], system: string, options: { model: string; signal: AbortSignal }): AsyncIterable<string>
  status(model: string): Promise<BotModelStatus>
  /** Load the model ahead of the first question, so it is not the user's wait. */
  warm(model: string): void
}

/** How much the model is asked to hold at once, in tokens: prompt and answer together. */
export const CONTEXT_TOKENS = 8192

/**
 * How long Ollama keeps the model in memory after the last request. Its own
 * default is five minutes, after which the next question pays ten seconds of
 * loading again; a quarter of an hour covers a conversation with pauses.
 */
const KEEP_ALIVE = '15m'

/** Localhost only - the one address this module ever connects to. */
const OLLAMA = 'http://127.0.0.1:11434'

/** Does `installed` (Ollama's names, always with a tag) contain `model` (with or without one)? */
export function hasModel(installed: readonly string[], model: string): boolean {
  const want = model.includes(':') ? model : `${model}:latest`
  return installed.includes(want)
}

export class OllamaProvider implements BotModelProvider {
  warm(model: string): void {
    // A generate request with no prompt only loads the model; nothing is written.
    void fetch(`${OLLAMA}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The same context size as a real request: loaded with any other, the
      // model would be loaded again for the first question.
      body: JSON.stringify({ model, keep_alive: KEEP_ALIVE, options: { num_ctx: CONTEXT_TOKENS } }),
    }).catch(() => undefined)
  }

  async status(model: string): Promise<BotModelStatus> {
    let installed: string[]
    try {
      const response = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2000) })
      if (!response.ok) return { state: 'not-running', model }
      const body = (await response.json()) as { models?: { name?: unknown }[] }
      installed = (body.models ?? []).map((m) => m.name).filter((name): name is string => typeof name === 'string')
    } catch {
      return { state: 'not-running', model }
    }
    return hasModel(installed, model) ? { state: 'ready', model } : { state: 'no-model', model, installed }
  }

  async *stream(messages: AiMessage[], system: string, { model, signal }: { model: string; signal: AbortSignal }): AsyncIterable<string> {
    const response = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        // Qwen 3 thinks out loud first unless told not to: for a short answer
        // from notes that is a long wait for nothing the user sees.
        think: false,
        keep_alive: KEEP_ALIVE,
        options: { num_ctx: CONTEXT_TOKENS },
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
    yield* readLines(response.body)
  }
}

/** Ollama streams one JSON object per line; each carries the next piece of the message. */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
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
      const event = JSON.parse(line) as { message?: { content?: unknown }; error?: unknown; done?: unknown }
      if (typeof event.error === 'string') throw new Error(event.error)
      const text = event.message?.content
      if (typeof text === 'string' && text !== '') yield text
      if (event.done === true) return
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

  async *stream(messages: AiMessage[], system: string, { model, signal }: { model: string; signal: AbortSignal }): AsyncIterable<string> {
    const key = this.key()
    if (key === null) throw new Error('No API key saved. Add one in Settings → AI.')
    const queue: string[] = []
    let finished = false
    let failure: string | null = null
    let wake: (() => void) | null = null
    const poke = (): void => wake?.()
    const running = new DirectProvider(key).stream(
      { model, system, messages, maxTokens: 1024 },
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
export class MockProvider implements BotModelProvider {
  warm(): void {}

  async status(model: string): Promise<BotModelStatus> {
    return { state: 'ready', model }
  }

  async *stream(_messages: AiMessage[], system: string, { signal }: { model: string; signal: AbortSignal }): AsyncIterable<string> {
    if (system.startsWith('Write a title')) {
      yield 'Soil mix'
      return
    }
    const reply = 'Your notes keep the soil mix simple: compost, loam and grit, tested for pH before planting.'
    // All at once, the way a real model's last tokens and its end arrive: the
    // case where the renderer gets the end before it has drawn the last token.
    for (const word of reply.split(/(?<= )/)) {
      if (signal.aborted) return
      yield word
    }
  }
}
