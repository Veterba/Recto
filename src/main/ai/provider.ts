import Anthropic from '@anthropic-ai/sdk'
import type { AiMessage } from '../../shared/ipc-contract'

/**
 * How the app talks to a model.
 *
 * One interface, one implementation, deliberately. `DirectProvider` sends the
 * user's own key straight to `api.anthropic.com` over TLS from the main
 * process - no relay, so no box of ours that every prompt and every quoted note
 * would have to pass through.
 *
 * The interface exists anyway, for about twenty lines' worth of cost, because
 * the one thing that would justify a relay - a hosted "no key needed" tier - is
 * a money decision rather than an architecture one, and this keeps that door
 * from needing a rewrite to walk through.
 */

export type StreamHandlers = {
  onDelta: (text: string) => void
  onDone: (info: { stopReason: string | null; inputTokens: number; outputTokens: number }) => void
  onError: (message: string) => void
}

export type StreamRequest = {
  model: string
  system: string
  messages: readonly AiMessage[]
  maxTokens: number
}

export interface AiProvider {
  stream(request: StreamRequest, handlers: StreamHandlers, signal: AbortSignal): Promise<void>
  /** A one-token round trip, to tell "the key is wrong" from "the network is". */
  test(model: string): Promise<{ ok: true } | { ok: false; error: string }>
}

/**
 * SDK errors are objects; a dialog needs a sentence.
 *
 * The status codes are worth separating because the actions differ: 401 means
 * fix the key, 429 means wait, 529 means the API is busy and retrying will
 * work. "Request failed" for all three tells the user nothing they can act on.
 */
function explain(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401) return 'That key was rejected. Check it in Settings → AI.'
    if (err.status === 403) return 'That key is not allowed to use this model.'
    if (err.status === 404) return 'That model does not exist, or your key has no access to it.'
    if (err.status === 429) return 'Rate limited by the API. Wait a moment and try again.'
    if (err.status === 400) return `The API refused the request: ${err.message}`
    if (err.status !== undefined && err.status >= 500) return 'The API is unavailable right now. Try again shortly.'
    return err.message
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError') return 'Stopped.'
    return err.message
  }
  return String(err)
}

export class DirectProvider implements AiProvider {
  private readonly client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async stream(request: StreamRequest, handlers: StreamHandlers, signal: AbortSignal): Promise<void> {
    try {
      const stream = this.client.messages.stream(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        },
        { signal },
      )

      stream.on('text', (text) => handlers.onDelta(text))

      const final = await stream.finalMessage()
      handlers.onDone({
        stopReason: final.stop_reason,
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
      })
    } catch (err) {
      // An abort is a thing the user did, not a failure - but the caller still
      // needs to know the stream ended, so it comes back through onError with
      // a sentence that says so.
      handlers.onError(explain(err))
    }
  }

  async test(model: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.client.messages.create({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: explain(err) }
    }
  }
}
