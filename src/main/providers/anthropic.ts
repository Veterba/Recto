import Anthropic from '@anthropic-ai/sdk'
import { currentAiModel, type AiMessage } from '../../shared/ai'
import type { ProviderProblem } from '../../shared/providers'
import type { VAULT_TOOLS } from '../../shared/vault-tools'
import { ProviderError, toolSchema, type ToolModel } from './run'

/** Anthropic's Messages API with tools, on the saved key: Recto's loop drives it (run.ts). */

type State = { system: string; messages: Anthropic.MessageParam[]; tools: Anthropic.Tool[] }

const MAX_TOKENS = 4096

export function messagesModel(model: string, key: string, tools: typeof VAULT_TOOLS): ToolModel<State> {
  const client = new Anthropic({ apiKey: key, ...(process.env['RECTO_ANTHROPIC_BASE'] ? { baseURL: process.env['RECTO_ANTHROPIC_BASE'] } : {}) })
  return {
    start: (system, messages: AiMessage[]) => ({
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      tools: tools.map((t) => {
        const s = toolSchema(t)
        return { name: s.name, description: s.description, input_schema: s.parameters as Anthropic.Tool.InputSchema }
      }),
    }),

    async *turn(state, signal) {
      try {
        const stream = client.messages.stream(
          { model: currentAiModel(model), max_tokens: MAX_TOKENS, system: state.system, messages: state.messages, tools: state.tools },
          { signal },
        )
        for await (const event of stream)
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield { type: 'text', text: event.delta.text }
        const final = await stream.finalMessage()
        yield { type: 'usage', tokens: final.usage.input_tokens + final.usage.output_tokens }
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
        content: results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.output })),
      })
    },
  }
}

function problemOf(err: unknown): ProviderProblem {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401) return { kind: 'no-key', message: 'The Anthropic key was rejected. Check it in Settings → AI.' }
    if (err.status === 429) return { kind: 'limit', message: 'Rate limited by the Anthropic API. Wait a moment and try again.' }
    if (err.status !== undefined && err.status >= 500) return { kind: 'down', message: 'The Anthropic API is not answering right now. Try again shortly.' }
    return { kind: 'failed', message: err.message }
  }
  if (err instanceof Anthropic.APIConnectionError) return { kind: 'down', message: 'The Anthropic API could not be reached.' }
  return { kind: 'failed', message: err instanceof Error ? err.message : String(err) }
}
