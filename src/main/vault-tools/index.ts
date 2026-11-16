import os from 'node:os'
import { toolNamed, type ResultBlock, type ToolOutcome } from '../../shared/vault-tools'
import { readAnyFile } from './files'
import * as canvas from './canvas-tools'
import { AI_ACCESS_STATE, coerceAiAccess, type ActivityEntry } from '../../shared/ai-access'
import { readState } from '../state'
import { currentVault } from '../vault'
import { logCall, summariseArgs } from './activity'
import { applyNow, discard, proposal, queue } from './proposals'
import * as read from './read'
import { vaultProfile } from './profile'
import { buildScope, ToolError, type Scope } from './scope'
import { sessionNamed, type ToolSession } from './sessions'
import * as write from './write'
import { unifiedDiff } from '../../shared/line-diff'

/**
 * Recto's one tool layer: every AI client's call comes here - over the MCP
 * socket today, from Recto's own providers later. A call is validated against
 * the catalogue's schema (shared/vault-tools.ts), run in a fresh scope (the
 * vault, its AI settings, what may be seen), logged without note text, and
 * answered with blocks in which note text is always marked as such.
 */

type Args = Record<string, unknown>
type Run = (scope: Scope, args: Args) => ResultBlock[] | Promise<ResultBlock[]>

export const READERS: Record<string, Run> = {
  get_ai_guide: (s) => read.getAiGuide(s),
  get_vault_profile: async (s) => [{ kind: 'data', data: await vaultProfile(s) }],
  search_notes: read.searchNotes,
  read_note: read.readNoteTool,
  read_file: readAnyFile,
  canvas_list: (s) => canvas.canvasList(s),
  canvas_read: canvas.canvasRead,
  get_note_context: read.noteContext,
  list_folder: read.listFolder,
  recent_notes: read.recentNotes,
  list_tags: read.listTags,
  get_periodic_note: read.getPeriodicNote,
  list_boards: (s) => read.listBoards(s),
  read_board: read.readBoard,
  list_tasks: read.listTasks,
  get_proposal: (scope, a) => {
    const found = proposal(String(a['id']))
    // One about a note now excluded is "no proposal": even its summary says something about that note.
    const hidden =
      found !== null &&
      (found.files.some((f) => scope.fileHidden(f.path)) ||
        (found.canvas !== undefined && scope.fileHidden(found.canvas.path)) ||
        (found.file !== undefined && [found.file.from, found.file.to].some((p) => p !== null && scope.fileHidden(p))))
    if (found === null || hidden) throw new ToolError(`No proposal “${String(a['id'])}”. Settled proposals are kept for a while, then forgotten.`)
    return [{ kind: 'data', data: { id: found.id, status: found.status, summary: found.summary } }]
  },
  withdraw_proposal: (scope, a) => {
    const id = String(a['id'])
    const found = proposal(id)
    // Only its own, and only one still waiting: what the person accepted or another app suggested is not the AI's to take back.
    if (found === null || found.client !== scope.client) throw new ToolError(`No suggestion “${id}” of yours.`)
    if (found.status !== 'pending') throw new ToolError(`“${id}” is ${found.status}, no longer waiting: it cannot be taken back.`)
    discard(id)
    return [{ kind: 'data', data: { id, status: 'withdrawn' } }]
  },
}

export const WRITERS: Record<string, (scope: Scope, args: Args) => write.Draft | Promise<write.Draft>> = {
  propose_new_note: write.proposeNewNote,
  canvas_propose_nodes: canvas.proposeCanvasNodes,
  canvas_propose_edges: canvas.proposeCanvasEdges,
  canvas_propose_group: canvas.proposeCanvasGroup,
  canvas_propose_layout: canvas.proposeCanvasLayout,
  canvas_propose_arrange: canvas.proposeCanvasArrange,
  canvas_propose_remove: canvas.proposeCanvasRemove,
  canvas_propose_new: canvas.proposeCanvasNew,
  propose_edit: write.proposeEdit,
  propose_append: write.proposeAppend,
  propose_link: write.proposeLink,
  propose_task: write.proposeTask,
  propose_task_update: write.proposeTaskUpdate,
  propose_rename: write.proposeRename,
  propose_move: write.proposeMove,
  propose_delete: write.proposeDelete,
}

