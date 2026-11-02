import type { AiMessage } from '../../shared/ai'
import { USAGE_URL, type ProviderProblem } from '../../shared/providers'
import { ProviderError, toolSchema, type ToolModel } from './run'
import type { VAULT_TOOLS } from '../../shared/vault-tools'

/**
 * OpenAI's Responses API, for both ways in: an API key, and a ChatGPT plan
 * (Sign in with ChatGPT, whose access token is used the same way, with the
 * plan's rules: `store: false`, always streamed, the whole conversation sent
 * every time, no output-length cap). Both are treated by those rules, so one
 * code path serves both.
 *
 * With `store: false` nothing is kept on OpenAI's side between turns, so the
 * model's reasoning comes back encrypted and goes back in with the next turn.
 */

export const OPENAI_BASE = (): string => process.env['RECTO_OPENAI_BASE'] ?? 'https://api.openai.com/v1'

type Item = Record<string, unknown>
type State = { instructions: string; input: Item[]; tools: Item[] }

export type OpenAiAuth = {
  /** The bearer token: a key, or a fresh ChatGPT access token. */
  token: () => Promise<string>
  /** Called once when a 401 says the token is no longer good. True: try again with a new one. */
  refreshed?: () => Promise<boolean>
  plan: boolean
}

export function responsesModel(model: string, auth: OpenAiAuth, tools: typeof VAULT_TOOLS): ToolModel<State> {
  return {
    start: (system, messages: AiMessage[]) => ({
      instructions: system,
      input: messages.map((m) => ({ role: m.role, content: m.content })),
      tools: tools.map((t) => ({ type: 'function', ...toolSchema(t) })),
    }),

    async *turn(state, signal) {
      const body = JSON.stringify({
        model,
        instructions: state.instructions,
        input: state.input,
        tools: state.tools,
        store: false,
        stream: true,
        include: ['reasoning.encrypted_content'],
      })
      let response = await post(body, await auth.token(), signal)
      if (response.status === 401 && auth.refreshed !== undefined && (await auth.refreshed()))
        response = await post(body, await auth.token(), signal)
      if (!response.ok || response.body === null) throw new ProviderError(await problemOf(response, auth.plan))

      const output: Item[] = []
      for await (const event of sse(response.body)) {
        const type = event['type']
        if (type === 'response.output_text.delta' && typeof event['delta'] === 'string') yield { type: 'text', text: event['delta'] }
        else if (type === 'response.output_item.done' && typeof event['item'] === 'object' && event['item'] !== null) {
          const item = event['item'] as Item
          output.push(item)
          if (item['type'] === 'function_call')
            yield { type: 'call', id: String(item['call_id']), name: String(item['name']), args: String(item['arguments'] ?? '') }
        } else if (type === 'response.completed') {
          const tokens = ((event['response'] as Item | undefined)?.['usage'] as Item | undefined)?.['total_tokens']
          if (typeof tokens === 'number') yield { type: 'usage', tokens }
        } else if (type === 'response.failed' || type === 'error') {
          const error = ((event['response'] as Item | undefined)?.['error'] ?? event['error'] ?? event) as Item
          throw new ProviderError(problemFromCode(String(error['code'] ?? ''), String(error['message'] ?? 'The answer failed.'), auth.plan))
        } else if (type === 'response.incomplete') {
          const reason = ((event['response'] as Item | undefined)?.['incomplete_details'] as Item | undefined)?.['reason']
          yield { type: 'text', text: `\n\n(The answer was cut short${typeof reason === 'string' ? `: ${reason.replace(/_/g, ' ')}` : ''}.)` }
        }
      }
      // What the model said and asked, back into the conversation for its next turn.
      state.input.push(...output.map(withoutStatus))
    },

    answer(state, results) {
      for (const r of results) state.input.push({ type: 'function_call_output', call_id: r.id, output: r.output })
    },
  }
}

/** Output items go back as input without the server's bookkeeping: with nothing stored, an item id points at nothing. */
function withoutStatus(item: Item): Item {
  const { status: _status, id: _id, ...rest } = item
  return rest
}

function post(body: string, token: string, signal: AbortSignal): Promise<Response> {
  return fetch(`${OPENAI_BASE()}/responses`, {
    method: 'POST',
    signal,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body,
  }).catch((err: unknown) => {
    if (signal.aborted) throw err
    throw new ProviderError({ kind: 'down', message: `OpenAI could not be reached: ${err instanceof Error ? err.message : String(err)}` })
  })
}

/** Server-sent events, one JSON object per `data:` line. */
export async function* sse(body: ReadableStream<Uint8Array>): AsyncIterable<Item> {
  const decoder = new TextDecoder()
  let pending = ''
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(chunk, { stream: true })
    let end = pending.indexOf('\n\n')
    while (end !== -1) {
      const block = pending.slice(0, end)
      pending = pending.slice(end + 2)
      end = pending.indexOf('\n\n')
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n')
      if (data === '' || data === '[DONE]') continue
      try {
        yield JSON.parse(data) as Item
      } catch {
        // A line that is not JSON is not an event.
      }
    }
  }
}

/** A failed response, as something the person can act on. */
export async function problemOf(response: Response, plan: boolean): Promise<ProviderProblem> {
  let code = ''
  let message = `OpenAI answered ${response.status}.`
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown }; detail?: unknown }
    if (typeof body.error?.code === 'string') code = body.error.code
    if (typeof body.error?.message === 'string') message = body.error.message
    else if (typeof body.detail === 'string') message = body.detail
  } catch {
    // No JSON: the status is all there is.
  }
  if (code === '' && response.status === 401) return { kind: plan ? 'expired' : 'no-key', message: plan ? 'The ChatGPT sign-in is no longer accepted. Sign in again.' : 'The API key was rejected. Check it in Settings → AI.' }
  if (code === '' && response.status === 429) return plan ? limitProblem() : { kind: 'limit', message: 'Rate limited by the API. Wait a moment and try again.' }
  if (code === '' && response.status >= 500) return { kind: 'down', message: 'OpenAI is not answering right now. Try again in a moment.' }
  return problemFromCode(code, message, plan)
}

const limitProblem = (): ProviderProblem => ({
  kind: 'limit',
  message: 'Your ChatGPT plan’s usage limit for Recto is reached. Manage usage to raise it, or wait for it to reset.',
  url: USAGE_URL,
})

/** Sign in with ChatGPT's error codes (and the API's), by what the person can do. */
export function problemFromCode(code: string, message: string, plan: boolean): ProviderProblem {
  switch (code) {
    case 'subscription_sharing_usage_limit_exceeded':
      return limitProblem()
    case 'subscription_sharing_user_not_eligible':
      return { kind: 'not-eligible', message: 'This ChatGPT account or workspace cannot use its plan in other apps.' }
    case 'subscription_sharing_usage_unavailable':
    case 'subscription_sharing_user_unavailable':
      return { kind: 'down', message: 'ChatGPT plan usage is unavailable right now. Try again in a moment.' }
    case 'subscription_sharing_invalid_user':
      return { kind: 'expired', message: 'ChatGPT could not confirm this sign-in. Sign in again.' }
    case 'insufficient_quota':
    case 'rate_limit_exceeded':
      return { kind: 'limit', message }
    case 'invalid_api_key':
      return { kind: 'no-key', message: 'The API key was rejected. Check it in Settings → AI.' }
    default:
      return { kind: plan && code.startsWith('chatpass') ? 'not-eligible' : 'failed', message }
  }
}
