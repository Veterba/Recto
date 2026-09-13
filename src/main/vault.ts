import fs from 'node:fs'
import path from 'node:path'
import { dialog } from 'electron'
import { VAULT_STATE_DIR, type OpenVaultResult, type StartupState, type VaultInfo } from '../shared/ipc-contract'
import { readState, writeState } from './store'

let current: VaultInfo | null = null

export function currentVault(): VaultInfo | null {
  return current
}

/** A folder is a usable vault if it exists, is a directory, and we can write to it. */
function check(dir: string): 'ok' | 'missing' | 'unreadable' {
  try {
    if (!fs.statSync(dir).isDirectory()) return 'unreadable'
  } catch {
    return 'missing'
  }
  try {
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK)
    return 'ok'
  } catch {
    return 'unreadable'
  }
}

/** What the state folder was called before the app was named Recto. */
const LEGACY_STATE_DIR = '.obsidian-like'

/**
 * Carry a vault's state folder across the rename.
 *
 * Without this, renaming the app silently abandons every vault's tabs, board
 * definitions, graph settings and archive - the files would still be there,
 * under a name nothing reads any more. One rename, once, and only when there
 * is nothing already in the way.
 */
function migrateStateDir(dir: string): void {
  const legacy = path.join(dir, LEGACY_STATE_DIR)
  const current = path.join(dir, VAULT_STATE_DIR)
  if (!fs.existsSync(legacy) || fs.existsSync(current)) return
  try {
    fs.renameSync(legacy, current)
  } catch {
    // A vault we cannot rename inside is a vault we scaffold fresh. Losing the
    // tab layout is not worth refusing to open someone's notes.
  }
}

/**
 * Create `.recto/` if absent. Returns true if we created it, so the
 * first-run UI can say "new vault" rather than "opened vault".
 */
function scaffold(dir: string): boolean {
  migrateStateDir(dir)
  const stateDir = path.join(dir, VAULT_STATE_DIR)
  if (fs.existsSync(stateDir)) return false
  fs.mkdirSync(path.join(stateDir, '.trash'), { recursive: true })
  fs.writeFileSync(
    path.join(stateDir, '.gitignore'),
    // The index is a cache: it must never be committed, and deleting it is safe.
    'index.db\nindex.db-wal\nindex.db-shm\n.trash/\narchive/\n',
    'utf8',
  )
  return true
}

export function openVault(dir: string): OpenVaultResult {
  const abs = path.resolve(dir)
  const status = check(abs)
  if (status !== 'ok') {
    return { ok: false, error: status === 'missing' ? 'Folder does not exist.' : 'Folder is not readable and writable.' }
  }
  const scaffolded = scaffold(abs)
  current = { path: abs, name: path.basename(abs) }
  writeState({ lastVaultPath: abs })
  return { ok: true, vault: current, scaffolded }
}

export async function pickVault(): Promise<OpenVaultResult> {
  const res = await dialog.showOpenDialog({
    title: 'Choose a vault folder',
    message: 'Pick a folder for your notes. An existing folder of markdown works too.',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Open vault',
  })
  const dir = res.filePaths[0]
  if (res.canceled || dir === undefined) return { ok: false, cancelled: true }
  return openVault(dir)
}

export function closeVault(): StartupState {
  current = null
  writeState({ lastVaultPath: undefined })
  return { kind: 'needs-vault', reason: 'first-run' }
}

/** Called once at boot: reopen the last vault if it is still usable. */
export function startupState(): StartupState {
  if (current) return { kind: 'ready', vault: current }

  const last = readState().lastVaultPath
  if (last === undefined) return { kind: 'needs-vault', reason: 'first-run' }

  const status = check(last)
  if (status !== 'ok') return { kind: 'needs-vault', reason: status, lastPath: last }

  const opened = openVault(last)
  return opened.ok ? { kind: 'ready', vault: opened.vault } : { kind: 'needs-vault', reason: 'unreadable', lastPath: last }
}
