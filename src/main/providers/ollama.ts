import type { AiMessage } from '../../shared/ai'
import { NOT_SEEN, type VAULT_TOOLS } from '../../shared/vault-tools'
import type { BotModelProvider, ChatTurn, ToolSpec } from '../bots/provider'
import { toolSchema, type ToolModel } from './run'

/**
 * Ollama driven by Recto's loop with Recto's tools: Quick ask on this Mac.
 * (The panel's chat on Ollama keeps the bots' own pipeline - router, search,
 * scope tools - which a small local model needs; Quick ask is narrow enough
 * - one note and its links - for plain tool calls.)
 */

/** `sees`: the model looks at pictures (asked of Ollama at the first turn). */
type State = { system: string; turns: ChatTurn[]; tools: ToolSpec[]; sees?: boolean }

export function ollamaModel(model: string, provider: BotModelProvider, tools: typeof VAULT_TOOLS): ToolModel<State> {
  let next = 0
  return {
    start: (system, messages: AiMessage[]) => ({
      system,
      turns: [...messages],
      tools: tools.map((t) => {
        const s = toolSchema(t)
        return { type: 'function', function: { name: s.name, description: s.description, parameters: s.parameters as ToolSpec['function']['parameters'] } }
      }),
    }),

    async *turn(state, signal) {
      state.sees ??= (await provider.canSee?.(model)) === true
      // Without tool calls (the snapshot run's stand-in), it answers from the note's text it was given.
      if (provider.streamChat === undefined) {
        const plain = state.turns.filter((t): t is AiMessage => (t.role === 'user' || t.role === 'assistant') && !('tool_calls' in t))
        for await (const text of provider.stream(plain, state.system, { model, signal })) yield { type: 'text', text }
        return
      }
      let text = ''
      const calls: { function: { name: string; arguments: Record<string, unknown> } }[] = []
      for await (const event of provider.streamChat(state.turns, state.system, state.tools, { model, signal })) {
        if (event.type === 'text') {
          text += event.text
          yield event
        } else
          for (const call of event.calls) {
            calls.push({ function: { name: call.name, arguments: call.args } })
            yield { type: 'call', id: String(next++), name: call.name, args: JSON.stringify(call.args) }
          }
      }
      state.turns.push(calls.length > 0 ? { role: 'assistant', content: text, tool_calls: calls } : { role: 'assistant', content: text })
    },

    answer(state, results) {
      // A tool's pictures: to a model that sees, in a turn of their own after the results (Ollama takes pictures on
      // a message); to one that does not, a line saying they were not sent - the answer's text speaks of them.
      for (const r of results)
        state.turns.push({ role: 'tool', content: r.images.length > 0 && state.sees !== true ? `${r.output}\n\n${NOT_SEEN}` : r.output, tool_name: r.name })
      const images = results.flatMap((r) => r.images)
      if (images.length > 0 && state.sees === true) state.turns.push({ role: 'user', content: 'The pictures the tools returned:', images })
    },
  }
}
