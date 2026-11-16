import { providerBase } from '../config'
import Anthropic from '@anthropic-ai/sdk'
import { currentAiModel, MAX_ANSWER_TOKENS, type AiMessage } from '../../shared/ai'
import type { ProviderProblem } from '../../shared/providers'
import type { VAULT_TOOLS } from '../../shared/vault-tools'
import { ProviderError, toolSchema, type ToolModel } from './run'

/** Anthropic's Messages API with tools, on the saved key: Recto's loop drives it (run.ts). */

type State = { system: string; messages: Anthropic.MessageParam[]; tools: Anthropic.Tool[] }

export function messagesModel(model: string, key: string, tools: typeof VAULT_TOOLS): ToolModel<State> {
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
      tools: tools.map((t) => {
        const s = toolSchema(t)
        return { name: s.name, description: s.description, input_schema: s.parameters as Anthropic.Tool.InputSchema }
      }),
    }),

    async *turn(state, signal) {
      try {
        const stream = client.messages.stream(
          { model: currentAiModel(model), max_tokens: MAX_ANSWER_TOKENS, system: state.system, messages: state.messages, tools: state.tools },
          { signal },
        )
        for await (const event of stream)
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield { type: 'text', text: event.delta.text }
        const final = await stream.finalMessage()
        yield { type: 'usage', tokens: final.usage.input_tokens + final.usage.output_tokens }
        // At the length limit the answer just stops: said, as the OpenAI loop says it, and a tool call
        // cut off in the middle is not made with half its arguments.
        if (final.stop_reason === 'max_tokens') {
          yield { type: 'text', text: '\n\n(The answer was cut short: it reached the length limit.)' }
          return
        }
        state.messages.push({ role: 'assistant', content: final.content })
        for (const block of final.content)
          if (block.type === 'tool_use') yield { type: 'call', id: block.id, name: block.name, args: JSON.stringify(block.input ?? {}) }
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
