import type { AiMessage } from '../../shared/ai'
import type { QuickAskEvent } from '../../shared/quick-ask'
import { parseNote } from '../../shared/parse'
import { providerInfo, providerOf } from '../../shared/providers'
import type { BotModelProvider } from '../bots/provider'
import { ask } from '../vault-tools/read'
import { buildScope, readNote, titleOf } from '../vault-tools/scope'
import { closeSession, openSession } from '../vault-tools'
import { run } from '.'
import { quickAskSystem } from './prompts'
import { ProviderError, runCall } from './run'

/**
 * Quick ask: a question about the note open right now. It is not a chat -
 * nothing is written anywhere - and the answer may use only that note and
 * the notes it links to or that link to it; only that note may be changed,
 * as a Suggested edit. Each question gets its own session with exactly that
 * reach, so the note open when it was asked is the one it is about.
 */

export const QUICK_TOOLS = ['get_ai_guide', 'read_note', 'get_note_context', 'propose_edit', 'propose_append', 'get_proposal']

/** How much of the note and its links goes with each question. */
const CONTEXT_TOKENS = 3000

const running = new Map<string, AbortController>()

export type QuickAskRequest = { thread: string; note: string; model: string; history: AiMessage[]; question: string }

/** The note and its neighbours, as far as AI may see them; null when the note itself is excluded. */
async function reach(note: string): Promise<{ path: string; notes: Set<string> } | null> {
  const scope = buildScope('quick-ask')
  const path = scope.resolve(note)
  if (path === null) return null
  const out = parseNote(await readNote(path))
    .links.map((l) => scope.resolve(l.target, path))
    .filter((p): p is string => p !== null)
  const { links } = await ask({ kind: 'backlinks', path }, 'backlinks-result')
  return { path, notes: new Set([path, ...out, ...links.map((l) => l.path).filter((p) => !scope.hidden(p))]) }
}

export async function quickAsk(request: QuickAskRequest, local: BotModelProvider, emit: (event: QuickAskEvent) => void): Promise<void> {
  running.get(request.thread)?.abort()
  const controller = new AbortController()
  running.set(request.thread, controller)
  const reached = await reach(request.note).catch(() => null)
  if (reached === null) {
    emit({
      thread: request.thread,
      type: 'error',
      problem: { kind: 'excluded', message: `“${titleOf(request.note)}” is in a folder AI may not see (Settings → AI → Excluded), or is not a note.` },
    })
    running.delete(request.thread)
    return
  }
  const session = openSession({
    client: `quick-ask · ${providerInfo(providerOf(request.model)).name}`,
    tools: new Set(QUICK_TOOLS),
    notes: reached.notes,
    writable: new Set([reached.path]),
  })
  try {
    // The note goes with every question, so a switch of note is a switch of context.
    const context = await runCall(session, 'get_note_context', { note: reached.path, budget_tokens: CONTEXT_TOKENS })
    const question = `The open note and its links:\n\n${context}\n\n---\n\n${request.question}`
    const system = await quickAskSystem(session, titleOf(reached.path))
    for await (const event of run(
      { model: request.model, system, messages: [...request.history, { role: 'user', content: question }], session, signal: controller.signal },
      local,
    ))
      emit(event.type === 'text' ? { thread: request.thread, type: 'text', text: event.text } : { thread: request.thread, type: 'steps', steps: event.steps })
    emit({ thread: request.thread, type: controller.signal.aborted ? 'cancelled' : 'done', sources: [...session.seen] })
  } catch (err) {
    if (controller.signal.aborted) emit({ thread: request.thread, type: 'cancelled', sources: [...session.seen] })
    else
      emit({
        thread: request.thread,
        type: 'error',
        problem: err instanceof ProviderError ? err.problem : { kind: 'failed', message: err instanceof Error ? err.message : String(err) },
      })
  } finally {
    closeSession(session.id)
    if (running.get(request.thread) === controller) running.delete(request.thread)
  }
}

export function cancelQuickAsk(thread: string): void {
  running.get(thread)?.abort()
}
