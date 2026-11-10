import { sourcesOf, type RecordedMessage } from '../../shared/answer-record'
import type { QuickAskEvent } from '../../shared/quick-ask'
import { parseNote } from '../../shared/parse'
import { providerInfo, providerOf } from '../../shared/providers'
import type { BotModelProvider } from '../bots/provider'
import { ask } from '../vault-tools/read'
import { buildScope, readNote, titleOf } from '../vault-tools/scope'
import { closeSession, openSession, recordOf, type ToolSession } from '../vault-tools'
import type { AnswerRecord } from '../../shared/answer-record'
import { proposal } from '../vault-tools/proposals'
import { run } from '.'
import { canvasContext, canvasTitle } from '../vault-tools/canvas-context'
import { forCloud, quickAskCanvasSystem, quickAskSystem } from './prompts'
import type { AiMessage } from '../../shared/ai'
import { ProviderError, runCall } from './run'

/**
 * Quick ask: a question about the note open right now. It is not a chat -
 * nothing is written anywhere - and the answer may use only that note and
 * the notes it links to or that link to it; only that note may be changed,
 * as a Suggested edit. Each question gets its own session with exactly that
 * reach, so the note open when it was asked is the one it is about.
 */

export const QUICK_TOOLS = ['get_ai_guide', 'read_note', 'read_file', 'get_note_context', 'propose_edit', 'propose_append', 'get_proposal']
/**
 * On a canvas: read the notes and files on it, and suggest changes to the canvas itself - cards, arrows,
 * groups, moves - shown on it as ghosts to accept or reject. Notes stay unchanged from here.
 */
export const QUICK_CANVAS_TOOLS = [
  'get_ai_guide',
  'read_note',
  'read_file',
  'get_note_context',
  'canvas_read',
  'canvas_propose_nodes',
  'canvas_propose_edges',
  'canvas_propose_group',
  'canvas_propose_layout',
  'get_proposal',
]

/** How much of the note and its links goes with each question. */
const CONTEXT_TOKENS = 3000

const running = new Map<string, AbortController>()

/** What an ended answer carries: its record, and the sources that follow from it. */
const ended = (session: ToolSession): { sources: string[]; record: AnswerRecord } => {
  const record = recordOf(session)
  return { sources: sourcesOf(record), record }
}

/**
 * `note`: the open note, or the open canvas; `selection`: the canvas's selected node ids (none: the whole canvas);
 * `today`: the day the answer takes as today, YYYY-MM-DD - the eval's fixture day; this Mac's when left out.
 */
export type QuickAskRequest = {
  thread: string
  note: string
  model: string
  history: RecordedMessage[]
  question: string
  selection?: string[]
  today?: string
}

/**
 * The conversation with the question last (`asked`: as sent), as the chats send theirs: an earlier
 * answer that used a note excluded since is withheld, each other one goes with its record.
 */
const conversationOf = (request: QuickAskRequest, asked: string): AiMessage[] =>
  forCloud([...request.history, { role: 'user', content: asked }], buildScope('quick-ask').settings.excluded, (id) => proposal(id)?.status ?? null)

/** The note and its neighbours, as far as AI may see them; null when the note itself is excluded. */
async function reach(note: string): Promise<{ path: string; notes: Set<string> } | null> {
  const scope = buildScope('quick-ask')
  const path = scope.resolve(note)
  if (path === null) return null
  // The notes it links to, and the files it links or embeds - a PDF, a picture: read_file reads those.
  const out = parseNote(await readNote(path))
    .links.map((l) => scope.resolve(l.target, path) ?? scope.resolveFile(l.target, path))
    .filter((p): p is string => p !== null)
  const { links } = await ask({ kind: 'backlinks', path }, 'backlinks-result')
  return { path, notes: new Set([path, ...out, ...links.map((l) => l.path).filter((p) => !scope.hidden(p))]) }
}

export async function quickAsk(request: QuickAskRequest, local: BotModelProvider, emit: (event: QuickAskEvent) => void): Promise<void> {
  running.get(request.thread)?.abort()
  const controller = new AbortController()
  running.set(request.thread, controller)
  if (request.note.toLowerCase().endsWith('.canvas')) return askAboutCanvas(request, local, emit, controller)
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
    cloud: providerOf(request.model) !== 'ollama',
  })
  try {
    // The note goes with every question, so a switch of note is a switch of context.
    const context = await runCall(session, 'get_note_context', { note: reached.path, budget_tokens: CONTEXT_TOKENS })
    const question = `The open note and its links:\n\n${context}\n\n---\n\n${request.question}`
    const system = await quickAskSystem(session, titleOf(reached.path), request.today)
    for await (const event of run(
      { model: request.model, system, messages: conversationOf(request, question), session, signal: controller.signal },
      local,
    ))
      emit(event.type === 'text' ? { thread: request.thread, type: 'text', text: event.text } : { thread: request.thread, type: 'steps', steps: event.steps })
    emit({ thread: request.thread, type: controller.signal.aborted ? 'cancelled' : 'done', ...ended(session) })
  } catch (err) {
    if (controller.signal.aborted) emit({ thread: request.thread, type: 'cancelled', ...ended(session) })
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

/** Quick ask on a canvas: its selection (or all of it) goes with each question; only the notes on it can be read. */
async function askAboutCanvas(
  request: QuickAskRequest,
  local: BotModelProvider,
  emit: (event: QuickAskEvent) => void,
  controller: AbortController,
): Promise<void> {
  const scope = buildScope('quick-ask')
  const context = await canvasContext(scope, request.note, request.selection ?? [], CONTEXT_TOKENS).catch(() => null)
  if (context === null) {
    emit({
      thread: request.thread,
      type: 'error',
      problem: { kind: 'excluded', message: `“${canvasTitle(request.note)}” is in a folder AI may not see (Settings → AI → Excluded), or could not be read.` },
    })
    running.delete(request.thread)
    return
  }
  const session = openSession({
    client: `quick-ask · ${providerInfo(providerOf(request.model)).name}`,
    tools: new Set(QUICK_CANVAS_TOOLS),
    // It may read the canvas itself too, and suggest changes to it - only to it.
    notes: new Set([...context.notes, request.note]),
    writable: new Set([request.note]),
    cloud: providerOf(request.model) !== 'ollama',
  })
  try {
    const question = `${context.text}\n\n---\n\n${request.question}`
    const system = await quickAskCanvasSystem(session, canvasTitle(request.note), request.today)
    for await (const event of run(
      { model: request.model, system, messages: conversationOf(request, question), session, signal: controller.signal },
      local,
    ))
      emit(event.type === 'text' ? { thread: request.thread, type: 'text', text: event.text } : { thread: request.thread, type: 'steps', steps: event.steps })
    emit({ thread: request.thread, type: controller.signal.aborted ? 'cancelled' : 'done', ...ended(session) })
  } catch (err) {
    if (controller.signal.aborted) emit({ thread: request.thread, type: 'cancelled', ...ended(session) })
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

/** Every answer still running: the vault is switched or closed, and they belong to the one going. */
export function cancelAllQuickAsk(): void {
  for (const controller of running.values()) controller.abort()
}