async function runWrite(
  scope: Scope,
  tool: string,
  args: Args,
  session: ToolSession | null,
): Promise<{ blocks: ResultBlock[]; outcome: 'proposed' | 'applied' }> {
  if (scope.settings.writeMode === 'read')
    throw new ToolError('Recto is set to read only for AI (Settings → AI → Write mode). Tell the person what you would change instead.')
  const draft = await WRITERS[tool]!(scope, args)
  // A rename, move or archive changes the note it is about (and, renamed or moved, where it goes).
  const touched = draft.file === undefined ? draft.files.map((f) => f.path) : [draft.file.from, ...(draft.file.to === null ? [] : [draft.file.to])]
  const outside = session?.writable == null ? [] : touched.filter((p) => !session.writable!.has(p))
  if (outside.length > 0)
    throw new ToolError(`Here you may only change ${[...session!.writable!].map((p) => `“${p}”`).join(', ')}, not “${outside[0]!}”.`)
  const diff =
    draft.file === undefined
      ? draft.files.map((f) => `${f.before === null ? 'new' : 'edit'} ${f.path}\n${unifiedDiff(f.before ?? '', f.after)}`).join('\n\n')
      : draft.file.to === null
        ? `archive ${draft.file.from}`
        : `${draft.file.kind} ${draft.file.from} -> ${draft.file.to}`
  const base = { paths: touched, formatted: draft.formatted }
  // A chat inside Recto suggests; only an outside client may write directly.
  if (scope.settings.writeMode === 'write' && session === null) {
    const applied = await applyNow(draft)
    if (!applied.ok) throw new ToolError(applied.error)
    return {
      outcome: 'applied',
      blocks: [
        { kind: 'data', data: { outcome: 'applied', ...base } },
        { kind: 'note', path: base.paths[0]!, part: 'diff', text: diff },
      ],
    }
  }
  const made = queue(draft, scope.client, tool)
  const head: ResultBlock = {
    kind: 'data',
    data: {
      outcome: 'proposed',
      proposal_id: made.id,
      ...base,
      hint: `The person reviews this in Recto. Its id is ${made.id}: get_proposal says whether it was applied, withdraw_proposal takes it back while it waits.`,
    },
  }
  // A canvas's suggestion is shown as the canvas it makes, not as a diff of its JSON.
  const onCanvas = draft.files.length === 1 && draft.files[0]!.path.toLowerCase().endsWith('.canvas')
  const seen = onCanvas ? await canvas.suggestionPicture(scope, made.id, draft.files[0]!) : []
  return { outcome: 'proposed', blocks: [head, ...(seen.length > 0 ? seen : [{ kind: 'note' as const, path: base.paths[0]!, part: 'diff', text: diff }])] }
}

/**
 * `sessionId`: a run of one of Recto's own providers (sessions.ts). An id
 * that names no session - one already closed - is refused, never treated as
 * an outside client with the vault's full settings.
 */
export async function callTool(name: string, rawArgs: unknown, client: string, sessionId?: string): Promise<ToolOutcome> {
  const def = toolNamed(name)
  const session = sessionNamed(sessionId)
  const who = session?.client ?? client
  const argsForLog = rawArgs !== null && typeof rawArgs === 'object' ? (rawArgs as Args) : {}
  const entry = { at: Date.now(), client: who, tool: name, args: summariseArgs(argsForLog) }
  if (sessionId !== undefined && session === null) {
    logCall({ ...entry, outcome: 'error', error: 'session ended' })
    return { ok: false, error: 'This conversation has ended in Recto; its tools are closed.' }
  }
  // Checked at every call, not once per answer: the vault or the cloud switch can change while it runs.
  const stopped = session === null ? outsidePaused() : sessionStopped(session)
  if (stopped !== null) {
    logCall({ ...entry, outcome: 'error', error: 'session stopped' })
    return { ok: false, error: stopped }
  }
  if (def === undefined || (session?.tools != null && !session.tools.has(name))) {
    logCall({ ...entry, outcome: 'error', error: 'unknown tool' })
    return { ok: false, error: `Recto has no tool “${name}”${def === undefined ? '' : ' here'}.` }
  }
  const parsed = def.input.safeParse(rawArgs ?? {})
  if (!parsed.success) {
    const error = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
    logCall({ ...entry, outcome: 'error', error })
    return { ok: false, error: `Invalid arguments for ${name}: ${error}` }
  }
  const args = parsed.data as Args
  const n = ++calls
  session?.onCall?.({ n, tool: name, args, phase: 'start' })
  const outcome = await run(def.write, name, args, who, session, entry)
  session?.onCall?.({ n, tool: name, args, phase: 'end', ok: outcome.ok, ...(outcome.ok ? {} : { error: outcome.error }) })
  if (session !== null && outcome.ok) noteInRecord(session, outcome.blocks)
  return outcome
}

