import * as z from 'zod'
import type { AiMessage } from '../../shared/ai'
import type { BotStep, StepKind } from '../../shared/bots'
import type { ProviderLimits, ProviderProblem } from '../../shared/providers'
import { renderBlocks, VAULT_TOOLS } from '../../shared/vault-tools'
import { callTool, type ToolSession } from '../vault-tools'
import type { SessionCall } from '../vault-tools/sessions'

/**
 * One answer from a provider, the same shape whoever gives it: text as it
 * comes, and the steps the tools took. The tools are Recto's own (the MCP
 * catalogue), reached in this process through a session - which also keeps
 * what the answer read (its sources) and words each call as a step.
 */

export type RunEvent =
  | { type: 'text'; text: string }
  | { type: 'steps'; steps: BotStep[] }
  /** Tokens a model call used, and a plan's limits as the provider reported them: kept by index.ts, not shown in the answer. */
  | { type: 'usage'; tokens: number }
  | { type: 'limits'; limits: ProviderLimits }

export type RunRequest = {
  /** The provider's model string (shared/providers.ts). */
  model: string
  system: string
  /** The conversation, the question last. */
  messages: AiMessage[]
  session: ToolSession
  signal: AbortSignal
}

export type Runner = (request: RunRequest) => AsyncIterable<RunEvent>

/** A provider failing in a way the person can do something about. */
export class ProviderError extends Error {
  constructor(readonly problem: ProviderProblem) {
    super(problem.message)
  }
}

/** The tools a session may call. */
export const toolsOf = (session: ToolSession): typeof VAULT_TOOLS =>
  VAULT_TOOLS.filter((t) => session.tools === null || session.tools.has(t.name))

/** A tool as JSON Schema, for providers that take function definitions. */
export function toolSchema(def: (typeof VAULT_TOOLS)[number]): { name: string; description: string; parameters: Record<string, unknown> } {
  const schema = z.toJSONSchema(def.input, { target: 'draft-7', io: 'input' }) as Record<string, unknown>
  delete schema['$schema']
  return { name: def.name, description: def.description, parameters: schema }
}

/** A call made by a model, run through the session; what the model reads back. */
export async function runCall(session: ToolSession, name: string, args: unknown): Promise<string> {
  const outcome = await callTool(name, args, session.client, session.id)
  return outcome.ok ? renderBlocks(outcome.blocks).join('\n\n') : `Error: ${outcome.error}`
}

const STEP: Record<string, { action: string; kind?: StepKind; arg?: string }> = {
  get_ai_guide: { action: 'Reading the AI guide' },
  get_vault_profile: { action: 'Looking at how the vault is organised', kind: 'map' },
  search_notes: { action: 'Searching notes', kind: 'search', arg: 'query' },
  read_note: { action: 'Opened', kind: 'open', arg: 'note' },
  read_file: { action: 'Opened', kind: 'open', arg: 'file' },
  get_note_context: { action: 'Read around', kind: 'read', arg: 'note' },
  list_folder: { action: 'Listed', kind: 'map', arg: 'folder' },
  recent_notes: { action: 'Recent notes', kind: 'map' },
  list_tags: { action: 'Tags', kind: 'map' },
  get_periodic_note: { action: 'Periodic note', kind: 'period', arg: 'period' },
  list_boards: { action: 'Boards', kind: 'tasks' },
  read_board: { action: 'Read board', kind: 'tasks', arg: 'board' },
  list_tasks: { action: 'Tasks', kind: 'tasks' },
  get_proposal: { action: 'Checked a suggestion' },
  propose_new_note: { action: 'Suggested a new note', arg: 'name' },
  propose_edit: { action: 'Suggested an edit', arg: 'note' },
  propose_append: { action: 'Suggested an addition', arg: 'note' },
  propose_link: { action: 'Suggested a link', arg: 'from' },
  propose_task: { action: 'Suggested a task', arg: 'title' },
  propose_task_update: { action: 'Suggested a task change', arg: 'card' },
}

