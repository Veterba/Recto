import { randomBytes } from 'node:crypto'
import { BrowserWindow, Notification } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AI_PROPOSALS_STATE, isExcludedPath, type FileChange, type Proposal } from '../../shared/ai-access'
import { IPC_EVENT } from '../../shared/ipc'
import { VAULT_STATE_DIR } from '../../shared/vault'
import { sendEvent } from '../events'
import { readState, writeState } from '../state'
import { currentVault } from '../vault'
import * as vaultFs from '../vault-fs'
import type { Draft } from './write'
import { ToolError } from './scope'
import { parseCanvas, serializeCanvas } from '../../shared/canvas'
import { acceptOps, rejectOps, type CanvasOpState, type CanvasProposal } from '../../shared/canvas-ops'
import { applyChanges, changesOf, fileStates, statusOf, type ChangeState } from '../../shared/text-changes'

/**
 * Proposals: what an AI asked to write, waiting for Apply or Discard in
 * Recto's "Suggested edits". Kept in `.recto/ai-proposals.json`, so they
 * survive a restart; settled ones are kept a while for get_proposal.
 *
 * Apply writes only if every file is still exactly what the proposal was made
 * from - a note edited since makes it "stale" and nothing is written. The
 * writes are not marked as Recto's own, so the watcher reports them like an
 * edit from another app and an open tab reloads.
 */

/** Settled proposals kept, newest first. */
const KEEP_SETTLED = 50
/** Suggestions one client may have waiting at once: a client stuck in a loop does not bury the person in them. */
export const MAX_PENDING_PER_CLIENT = 30

const load = (): Proposal[] => {
  const raw = readState(AI_PROPOSALS_STATE) as { proposals?: unknown } | null
  return Array.isArray(raw?.proposals) ? (raw.proposals as Proposal[]) : []
}

function save(list: Proposal[]): void {
  const pending = list.filter((p) => p.status === 'pending')
  const settled = list
    .filter((p) => p.status !== 'pending')
    .sort((a, b) => b.created - a.created)
    .slice(0, KEEP_SETTLED)
  writeState(AI_PROPOSALS_STATE, { proposals: [...pending, ...settled] })
  const window = BrowserWindow.getAllWindows()[0]
  if (window !== undefined) sendEvent(window, IPC_EVENT.aiProposalsChanged)
}

export const listProposals = (): Proposal[] => load().sort((a, b) => b.created - a.created)
export const proposal = (id: string): Proposal | null => load().find((p) => p.id === id) ?? null

/** A draft as a pending proposal; said with a notification when Recto is not in front. */
export function queue(draft: Draft, client: string, tool: string): Proposal {
  if (load().filter((p) => p.status === 'pending' && p.client === client).length >= MAX_PENDING_PER_CLIENT)
    throw new ToolError(
      `${MAX_PENDING_PER_CLIENT} of your suggestions already wait in Recto. Stop and tell the person to apply or discard them first.`,
    )
  const made: Proposal = {
    id: randomUUID(),
    client,
    tool,
    summary: draft.summary,
    created: Date.now(),
    status: 'pending',
    files: draft.files,
    formatted: draft.formatted,
    ...(draft.canvas === undefined
      ? {}
      : { canvas: { path: draft.canvas.path, ops: draft.canvas.ops, states: draft.canvas.ops.map(() => 'pending' as const), refs: {} } }),
  }
  save([made, ...load()])
  const window = BrowserWindow.getAllWindows()[0]
  if (window !== undefined && !window.isFocused() && Notification.isSupported()) {
    const note = new Notification({ title: 'Suggested edit', body: `${clientName(client)}: ${draft.summary}` })
    note.on('click', () => {
      window.show()
      window.focus()
      sendEvent(window, IPC_EVENT.aiProposalsOpen)
    })
    note.show()
  }
  return made
}

const clientName = (id: string): string =>
  ({ 'claude-code': 'Claude Code', codex: 'Codex', 'claude-desktop': 'Claude Desktop', cursor: 'Cursor' })[id] ?? id

