import { app, BrowserWindow, dialog } from 'electron'
import chokidar, { type FSWatcher } from 'chokidar'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ObsidianSyncStatus, ObsidianVaultInfo, SyncProblem } from '../../shared/ipc-contract'
import * as archive from '../archive'
import { currentVault } from '../vault'
import { ignored } from './plan'
import { nested, previewSync, runSync, type EngineOptions, type SyncOutcome } from './engine'

/**
 * Two-way sync with an Obsidian vault: the app side.
 *
 * Settings live in `userData`, never in either vault. The pairing is an
 * absolute path on this machine, and a vault is a folder people move between
 * machines - an absolute path inside it would point at nothing on the next one.
 *
 * Passes run when either folder changes (debounced), once a minute as a
 * fallback, and on demand. One pass at a time; a change that arrives during a
 * pass schedules exactly one more.
 */

type Pair = { obsidianPath: string; enabled: boolean }
type Config = { pairs: Record<string, Pair> }

const CONFIG = (): string => path.join(app.getPath('userData'), 'obsidian-sync.json')
const DEBOUNCE_MS = 2000
const FALLBACK_MS = 60_000

function readConfig(): Config {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG(), 'utf8')) as Config
    if (typeof parsed.pairs === 'object' && parsed.pairs !== null) return parsed
  } catch {
    // Nothing configured yet.
  }
  return { pairs: {} }
}

function writeConfig(config: Config): void {
  fs.mkdirSync(path.dirname(CONFIG()), { recursive: true })
  fs.writeFileSync(CONFIG(), JSON.stringify(config, null, 2))
}

/** One base per pairing: the same Recto vault paired with a different folder starts fresh. */
function manifestFor(rectoPath: string, obsidianPath: string): string {
  const id = createHash('sha1').update(`${path.resolve(rectoPath)}\0${path.resolve(obsidianPath)}`).digest('hex')
  return path.join(app.getPath('userData'), 'obsidian-sync', `${id}.json`)
}

// --- state ------------------------------------------------------------------

let watcher: FSWatcher | null = null
let fallback: NodeJS.Timeout | undefined
let debounce: NodeJS.Timeout | undefined
let running = false
let again = false
let lastSyncAt: number | null = null
let last: ObsidianSyncStatus['last'] = null
let problem: SyncProblem | null = null

function pairForCurrent(): { rectoPath: string; pair: Pair | null } | null {
  const vault = currentVault()
  if (vault === null) return null
  return { rectoPath: vault.path, pair: readConfig().pairs[vault.path] ?? null }
}

export function status(): ObsidianSyncStatus {
  const current = pairForCurrent()
  return {
    obsidianPath: current?.pair?.obsidianPath ?? null,
    enabled: current?.pair?.enabled ?? false,
    running,
    lastSyncAt,
    last,
    problem,
  }
}

function push(): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (window !== undefined && !window.isDestroyed()) window.webContents.send('obsidian:status', status())
}

function optionsFor(rectoPath: string, obsidianPath: string, force = false): EngineOptions {
  return {
    rectoRoot: rectoPath,
    obsidianRoot: obsidianPath,
    manifestFile: manifestFor(rectoPath, obsidianPath),
    // A deletion that arrives from Obsidian goes to Recto's archive, where it
    // can be restored for the retention window - never straight to nothing.
    archiveInRecto: async (relative) => {
      const result = await archive.archive(relative)
      if (!result.ok) throw new Error(result.error)
    },
    force,
  }
}

function problemOf(outcome: Exclude<SyncOutcome, { ok: true }>): SyncProblem {
  switch (outcome.reason) {
    case 'missing':
      return { reason: 'missing', side: outcome.side }
    case 'nested':
      return { reason: 'nested' }
    case 'guard':
      return { reason: 'guard', side: outcome.side, count: outcome.count }
    case 'error':
      return { reason: 'error', message: outcome.message }
  }
}

// --- passes -------------------------------------------------------------------

async function pass(force = false): Promise<void> {
  const current = pairForCurrent()
  if (current?.pair == null || !current.pair.enabled) return
  if (running) {
    again = true
    return
  }
  running = true
  push()
  try {
    const outcome = await runSync(optionsFor(current.rectoPath, current.pair.obsidianPath, force))
    if (outcome.ok) {
      problem = null
      lastSyncAt = outcome.report.at
      // Keep the last pass that DID something. The watcher runs a quiet pass a
      // moment after every real one, and letting it overwrite the report left
      // the screen saying "0 files" right after a sync that copied hundreds.
      const counts = outcome.report.summary
      const busy =
        counts.toRecto + counts.toObsidian + counts.deleteInRecto + counts.deleteInObsidian + counts.conflicts > 0 ||
        outcome.report.errors.length > 0
      if (busy || last === null) {
        last = { counts, conflicts: outcome.report.conflicts, errors: outcome.report.errors }
      }
    } else {
      problem = problemOf(outcome)
    }
  } finally {
    running = false
    push()
  }
  if (again) {
    again = false
    void pass()
  }
}

