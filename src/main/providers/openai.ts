import { providerBase } from '../config'
import type { AiMessage } from '../../shared/ai'
import { USAGE_URL, type ProviderProblem } from '../../shared/providers'
import { logProvider } from './log'
import { ProviderError, sourcesList, toolSchema, type ToolModel } from './run'
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

export const OPENAI_BASE = (): string => providerBase('RECTO_OPENAI_BASE') ?? 'https://api.openai.com/v1'

type Item = Record<string, unknown>
type State = {
  instructions: string
  input: Item[]
  tools: Item[]
  /** The pages cited so far, by address, and the answer's text so far: the ones not linked in it are listed at its end. */
  cited: Map<string, string>
  said: string
}

export type OpenAiAuth = {
  /** The bearer token: a key, or a fresh ChatGPT access token. */
  token: () => Promise<string>
  /** Called once when a 401 says the token is no longer good. True: try again with a new one. */
  refreshed?: () => Promise<boolean>
  plan: boolean
}

/** With the web (`web`), OpenAI's own web search goes beside Recto's tools: it runs on OpenAI's side, within a turn. */
export function responsesModel(model: string, auth: OpenAiAuth, tools: typeof VAULT_TOOLS, web = false): ToolModel<State> {
  return {
    start: (system, messages: AiMessage[]) => ({
      instructions: system,
      // A person's pictures go after their words, as the input's images.
      input: messages.map((m) =>
        m.images === undefined || m.images.length === 0
          ? { role: m.role, content: m.content }
          : {
              role: m.role,
              content: [{ type: 'input_text', text: m.content }, ...m.images.map((i) => ({ type: 'input_image', image_url: `data:${i.mime};base64,${i.data}` }))],
            },
      ),
      tools: [...tools.map((t) => ({ type: 'function', ...toolSchema(t) })), ...(web ? [{ type: 'web_search' }] : [])],
      cited: new Map(),
      said: '',
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
      logProvider(`${auth.plan ? 'chatgpt' : 'openai'} responses ${model}: ${response.status} request ${response.headers.get('x-request-id') ?? '-'}`)
      // A 401 is first taken for a stale token: refreshed once, and asked again. A token too fresh to refresh,
      // or one just refreshed, turned down again: the account is refused, not the sign-in old.
      let fresh = false
      if (response.status === 401 && auth.refreshed !== undefined) {
        fresh = true
        if (await auth.refreshed()) {
          response = await post(body, await auth.token(), signal)
          logProvider(`chatgpt responses ${model} again: ${response.status} request ${response.headers.get('x-request-id') ?? '-'}`)
        }
      }
      const retried = fresh
      if (!response.ok || response.body === null) throw new ProviderError(await problemOf(response, auth.plan, retried))

      const output: Item[] = []
      // Done only once OpenAI says so: a stream that just ends was cut off, and its text is not an answer.
      let finished = false
      for await (const event of events(response.body, signal)) {
        const type = event['type']
        if (type === 'response.output_text.delta' && typeof event['delta'] === 'string') {
          state.said += event['delta']
          yield { type: 'text', text: event['delta'] }
        }
        else if (type === 'response.output_item.done' && typeof event['item'] === 'object' && event['item'] !== null) {
          const item = event['item'] as Item
          output.push(item)
          // The pages a message cites (`url_citation` on its text).
          if (item['type'] === 'message' && Array.isArray(item['content']))
            for (const part of item['content'] as Item[])
              for (const a of Array.isArray(part['annotations']) ? (part['annotations'] as Item[]) : [])
                if (a['type'] === 'url_citation' && typeof a['url'] === 'string') state.cited.set(a['url'], typeof a['title'] === 'string' ? a['title'] : a['url'])
          if (item['type'] === 'function_call')
            yield { type: 'call', id: String(item['call_id']), name: String(item['name']), args: String(item['arguments'] ?? '') }
        } else if (type === 'response.completed') {
          finished = true
          const tokens = ((event['response'] as Item | undefined)?.['usage'] as Item | undefined)?.['total_tokens']
          if (typeof tokens === 'number') yield { type: 'usage', tokens }
        } else if (type === 'response.failed' || type === 'error') {
          const error = ((event['response'] as Item | undefined)?.['error'] ?? event['error'] ?? event) as Item
          const code = String(error['code'] ?? '')
          const id = (event['response'] as Item | undefined)?.['id']
          const problem = problemFromCode(code, String(error['message'] ?? 'The answer failed.'), auth.plan)
          throw new ProviderError(withReference(problem, code, typeof id === 'string' ? id : null))
        } else if (type === 'response.incomplete') {
          finished = true
          const reason = ((event['response'] as Item | undefined)?.['incomplete_details'] as Item | undefined)?.['reason']
          yield { type: 'text', text: `\n\n(The answer was cut short${typeof reason === 'string' ? `: ${reason.replace(/_/g, ' ')}` : ''}.)` }
        }
      }
      if (!finished) throw new ProviderError({ kind: 'down', message: 'The connection to OpenAI dropped before the answer was finished. Try again.' })
      // What the model said and asked, back into the conversation for its next turn.
      state.input.push(...output.map(withoutStatus))
      // The answer's end: the pages it drew on that it did not link itself.
      if (!output.some((i) => i['type'] === 'function_call')) {
        const unlinked = [...state.cited].filter(([url]) => !state.said.includes(url))
        if (unlinked.length > 0) yield { type: 'text', text: sourcesList(unlinked) }
      }
    },

    answer(state, results) {
      for (const r of results) state.input.push({ type: 'function_call_output', call_id: r.id, output: r.output })
      // A function's output is text: the pictures it returned follow as a message the model looks at.
      const images = results.flatMap((r) => r.images)
      if (images.length > 0)
        state.input.push({
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: `The pictures ${[...new Set(results.filter((r) => r.images.length > 0).map((r) => r.name))].join(' and ')} returned:` },
            ...images.map((i) => ({ type: 'input_image', image_url: `data:${i.mime};base64,${i.data}` })),
          ],
        })
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

/** The stream's events; the connection failing under it is OpenAI not answering, not a raw network error. */
async function* events(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<Item> {
  try {
    yield* sse(body)
  } catch (err) {
    if (signal.aborted || err instanceof ProviderError) throw err
    throw new ProviderError({ kind: 'down', message: 'The connection to OpenAI dropped before the answer was finished. Try again.' })
  }
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

/**
 * OpenAI's own code and the request's id, after the message: what OpenAI's
 * "Errors and recovery" asks to keep, and the only way to tell one refusal
 * from another when something goes wrong for one account and not another.
 */
function withReference(problem: ProviderProblem, code: string, requestId: string | null): ProviderProblem {
  const parts = [code, requestId === null ? '' : `request ${requestId}`].filter((p) => p !== '')
  if (parts.length > 0) logProvider(`refused: ${parts.join(', ')} - ${problem.kind}: ${problem.message}`)
  return parts.length === 0 ? problem : { ...problem, message: `${problem.message} (OpenAI: ${parts.join(', ')})` }
}

/**
 * A failed response, as something the person can act on. `retried`: it is the
 * answer to a request made again with a fresh token - a 401 then is not a
 * stale sign-in, and signing in again would only loop.
 */
export async function problemOf(response: Response, plan: boolean, retried = false): Promise<ProviderProblem> {
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
  const reference = (problem: ProviderProblem): ProviderProblem => withReference(problem, code === '' ? `HTTP ${response.status}` : code, response.headers.get('x-request-id'))
  if (code === '' && response.status === 401) {
    if (!plan) return reference({ kind: 'no-key', message: 'The API key was rejected. Check it in Settings → AI.' })
    return reference(
      retried
        ? { kind: 'not-eligible', message: 'OpenAI turned this ChatGPT account down for Recto, even with a fresh sign-in. Signing in again will not help: its plan may not be open to other apps.' }
        : { kind: 'expired', message: 'The ChatGPT sign-in is no longer accepted. Sign in again.' },
    )
  }
  if (code === '' && response.status === 429) return reference(plan ? limitProblem() : { kind: 'limit', message: 'Rate limited by the API. Wait a moment and try again.' })
  if (code === '' && response.status >= 500) return reference({ kind: 'down', message: 'OpenAI is not answering right now. Try again in a moment.' })
  return reference(problemFromCode(code, message, plan))
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
      // Not a stale sign-in (OpenAI: "diagnose the credential failure"; sign in again only after a confirmed revocation).
      return { kind: 'not-eligible', message: 'ChatGPT could not confirm that this account’s plan can be used in Recto. Signing in again will not change that.' }
    case 'subscription_sharing_unsupported_capability':
      return { kind: 'failed', message: `ChatGPT plan usage does not support part of what Recto asked for: ${message}` }
    case 'insufficient_quota':
    case 'rate_limit_exceeded':
      return { kind: 'limit', message }
    case 'invalid_api_key':
      return { kind: 'no-key', message: 'The API key was rejected. Check it in Settings → AI.' }
    default:
      return { kind: plan && code.startsWith('chatpass') ? 'not-eligible' : 'failed', message }
  }
}