/** A call as the steps card shows it. */
export function stepOf(call: SessionCall): BotStep {
  const known = STEP[call.tool] ?? { action: call.tool }
  const value = known.arg === undefined ? undefined : call.args[known.arg]
  const subject = typeof value === 'string' ? value.replace(/\.md$/i, '').slice(0, 80) : undefined
  const result =
    call.phase === 'start' ? (subject === undefined ? '' : `“${subject}”`) : call.ok === false ? (call.error ?? 'failed') : subject === undefined ? 'done' : `“${subject}”`
  return {
    action: known.action,
    result,
    state: call.phase === 'start' ? 'running' : call.ok === false ? 'failed' : 'done',
    ...(known.kind === undefined ? {} : { kind: known.kind }),
    ...(subject === undefined ? {} : { subject }),
  }
}

/**
 * Events from two sides merged into one stream: the provider's text, pulled
 * by the run, and the tool layer's calls, which arrive whenever a call
 * starts or ends (from this process or from a CLI over the socket).
 */
export class Channel<T> {
  private readonly items: T[] = []
  private wake: (() => void) | null = null
  private ended = false
  private failure: unknown = null

  push(item: T): void {
    this.items.push(item)
    this.wake?.()
  }

  end(failure: unknown = null): void {
    this.ended = true
    this.failure = failure
    this.wake?.()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      const next = this.items.shift()
      if (next !== undefined) {
        yield next
        continue
      }
      if (this.ended) {
        if (this.failure !== null) throw this.failure
        return
      }
      await new Promise<void>((resolve) => (this.wake = resolve))
      this.wake = null
    }
  }
}

/** A run's events with its steps merged in, as the calls start and end. */
export function withSteps(runner: Runner, request: RunRequest): AsyncIterable<RunEvent> {
  const channel = new Channel<RunEvent>()
  const steps = new Map<number, BotStep>()
  const previous = request.session.onCall
  request.session.onCall = (call) => {
    previous?.(call)
    steps.set(call.n, stepOf(call))
    channel.push({ type: 'steps', steps: [...steps.values()] })
  }
  void (async () => {
    try {
      for await (const event of runner(request)) channel.push(event)
      channel.end()
    } catch (err) {
      channel.end(err)
    }
  })()
  return channel
}

/** A model that can be driven turn by turn with tools: OpenAI's Responses, Anthropic's Messages, Ollama's chat. */
export interface ToolModel<State> {
  start(system: string, messages: AiMessage[]): State
  /** One model call: text as it comes, then the calls it wants (each with the provider's own id). */
  turn(
    state: State,
    signal: AbortSignal,
  ): AsyncIterable<{ type: 'text'; text: string } | { type: 'usage'; tokens: number } | { type: 'call'; id: string; name: string; args: string }>
  /** The calls' outputs, back into the conversation. */
  answer(state: State, results: { id: string; name: string; args: string; output: string }[]): void
}

/** How many model turns one answer may take before it must answer with what it has. */
export const MAX_TURNS = 12

/** Recto's loop: ask, run the calls the model asks for, give it the results, until it answers. */
export async function* toolLoop<S>(model: ToolModel<S>, request: RunRequest): AsyncIterable<RunEvent> {
  const state = model.start(request.system, request.messages)
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const calls: { id: string; name: string; args: string }[] = []
    for await (const event of model.turn(state, request.signal)) {
      if (event.type === 'call') calls.push(event)
      else yield event
    }
    if (calls.length === 0 || request.signal.aborted) return
    const results = []
    for (const call of calls) {
      let parsed: unknown = {}
      try {
        parsed = call.args.trim() === '' ? {} : JSON.parse(call.args)
      } catch {
        parsed = null
      }
      const output = parsed === null ? 'Error: the arguments were not valid JSON.' : await runCall(request.session, call.name, parsed)
      results.push({ ...call, output })
    }
    model.answer(state, results)
  }
  yield { type: 'text', text: '\n\n(Stopped after too many steps. Ask again more narrowly.)' }
}