/** Each file as it is on disk now, or null when it does not exist. */
async function current(p: string): Promise<string | null> {
  const vault = currentVault()
  if (vault === null || !fs.existsSync(path.join(vault.path, p))) return null
  const read = await vaultFs.readFile(p)
  if (!read.ok) throw new Error(read.error)
  return read.content
}

/** How long Write directly's copies are kept: as long as version history keeps a note's (workers/indexer/snapshots.ts). */
const KEEP_BACKUP_DAYS = 30

/**
 * The files' current text, before writing: what Write directly keeps a copy of, in a folder of its
 * own - the time, and a few random letters, so two writes in one millisecond keep both. Copies older
 * than KEEP_BACKUP_DAYS go as a new one is made.
 */
function backup(files: Draft['files'], now = new Date()): void {
  const vault = currentVault()
  if (vault === null) return
  const root = path.join(vault.path, VAULT_STATE_DIR, 'backup', 'ai')
  const stamp = `${now.toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`
  for (const f of files) {
    if (f.before === null) continue
    const to = path.join(root, stamp, f.path)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.writeFileSync(to, f.before)
  }
  pruneBackups(root, now.getTime() - KEEP_BACKUP_DAYS * 86_400_000)
}

/**
 * Folders were excluded from AI: what Recto kept of their notes for the AI
 * goes too - settled suggestions about them, and Write directly's copies.
 * One still waiting stays: the person still applies or discards it.
 */
export function forgetExcluded(excluded: readonly string[]): void {
  const vault = currentVault()
  if (vault === null || excluded.length === 0) return
  const about = (p: Proposal): boolean =>
    p.files.some((f) => isExcludedPath(f.path, excluded)) || (p.canvas !== undefined && isExcludedPath(p.canvas.path, excluded))
  const list = load()
  const kept = list.filter((p) => p.status === 'pending' || !about(p))
  if (kept.length !== list.length) save(kept)
  const root = path.join(vault.path, VAULT_STATE_DIR, 'backup', 'ai')
  let copies: string[] = []
  try {
    copies = fs.readdirSync(root)
  } catch {
    return
  }
  for (const copy of copies)
    for (const entry of excluded) {
      const folder = entry.replace(/^\/+|\/+$/g, '')
      if (folder === '' || folder.split('/').includes('..')) continue
      for (const p of [folder, `${folder}.md`]) fs.rmSync(path.join(root, copy, p), { recursive: true, force: true })
    }
}

/** Folders in `root` made before `cutoff` (epoch ms), by their own time: removed. */
export function pruneBackups(root: string, cutoff: number): void {
  let names: string[] = []
  try {
    names = fs.readdirSync(root)
  } catch {
    return
  }
  for (const name of names) {
    // `2026-11-10T09-46-19-123Z-a1b2c3`: the ISO time with - for : and .
    const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name)
    if (iso === null) continue
    const at = Date.parse(`${iso[1]}T${iso[2]}:${iso[3]}:${iso[4]}.${iso[5]}Z`)
    if (at < cutoff) fs.rmSync(path.join(root, name), { recursive: true, force: true })
  }
}

/**
 * Write the files, if all are still as they were - all of them or none: when
 * one cannot be written, those written before it are put back, so a board is
 * never left with its card line but no card note, and Apply can be tried again.
 */
async function write(
  files: Draft['files'],
): Promise<{ ok: true } | { ok: false; stale: true; path: string } | { ok: false; stale: false; error: string }> {
  for (const f of files) if ((await current(f.path)) !== f.before) return { ok: false, stale: true, path: f.path }
  const done: Draft['files'] = []
  for (const f of files) {
    const written = await vaultFs.writeFile(f.path, f.after)
    if (!written.ok) {
      for (const back of done.reverse())
        if (back.before === null) await vaultFs.trash(back.path)
        else await vaultFs.writeFile(back.path, back.before)
      return { ok: false, stale: false, error: written.error ?? `Could not write ${f.path}.` }
    }
    done.push(f)
  }
  return { ok: true }
}

