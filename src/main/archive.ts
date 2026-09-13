import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import { VAULT_STATE_DIR, type ArchiveEntry, type ArchiveState } from '../shared/ipc-contract'
import { resolveInVault } from './paths'
import { currentVault } from './vault'

/**
 * Deleting a note archives it instead.
 *
 * Two stages, deliberately: the file moves into `.recto/archive/` and
 * stays there for a retention window (10 days by default, configurable), then
 * goes to the OS trash. So an accidental delete is recoverable inside the app
 * for a week and a half, and still recoverable from Finder after that.
 *
 * The manifest is a JSON file next to the archived files rather than a row in
 * SQLite, because the index is a cache that can be deleted at any time and this
 * is the one piece of deletion state that must survive that.
 */

export const DEFAULT_RETENTION_DAYS = 10
const DAY_MS = 86_400_000

const archiveDir = (): string => {
  const vault = currentVault()
  if (!vault) throw new Error('no vault open')
  return path.join(vault.path, VAULT_STATE_DIR, 'archive')
}

const manifestFile = (): string => {
  const vault = currentVault()
  if (!vault) throw new Error('no vault open')
  return path.join(vault.path, VAULT_STATE_DIR, 'archive.json')
}

export function readManifest(): ArchiveState {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestFile(), 'utf8')) as Partial<ArchiveState>
    return {
      retentionDays:
        typeof parsed.retentionDays === 'number' && parsed.retentionDays >= 0
          ? parsed.retentionDays
          : DEFAULT_RETENTION_DAYS,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    }
  } catch {
    return { retentionDays: DEFAULT_RETENTION_DAYS, entries: [] }
  }
}

function writeManifest(state: ArchiveState): void {
  const file = manifestFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // Write-then-rename: losing this file means losing the map back to where a
  // note came from, which is the only irreplaceable part of the archive.
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

const newId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Move a note or folder into the archive. */
export async function archive(relative: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const vault = currentVault()
    if (!vault) return { ok: false, error: 'No vault open.' }

    const from = resolveInVault(vault.path, relative)
    const stat = await fsp.stat(from)
    const id = newId()
    const dir = archiveDir()
    await fsp.mkdir(dir, { recursive: true })

    // Stored flat under an opaque id, so two notes with the same name from
    // different folders cannot collide.
    const stored = path.join(dir, id)
    await fsp.rename(from, stored)

    const state = readManifest()
    const entry: ArchiveEntry = {
      id,
      originalPath: relative,
      name: path.basename(relative),
      kind: stat.isDirectory() ? 'folder' : 'file',
      deletedAt: Date.now(),
      size: stat.isDirectory() ? 0 : stat.size,
    }
    writeManifest({ ...state, entries: [entry, ...state.entries] })
    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Put an archived item back. Never overwrites: appends a suffix if occupied. */
export async function restore(id: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const vault = currentVault()
    if (!vault) return { ok: false, error: 'No vault open.' }

    const state = readManifest()
    const entry = state.entries.find((e) => e.id === id)
    if (!entry) return { ok: false, error: 'That item is no longer in the archive.' }

    const stored = path.join(archiveDir(), id)
    if (!fs.existsSync(stored)) {
      // Manifest and disk disagreed; drop the row rather than leave a ghost.
      writeManifest({ ...state, entries: state.entries.filter((e) => e.id !== id) })
      return { ok: false, error: 'The archived file is missing from disk.' }
    }

    let target = resolveInVault(vault.path, entry.originalPath)
    if (fs.existsSync(target)) {
      const ext = path.extname(target)
      const base = target.slice(0, target.length - ext.length)
      let n = 2
      while (fs.existsSync(`${base} ${n}${ext}`) && n < 1000) n++
      target = `${base} ${n}${ext}`
    }

    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.rename(stored, target)
    writeManifest({ ...state, entries: state.entries.filter((e) => e.id !== id) })

    return { ok: true, path: path.relative(vault.path, target).split(path.sep).join('/') }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Second stage: out of the archive and into the OS trash.
 *
 * Deliberately not `unlink`. "Deleted" should mean gone from the app, not
 * unrecoverable - the user can still change their mind in Finder.
 */
export async function purge(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const state = readManifest()
    const stored = path.join(archiveDir(), id)
    if (fs.existsSync(stored)) await shell.trashItem(stored)
    writeManifest({ ...state, entries: state.entries.filter((e) => e.id !== id) })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Purge everything past the retention window. Called on every vault open. */
export async function purgeExpired(): Promise<{ purged: number }> {
  const state = readManifest()
  if (state.retentionDays === 0) return { purged: 0 } // 0 = keep forever
  const cutoff = Date.now() - state.retentionDays * DAY_MS
  const expired = state.entries.filter((e) => e.deletedAt < cutoff)
  for (const entry of expired) await purge(entry.id)
  return { purged: expired.length }
}

export function setRetention(days: number): ArchiveState {
  const state = readManifest()
  const next = { ...state, retentionDays: Math.max(0, Math.min(3650, Math.round(days))) }
  writeManifest(next)
  return next
}

/** Manifest rows whose file has gone missing are dropped, not shown. */
export function list(): ArchiveState {
  const state = readManifest()
  let dir: string
  try {
    dir = archiveDir()
  } catch {
    return state
  }
  const present = state.entries.filter((entry) => fs.existsSync(path.join(dir, entry.id)))
  if (present.length !== state.entries.length) writeManifest({ ...state, entries: present })
  return { ...state, entries: present }
}