function schedule(): void {
  clearTimeout(debounce)
  debounce = setTimeout(() => void pass(), DEBOUNCE_MS)
}

function stopWatchers(): void {
  clearTimeout(debounce)
  clearInterval(fallback)
  void watcher?.close()
  watcher = null
}

/** Start (or restart) syncing for whatever vault is open. Called whenever the vault changes. */
export function startForCurrentVault(): void {
  stopWatchers()
  problem = null
  last = null
  lastSyncAt = null
  const current = pairForCurrent()
  if (current?.pair == null || !current.pair.enabled) {
    push()
    return
  }
  watcher = chokidar.watch([current.rectoPath, current.pair.obsidianPath], {
    ignoreInitial: true,
    // Both apps' own folders, dotfiles and the sync's own temp files.
    ignored: (file: string) => {
      for (const root of [current.rectoPath, current.pair!.obsidianPath]) {
        const rel = path.relative(root, file)
        if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) return ignored(rel.split(path.sep).join('/'))
      }
      return false
    },
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  })
  watcher.on('all', schedule)
  fallback = setInterval(() => void pass(), FALLBACK_MS)
  void pass()
}

export function stopAll(): void {
  stopWatchers()
}

// --- the handlers ---------------------------------------------------------------

/** Where Obsidian keeps its list of vaults, per platform. */
function obsidianConfigFile(): string {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json')
  if (process.platform === 'win32') return path.join(process.env['APPDATA'] ?? '', 'obsidian', 'obsidian.json')
  return path.join(os.homedir(), '.config', 'obsidian', 'obsidian.json')
}

function countNotes(dir: string, limit = 20_000): number {
  let count = 0
  const walk = (current: string): void => {
    if (count >= limit) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory()) walk(path.join(current, entry.name))
      else if (entry.name.toLowerCase().endsWith('.md')) count++
    }
  }
  walk(dir)
  return count
}

export function detectVaults(): ObsidianVaultInfo[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(obsidianConfigFile(), 'utf8')) as {
      vaults?: Record<string, { path?: string; open?: boolean }>
    }
    return Object.values(parsed.vaults ?? {})
      .filter((vault): vault is { path: string; open?: boolean } => typeof vault.path === 'string' && fs.existsSync(vault.path))
      .map((vault) => ({ path: vault.path, name: path.basename(vault.path), notes: countNotes(vault.path), open: vault.open === true }))
  } catch {
    // Obsidian not installed, or never opened a vault: nothing to offer.
    return []
  }
}

export async function pickFolder(): Promise<string | null> {
  const picked = await dialog.showOpenDialog({ title: 'Choose your Obsidian vault', properties: ['openDirectory'] })
  return picked.canceled ? null : (picked.filePaths[0] ?? null)
}

export async function preview(obsidianPath: string) {
  const vault = currentVault()
  if (vault === null) return { ok: false as const, problem: { reason: 'error' as const, message: 'No vault is open.' } }
  if (nested(vault.path, obsidianPath)) return { ok: false as const, problem: { reason: 'nested' as const } }
  const result = await previewSync(optionsFor(vault.path, obsidianPath))
  return result.ok ? { ok: true as const, counts: result.summary } : { ok: false as const, problem: problemOf(result) }
}

export function enable(obsidianPath: string): ObsidianSyncStatus {
  const vault = currentVault()
  if (vault === null) return status()
  const config = readConfig()
  config.pairs[vault.path] = { obsidianPath, enabled: true }
  writeConfig(config)
  startForCurrentVault()
  return status()
}

export function disable(): ObsidianSyncStatus {
  const vault = currentVault()
  if (vault !== null) {
    const config = readConfig()
    const pair = config.pairs[vault.path]
    // The folder is remembered, so switching back on does not ask again - and
    // the base is kept, so it resumes rather than starting over as a first sync.
    if (pair !== undefined) config.pairs[vault.path] = { ...pair, enabled: false }
    writeConfig(config)
  }
  startForCurrentVault()
  return status()
}

export async function syncNow(force = false): Promise<ObsidianSyncStatus> {
  await pass(force)
  return status()
}