/**
 * A canvas's pending edits applied to it as it is now - not as it was when
 * they were proposed: an edit whose node is gone since is stale, the rest
 * go in. Null when the canvas cannot be read.
 */
async function applyCanvas(
  proposal: CanvasProposal,
  indexes: readonly number[] = proposal.states.flatMap((s, i) => (s === 'pending' ? [i] : [])),
): Promise<{ states: CanvasOpState[]; refs: Record<string, string> } | { error: string; gone?: true }> {
  const text = await current(proposal.path).catch(() => null)
  if (text === null) return { error: `${proposal.path} is not there any more.`, gone: true }
  let doc
  try {
    doc = parseCanvas(text)
  } catch {
    return { error: `${proposal.path} could not be read as a canvas.` }
  }
  const done = acceptOps(doc, proposal, indexes)
  const written = await vaultFs.writeFile(proposal.path, serializeCanvas(done.doc))
  if (!written.ok) return { error: written.error ?? `Could not write ${proposal.path}.` }
  return { states: done.states, refs: done.refs }
}

/** Write directly: a backup of every file it changes, then the write. */
export async function applyNow(draft: Draft): Promise<{ ok: true } | { ok: false; error: string }> {
  backup(draft.files)
  if (draft.canvas !== undefined) {
    const done = await applyCanvas({ ...draft.canvas, states: draft.canvas.ops.map(() => 'pending'), refs: {} })
    return 'error' in done ? { ok: false, error: done.error } : { ok: true }
  }
  const result = await write(draft.files)
  if (result.ok) return result
  return { ok: false, error: result.stale ? `${result.path} changed while this was being made. Read it again and retry.` : result.error }
}

const statesOf = (p: Proposal, f: FileChange): ChangeState[] => fileStates(p.status, f)

/** A pending proposal changed, in the store: only while it is still pending - a late answer never undoes a settled one. */
function update(id: string, change: (p: Proposal) => Proposal): void {
  save(load().map((p) => (p.id === id && p.status === 'pending' ? change(p) : p)))
}

/** Proposals being applied now: a second Apply of one (a double click, Apply all beside it) waits for nothing and does nothing. */
const applying = new Set<string>()

type Applied = { ok: true } | { ok: false; error: string; stale?: boolean }

/**
 * Apply a proposal's pending changes - `picks` of them (indexes of its changes, or of a canvas's edits), or
 * all. Each goes onto the note as it is now (text-changes.ts): one whose own lines are gone is out of date,
 * the rest go in. A proposal that writes several files (a card and its board) goes in whole or not at all:
 * half of it would break the board.
 */
export async function apply(id: string, picks?: readonly number[]): Promise<Applied> {
  if (applying.has(id)) return { ok: false, error: 'This suggestion is being applied.' }
  applying.add(id)
  // One at a time: two read the same note or canvas, each wrote it with its own change, and the second
  // write lost the first (Accept all in the panel, two suggestions on one canvas).
  const run = turn.then(() => applyOnce(id, picks))
  turn = run.then(
    () => undefined,
    () => undefined,
  )
  try {
    return await run
  } finally {
    applying.delete(id)
  }
}

/** The apply before this one, finished or failed: the next waits for it. */
let turn: Promise<void> = Promise.resolve()

async function applyOnce(id: string, picks?: readonly number[]): Promise<Applied> {
  const found = proposal(id)
  if (found === null || found.status !== 'pending') return { ok: false, error: 'This suggestion is no longer pending.' }
  if (found.canvas !== undefined) return applyCanvasProposal(found, picks)
  if (found.files.length > 1) return applyWhole(found)
  const file = found.files[0]!
  const states = statesOf(found, file)
  const chosen = (picks ?? states.map((_, i) => i)).filter((i) => states[i] === 'pending')
  if (chosen.length === 0) return { ok: false, error: 'Nothing in this suggestion is waiting.' }
  const done = applyChanges(await current(file.path), changesOf(file.before, file.after), chosen)
  if ([...done.states.values()].includes('accepted')) {
    const written = await vaultFs.writeFile(file.path, done.text!)
    if (!written.ok) return { ok: false, error: written.error ?? `Could not write ${file.path}.` }
  }
  for (const [i, state] of done.states) states[i] = state
  update(id, (p) => ({ ...p, status: statusOf(states), files: [{ ...file, states }] }))
  const stale = [...done.states.values()].filter((s) => s === 'stale').length
  if (stale === 0) return { ok: true }
  return {
    ok: false,
    stale: true,
    error:
      stale === done.states.size
        ? `${titleOf(file.path)} has changed where this would go, so nothing was written. Ask again for a fresh suggestion.`
        : `${stale} of these changes no longer fit ${titleOf(file.path)} (it changed there since); the rest went in.`,
  }
}

const titleOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1).replace(/\.(md|canvas)$/i, '')

/** Several files at once: every change of every file found again, then all written - or, one missing, none. */
async function applyWhole(found: Proposal): Promise<Applied> {
  const next: Draft['files'] = []
  for (const f of found.files) {
    const now = await current(f.path)
    const changes = changesOf(f.before, f.after)
    const done = applyChanges(now, changes, changes.map((_, i) => i))
    if ([...done.states.values()].includes('stale')) {
      update(found.id, (p) => ({ ...p, status: 'stale', files: p.files.map((g) => ({ ...g, states: statesOf(p, g).map(() => 'stale' as const) })) }))
      return { ok: false, stale: true, error: `${titleOf(f.path)} has changed where this would go, so nothing was written. Ask again for a fresh suggestion.` }
    }
    next.push({ path: f.path, before: now, after: done.text! })
  }
  const result = await write(next)
  if (!result.ok) return { ok: false, error: result.stale ? `${titleOf(result.path)} changed while this was being applied. Try again.` : result.error }
  update(found.id, (p) => ({ ...p, status: 'applied', files: p.files.map((g) => ({ ...g, states: statesOf(p, g).map(() => 'accepted' as const) })) }))
  return { ok: true }
}

/** A canvas's picked edits written onto it as it is now; a canvas gone since makes them out of date. */
async function applyCanvasProposal(found: Proposal, picks?: readonly number[]): Promise<Applied> {
  const canvas = found.canvas!
  const chosen = (picks ?? canvas.states.map((_, i) => i)).filter((i) => canvas.states[i] === 'pending')
  const done = await applyCanvas(canvas, chosen)
  if ('error' in done) {
    if (done.gone === true) {
      const states = canvas.states.map((s) => (s === 'pending' ? 'stale' : s))
      update(found.id, (p) => ({ ...p, status: statusOf(states), canvas: { ...canvas, states } }))
      return { ok: false, stale: true, error: 'The canvas is not there any more.' }
    }
    return { ok: false, error: done.error }
  }
  update(found.id, (p) => ({ ...p, status: statusOf(done.states), canvas: { ...canvas, ...done } }))
  const tried = chosen.filter((i) => done.states[i] === 'stale').length
  return tried === 0 ? { ok: true } : { ok: false, stale: true, error: 'Some of these edits no longer fit the canvas: what they were about is gone.' }
}

/** Reject a proposal's pending changes - `picks` of them, or all. A canvas edit takes those that need it along. */
export function discard(id: string, picks?: readonly number[]): { ok: boolean } {
  const found = proposal(id)
  if (found === null || found.status !== 'pending') return { ok: false }
  if (found.canvas !== undefined) {
    const canvas = found.canvas
    const states = rejectOps(canvas, picks ?? canvas.states.map((_, i) => i))
    update(id, (p) => ({ ...p, status: statusOf(states), canvas: { ...canvas, states } }))
    return { ok: true }
  }
  update(id, (p) => {
    // Several files go whole: rejected whole too.
    const whole = p.files.length > 1 || picks === undefined
    const files = p.files.map((f) => ({ ...f, states: statesOf(p, f).map((s, i) => (s === 'pending' && (whole || picks.includes(i)) ? ('rejected' as const) : s)) }))
    return { ...p, status: statusOf(files.flatMap((f) => f.states)), files }
  })
  return { ok: true }
}
