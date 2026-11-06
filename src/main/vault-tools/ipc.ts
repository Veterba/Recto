import { app, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AI_ACCESS_STATE, coerceAiAccess } from '../../shared/ai-access'
import { detectProfile, fromLinter, LINTER_ID } from '../../shared/formatting'
import { isKanban } from '../../shared/kanban'
import { nameProblem } from '../../shared/vault'
import type { IpcApi } from '../../shared/ipc'
import { IPC } from '../../shared/ipc'
import { readState, writeState } from '../state'
import { markSelfWrite } from '../watcher'
import * as vaultFs from '../vault-fs'
import { readActivity } from './activity'
import { allStatuses, clientPlan, connectClient, disconnectClient, type ClientEnv } from './clients'
import { buildMcpb, launcherPath, selfTest } from './launcher'
import { draftGuide } from './profile'
import * as proposals from './proposals'
import { buildScope, titleOf } from './scope'

/** Settings → AI and Suggested edits, over IPC. */

type Handle = <C extends keyof IpcApi>(
  channel: C,
  fn: (...args: Parameters<IpcApi[C]>) => ReturnType<IpcApi[C]> | Promise<ReturnType<IpcApi[C]>>,
) => void

/** Notes read for "Detect from my notes": the most recently changed, at most this many. */
const DETECT_NOTES = 400

const clientEnv = (): ClientEnv => {
  const userData = app.getPath('userData')
  return { home: os.homedir(), launcher: launcherPath(userData), backups: path.join(userData, 'backup', 'clients') }
}

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
  } catch {
    return null
  }
}

async function detectFormatting(): Promise<ReturnType<IpcApi[typeof IPC.aiAccessDetectFormatting]>> {
  const scope = buildScope('recto')
  // Obsidian's files are only read, never written.
  const obsidian = path.join(scope.vault, '.obsidian')
  const enabled = readJson(path.join(obsidian, 'community-plugins.json'))
  const linter = fromLinter(enabled, readJson(path.join(obsidian, 'plugins', LINTER_ID, 'data.json')))
  const state = linter !== null ? 'imported' : fs.existsSync(path.join(obsidian, 'plugins', LINTER_ID)) ? 'off' : 'missing'
  const newest = scope.notes
    .map((p) => ({ p, at: fs.statSync(path.join(scope.vault, p)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .slice(0, DETECT_NOTES)
  const notes = []
  for (const { p } of newest) {
    const read = await vaultFs.readFile(p)
    // Boards are Kanban files, not prose: their layout is the plugin's, not the person's.
    if (read.ok && !isKanban(read.content)) notes.push({ name: titleOf(p), text: read.content })
  }
  return { ...detectProfile(notes, linter), linter: state, notes: notes.length }
}

export function registerAiAccessIpc(handle: Handle): void {
  handle(IPC.aiAccessSettings, () => coerceAiAccess(readState(AI_ACCESS_STATE)))
  handle(IPC.aiAccessSetSettings, (next) => writeState(AI_ACCESS_STATE, coerceAiAccess(next)))
  handle(IPC.aiAccessDetectFormatting, () => detectFormatting())
  handle(IPC.aiAccessDraftGuide, () => draftGuide(buildScope('recto')))
  handle(IPC.aiAccessSaveGuide, async (name, text) => {
    const clean = name.trim().replace(/\.md$/i, '')
    const problem = nameProblem(clean)
    if (problem !== null) return { ok: false as const, error: problem }
    // Written at the vault's top: only a note there of the name is in the way, as in Obsidian.
    const taken = vaultFs.sameNamed(`${clean}.md`).find((p) => !p.includes('/'))
    if (taken !== undefined)
      return {
        ok: false as const,
        error: `A note “${titleOf(taken)}” is already at the top of the vault. Choose another name, or pick that note as the guide.`,
      }
    const file = `${clean}.md`
    markSelfWrite(file)
    const written = await vaultFs.writeFile(file, text.endsWith('\n') ? text : `${text}\n`)
    if (!written.ok) return { ok: false as const, error: written.error ?? 'Could not write the guide.' }
    writeState(AI_ACCESS_STATE, { ...coerceAiAccess(readState(AI_ACCESS_STATE)), guide: file })
    return { ok: true as const, path: file }
  })
  handle(IPC.aiAccessActivity, () => readActivity())
  handle(IPC.aiProposals, () => proposals.listProposals())
  handle(IPC.aiProposalApply, (id) => proposals.apply(id))
  handle(IPC.aiProposalDiscard, (id) => proposals.discard(id))
  handle(IPC.aiClients, () => allStatuses(clientEnv()))
  handle(IPC.aiClientPlan, (id, action) => clientPlan(id, action, clientEnv()))
  handle(IPC.aiClientConnect, (id) => connectClient(id, clientEnv()))
  handle(IPC.aiClientDisconnect, (id) => disconnectClient(id, clientEnv()))
  handle(IPC.aiClientInstallExtension, async () => {
    try {
      const file = await buildMcpb()
      const error = await shell.openPath(file)
      return error === '' ? { ok: true } : { ok: false, error }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  handle(IPC.aiClientTest, () => selfTest())
}
