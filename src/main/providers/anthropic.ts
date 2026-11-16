import { providerBase } from '../config'
import Anthropic from '@anthropic-ai/sdk'
import { currentAiModel, MAX_ANSWER_TOKENS, type AiMessage } from '../../shared/ai'
import type { ProviderProblem } from '../../shared/providers'
import type { VAULT_TOOLS } from '../../shared/vault-tools'
import { ProviderError, sourcesList, toolSchema, type ToolModel } from './run'

/**
 * Anthropic's Messages API with tools, on the saved key: Recto's loop drives it (run.ts).
 * With the web (`web`), Anthropic's own web search and web fetch go beside Recto's tools: they run on
 * Anthropic's side, within a turn, and the pages an answer cites are listed under it.
 */

type State = {
  system: string
  messages: Anthropic.MessageParam[]
  tools: Anthropic.ToolUnion[]
  /** The pages cited so far, by address, and the answer's text so far: the ones not linked in it are listed at its end. */
  cited: Map<string, string>
  said: string
}

/** Searches and page reads one answer may make. */
const WEB_USES = 5
/** A turn Anthropic paused in the middle of a long search goes on, this many times at most. */
const RESUMES = 3

export function messagesModel(model: string, key: string, tools: typeof VAULT_TOOLS, web = false): ToolModel<State> {
  const base = providerBase('RECTO_ANTHROPIC_BASE')
  const client = new Anthropic({ apiKey: key, ...(base === undefined ? {} : { baseURL: base }) })
  return {
    start: (system, messages: AiMessage[]) => ({
      system,
      // A person's pictures go after their words, where Claude looks at them.
      messages: messages.map((m) =>
        m.images === undefined || m.images.length === 0
          ? { role: m.role, content: m.content }
          : { role: m.role, content: [{ type: 'text' as const, text: m.content }, ...m.images.map(imageBlock)] },
      ),
      tools: [
        ...tools.map((t): Anthropic.Tool => {
          const s = toolSchema(t)
          return { name: s.name, description: s.description, input_schema: s.parameters as Anthropic.Tool.InputSchema }
        }),
        ...(web
          ? [
              { type: 'web_search_20250305', name: 'web_search', max_uses: WEB_USES } as const,
              { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: WEB_USES } as const,
            ]
          : []),
      ],
      cited: new Map(),
      said: '',
    }),

    async *turn(state, signal) {
      try {
        for (let resumed = 0; ; resumed++) {
          const stream = client.messages.stream(
            { model: currentAiModel(model), max_tokens: MAX_ANSWER_TOKENS, system: state.system, messages: state.messages, tools: state.tools },
            { signal },
          )
          for await (const event of stream)
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              state.said += event.delta.text
              yield { type: 'text', text: event.delta.text }
            }
          const final = await stream.finalMessage()
          yield { type: 'usage', tokens: final.usage.input_tokens + final.usage.output_tokens }
          // At the length limit the answer just stops: said, as the OpenAI loop says it, and a tool call
          // cut off in the middle is not made with half its arguments.
          if (final.stop_reason === 'max_tokens') {
            yield { type: 'text', text: '\n\n(The answer was cut short: it reached the length limit.)' }
            return
          }
          // Its content goes back whole: a search's results come back encrypted and must be returned as they came.
          state.messages.push({ role: 'assistant', content: final.content })
          for (const block of final.content)
            if (block.type === 'text') for (const c of block.citations ?? []) if ('url' in c && typeof c.url === 'string') state.cited.set(c.url, c.title ?? c.url)
          // Paused in a long search: asked to go on, as it is.
          if (final.stop_reason === 'pause_turn' && resumed < RESUMES) continue
          const calls = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
          for (const block of calls) yield { type: 'call', id: block.id, name: block.name, args: JSON.stringify(block.input ?? {}) }
          // The answer's end: the pages it drew on that it did not link itself.
          if (calls.length === 0) {
            const unlinked = [...state.cited].filter(([url]) => !state.said.includes(url))
            if (unlinked.length > 0) yield { type: 'text', text: sourcesList(unlinked) }
          }
          return
        }
      } catch (err) {
        if (signal.aborted) throw err
        throw new ProviderError(problemOf(err))
      }
    },

    answer(state, results) {
      state.messages.push({
        role: 'user',
        // A picture a tool returned goes in its result, where Claude looks at it.
        content: results.map((r) => ({
          type: 'tool_result' as const,
          tool_use_id: r.id,
          content: [
            { type: 'text' as const, text: r.output },
            ...r.images.map(imageBlock),
          ],
        })),
      })
    },
  }
}

const imageBlock = (i: { mime: string; data: string }): Anthropic.ImageBlockParam => ({
  type: 'image',
  source: { type: 'base64', media_type: i.mime as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: i.data },
})

function problemOf(err: unknown): ProviderProblem {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401) return { kind: 'no-key', message: 'The Anthropic key was rejected. Check it in Settings → AI.' }
    if (err.status === 429) return { kind: 'limit', message: 'Rate limited by the Anthropic API. Wait a moment and try again.' }
    if (err.status !== undefined && err.status >= 500) return { kind: 'down', message: 'The Anthropic API is not answering right now. Try again shortly.' }
    // The API's own sentence, not the SDK's "404 {"type":"error",…}".
    const said = (err.error as { error?: { message?: unknown } } | undefined)?.error?.message
    const reason = typeof said === 'string' && said !== '' ? said : 'no reason given'
    if (err.status === 403) return { kind: 'failed', message: `The Anthropic key may not do this: ${reason}` }
    if (err.status === 404) return { kind: 'failed', message: `The Anthropic API does not know this model: ${reason}` }
    return { kind: 'failed', message: `The Anthropic API refused the request: ${reason}` }
  }
  if (err instanceof Anthropic.APIConnectionError) return { kind: 'down', message: 'The Anthropic API could not be reached.' }
  return { kind: 'failed', message: err instanceof Error ? err.message : String(err) }
}
