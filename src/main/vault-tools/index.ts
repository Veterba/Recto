import { toolNamed, type ResultBlock, type ToolOutcome } from '../../shared/vault-tools'
import type { ActivityEntry } from '../../shared/ai-access'
import { logCall, summariseArgs } from './activity'
import { applyNow, proposal, queue } from './proposals'
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

const READERS: Record<string, Run> = {
  get_ai_guide: (s) => read.getAiGuide(s),
  get_vault_profile: async (s) => [{ kind: 'data', data: await vaultProfile(s) }],
  search_notes: read.searchNotes,
  read_note: read.readNoteTool,
  get_note_context: read.noteContext,
  list_folder: read.listFolder,
  recent_notes: read.recentNotes,
  list_tags: read.listTags,
  get_periodic_note: read.getPeriodicNote,
  list_boards: (s) => read.listBoards(s),
  read_board: read.readBoard,
  list_tasks: read.listTasks,
  get_proposal: (_s, a) => {
    const found = proposal(String(a['id']))
    if (found === null) throw new ToolError(`No proposal “${String(a['id'])}”. Settled proposals are kept for a while, then forgotten.`)
    return [{ kind: 'data', data: { id: found.id, status: found.status, summary: found.summary } }]
  },
}

const WRITERS: Record<string, (scope: Scope, args: Args) => write.Draft | Promise<write.Draft>> = {
  propose_new_note: write.proposeNewNote,
  propose_edit: write.proposeEdit,
  propose_append: write.proposeAppend,
  propose_link: write.proposeLink,
  propose_task: write.proposeTask,
  propose_task_update: write.proposeTaskUpdate,
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
  const outside = session?.writable == null ? [] : draft.files.filter((f) => !session.writable!.has(f.path))
  if (outside.length > 0)
    throw new ToolError(`Here you may only change ${[...session!.writable!].map((p) => `“${p}”`).join(', ')}, not “${outside[0]!.path}”.`)
  const diff = draft.files
    .map((f) => `${f.before === null ? 'new' : 'edit'} ${f.path}\n${unifiedDiff(f.before ?? '', f.after)}`)
    .join('\n\n')
  const base = { paths: draft.files.map((f) => f.path), formatted: draft.formatted }
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
  return {
    outcome: 'proposed',
    blocks: [
      {
        kind: 'data',
        data: {
          outcome: 'proposed',
          proposal_id: made.id,
          ...base,
          hint: 'The person reviews this in Recto (Suggested edits). get_proposal says whether it was applied.',
        },
      },
      { kind: 'note', path: base.paths[0]!, part: 'diff', text: diff },
    ],
  }
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
  if (session !== null && outcome.ok)
    for (const b of outcome.blocks) if (b.kind === 'note' && b.part !== 'diff') session.seen.add(b.path)
  return outcome
}

let calls = 0

async function run(
  isWrite: boolean,
  name: string,
  args: Args,
  who: string,
  session: ToolSession | null,
  entry: Omit<ActivityEntry, 'outcome'>,
): Promise<ToolOutcome> {
  try {
    const scope = buildScope(who, { notes: session?.notes ?? null })
    if (isWrite) {
      const { blocks, outcome } = await runWrite(scope, name, args, session)
      logCall({ ...entry, outcome })
      return { ok: true, blocks }
    }
    const blocks = await READERS[name]!(scope, args)
    logCall({ ...entry, outcome: 'ok' })
    return { ok: true, blocks }
  } catch (err) {
    const error = err instanceof ToolError ? err.message : `Recto could not do that: ${err instanceof Error ? err.message : String(err)}`
    if (!(err instanceof ToolError)) console.error('[vault-tools]', name, err)
    logCall({ ...entry, outcome: 'error', error })
    return { ok: false, error }
  }
}

export { ToolError }
export { openSession, closeSession, type ToolSession } from './sessions'