let calls = 0

/** Why a session may no longer call anything, or null while it may. */
function sessionStopped(session: ToolSession): string | null {
  if (session.vault !== (currentVault()?.path ?? null)) return 'Another vault is open in Recto now: this answer is stopped.'
  if (session.cloud && !coerceAiAccess(readState(AI_ACCESS_STATE)).cloud) return 'Cloud providers were turned off for this vault: this answer is stopped.'
  return null
}

/**
 * An app connected from outside - Claude Code, Codex, Cursor, Claude Desktop -
 * sends what it reads to its own cloud model, so Cloud off pauses it too.
 * Only its calls are refused: its connection, its config and its suggestions
 * stay, and the next call after Cloud is turned on simply works.
 */
function outsidePaused(): string | null {
  if (coerceAiAccess(readState(AI_ACCESS_STATE)).cloud) return null
  return 'Cloud AI is off for this vault in Recto (Settings → AI → Providers), so connected apps are paused. Tell the person; once they turn it on, call again - nothing needs reconnecting.'
}

/** Parts that are not about a note the answer read: a proposal's diff, the AI guide. */
const NOT_READING = new Set(['diff', 'guide'])

/**
 * A call into the answer's record, as the tools mark what they gave: a note block with no
 * part is its whole text, with a part (summary, snippet, excerpt) a skim; a file or a canvas
 * given as data says `whole`; a write that made a proposal adds its id.
 */
function noteInRecord(session: ToolSession, blocks: ResultBlock[]): void {
  const { read, skimmed, proposals } = session.record
  for (const b of blocks) {
    if (b.kind === 'note') {
      if (b.part === undefined) read.add(b.path)
      else if (!NOT_READING.has(b.part)) skimmed.add(b.path)
    } else if (b.kind === 'data') {
      const data = b.data as { path?: unknown; whole?: unknown; proposal_id?: unknown } | null
      if (typeof data?.proposal_id === 'string') proposals.push(data.proposal_id)
      else if (typeof data?.path === 'string' && typeof data.whole === 'boolean') (data.whole ? read : skimmed).add(data.path)
    }
  }
}

async function run(
  isWrite: boolean,
  name: string,
  args: Args,
  who: string,
  session: ToolSession | null,
  entry: Omit<ActivityEntry, 'outcome'>,
): Promise<ToolOutcome> {
  try {
    const scope = buildScope(who, { notes: session?.notes ?? null, exclude: session?.exclude ?? [] })
    if (isWrite) {
      const { blocks, outcome } = await runWrite(scope, name, args, session)
      logCall({ ...entry, outcome })
      return { ok: true, blocks }
    }
    const blocks = await READERS[name]!(scope, args)
    logCall({ ...entry, outcome: 'ok' })
    return { ok: true, blocks }
  } catch (err) {
    // Only Recto's own words go to the AI: a system error's text names paths on this Mac. Its detail goes to the console.
    const error = withoutPaths(err instanceof ToolError ? err.message : 'Recto could not do that.')
    if (!(err instanceof ToolError)) console.error('[vault-tools]', name, err)
    logCall({ ...entry, outcome: 'error', error })
    return { ok: false, error }
  }
}

/** A message as the AI may read it: paths in the vault as the vault names them, none of this Mac's own. */
function withoutPaths(text: string): string {
  const vault = currentVault()?.path
  return (vault === undefined ? text : text.split(`${vault}/`).join('').split(vault).join('the vault')).split(os.homedir()).join('~')
}

export { ToolError }
export { openSession, closeSession, recordOf, type ToolSession } from './sessions'
