import { randomBytes } from 'node:crypto'
import { BrowserWindow, Notification } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AI_PROPOSALS_STATE, type Proposal, type ProposalStatus } from '../../shared/ai-access'
import { IPC_EVENT } from '../../shared/ipc'
import { VAULT_STATE_DIR } from '../../shared/vault'
import { sendEvent } from '../events'
import { readState, writeState } from '../state'
import { currentVault } from '../vault'
import * as vaultFs from '../vault-fs'
import type { Draft } from './write'
import { parseCanvas, serializeCanvas } from '../../shared/canvas'
import { acceptOps, settledAs, type CanvasOpState, type CanvasProposal } from '../../shared/canvas-ops'

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

/** Write the files, if all are still as they were. */
async function write(
  files: Draft['files'],
): Promise<{ ok: true } | { ok: false; stale: true; path: string } | { ok: false; stale: false; error: string }> {
  for (const f of files) if ((await current(f.path)) !== f.before) return { ok: false, stale: true, path: f.path }
  for (const f of files) {
    const written = await vaultFs.writeFile(f.path, f.after)
    if (!written.ok) return { ok: false, stale: false, error: written.error ?? `Could not write ${f.path}.` }
  }
  return { ok: true }
}

/**
 * A canvas's pending edits applied to it as it is now - not as it was when
 * they were proposed: an edit whose node is gone since is stale, the rest
 * go in. Null when the canvas cannot be read.
 */
async function applyCanvas(proposal: CanvasProposal): Promise<{ states: CanvasOpState[]; refs: Record<string, string> } | { error: string }> {
  const text = await current(proposal.path).catch(() => null)
  if (text === null) return { error: `${proposal.path} is not there any more.` }
  let doc
  try {
    doc = parseCanvas(text)
  } catch {
    return { error: `${proposal.path} could not be read as a canvas.` }
  }
  const pending = proposal.states.flatMap((s, i) => (s === 'pending' ? [i] : []))
  const done = acceptOps(doc, proposal, pending)
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

function settle(id: string, status: ProposalStatus): void {
  save(load().map((p) => (p.id === id ? { ...p, status } : p)))
}

export async function apply(id: string): Promise<{ ok: true } | { ok: false; error: string; stale?: boolean }> {
  const found = proposal(id)
  if (found === null || found.status !== 'pending') return { ok: false, error: 'This suggestion is no longer pending.' }
  if (found.canvas !== undefined) {
    const done = await applyCanvas(found.canvas)
    if ('error' in done) return { ok: false, error: done.error }
    // Every pending edit tried: applied if any went in, stale if none could (their nodes gone since).
    const status = done.states.includes('accepted') ? 'applied' : 'stale'
    save(load().map((p) => (p.id === id ? { ...p, status, canvas: { ...found.canvas!, ...done } } : p)))
    return status === 'applied' ? { ok: true } : { ok: false, stale: true, error: 'The canvas has changed so that none of these edits fit any more.' }
  }
  const result = await write(found.files)
  if (result.ok) {
    settle(id, 'applied')
    return result
  }
  if (result.stale) {
    settle(id, 'stale')
    return {
      ok: false,
      stale: true,
      error: `${result.path} has changed since this was suggested, so nothing was written. Ask again for a fresh suggestion.`,
    }
  }
  return { ok: false, error: result.error }
}

/**
 * What became of a canvas proposal's edits on the open canvas - accepted
 * there (the canvas wrote them) or rejected; settled once none is pending.
 */
export function updateCanvas(id: string, states: CanvasOpState[], refs: Record<string, string>): { ok: boolean } {
  const found = proposal(id)
  if (found?.canvas === undefined || found.status !== 'pending' || states.length !== found.canvas.ops.length) return { ok: false }
  const status = settledAs(states)
  save(load().map((p) => (p.id === id ? { ...p, status: status === 'pending' ? 'pending' : status, canvas: { ...found.canvas!, states, refs } } : p)))
  return { ok: true }
}

export function discard(id: string): { ok: boolean } {
  const found = proposal(id)
  if (found === null || found.status !== 'pending') return { ok: false }
  settle(id, 'discarded')
  return { ok: true }
}
