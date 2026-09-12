import chokidar, { type FSWatcher } from 'chokidar'
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { VAULT_STATE_DIR, type VaultChange } from '../shared/ipc-contract'
import { currentVault } from './vault'

/**
 * Watches the vault and pushes changes to the renderer.
 *
 * Two things here are load-bearing:
 *
 * 1. **Self-write suppression.** Saving a note fires a `change` event that looks
 *    exactly like someone editing the file in another app. Without suppression
 *    the editor reloads the buffer from disk mid-keystroke and eats what you
 *    just typed. Every app in this category has shipped that bug at least once.
 *
 * 2. **Batching.** A folder rename or a git checkout emits hundreds of events.
 *    Sending each one across IPC re-renders the file tree hundreds of times.
 */

const SELF_WRITE_TTL_MS = 2_000
const BATCH_MS = 60

let watcher: FSWatcher | null = null
let queue: VaultChange[] = []
let flushTimer: NodeJS.Timeout | null = null
let target: BrowserWindow | null = null

/** Absolute path -> expiry. Entries also clear on their matching event. */
const selfWrites = new Map<string, number>()

/**
 * Declare that we are about to write this path ourselves, so the resulting
 * watcher event is ignored. The TTL is a backstop: if the write fails, or the
 * platform coalesces the event away, the entry must not suppress a real edit
 * forever.
 */
export function markSelfWrite(relative: string): void {
  const vault = currentVault()
  if (!vault) return
  selfWrites.set(path.resolve(vault.path, relative), Date.now() + SELF_WRITE_TTL_MS)
}

function isSelfWrite(absolute: string): boolean {
  const expiry = selfWrites.get(absolute)
  if (expiry === undefined) return false
  selfWrites.delete(absolute)
  // An expired entry is treated as a real change: better a redundant reload
  // than a silently swallowed edit from another app.
  return Date.now() <= expiry
}

function flush(): void {
  flushTimer = null
  if (queue.length === 0 || !target || target.isDestroyed()) {
    queue = []
    return
  }
  const batch = queue
  queue = []
  target.webContents.send('vault:changed', batch)
}

function enqueue(change: VaultChange): void {
  queue.push(change)
  if (flushTimer === null) flushTimer = setTimeout(flush, BATCH_MS)
}

export function startWatching(window: BrowserWindow): void {
  stopWatching()
  const vault = currentVault()
  if (!vault) return

  target = window
  const root = vault.path
  const toRelative = (absolute: string): string =>
    path.relative(root, absolute).split(path.sep).join('/')

  watcher = chokidar.watch(root, {
    ignoreInitial: true,
    // The initial tree comes from `fs:tree`; the watcher only reports changes.
    ignored: (candidate: string) => {
      const name = path.basename(candidate)
      if (candidate === root) return false
      // Our own atomic writes land as `note.md.tmp-1234` before the rename.
      if (name.includes('.tmp-')) return true
      return name === VAULT_STATE_DIR || name === 'node_modules' || name.startsWith('.')
    },
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
  })

  watcher
    .on('add', (absolute, stat) => {
      if (isSelfWrite(absolute)) return
      enqueue({ type: 'add', path: toRelative(absolute), mtime: stat?.mtimeMs ?? 0, size: stat?.size ?? 0 })
    })
    .on('change', (absolute, stat) => {
      if (isSelfWrite(absolute)) return
      enqueue({ type: 'change', path: toRelative(absolute), mtime: stat?.mtimeMs ?? 0, size: stat?.size ?? 0 })
    })
    .on('unlink', (absolute) => {
      if (isSelfWrite(absolute)) return
      enqueue({ type: 'unlink', path: toRelative(absolute) })
    })
    .on('addDir', (absolute) => enqueue({ type: 'addDir', path: toRelative(absolute) }))
    .on('unlinkDir', (absolute) => enqueue({ type: 'unlinkDir', path: toRelative(absolute) }))
    .on('ready', () => enqueue({ type: 'ready' }))
    .on('error', (err) => {
      // A watcher error must not take the app down; the tree can still be
      // refreshed manually and the vault is still readable.
      console.error('[watcher]', err)
    })

  // Stale suppressions would otherwise accumulate for the life of the process.
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [file, expiry] of selfWrites) if (expiry < now) selfWrites.delete(file)
  }, SELF_WRITE_TTL_MS)
  sweep.unref()
}

export function stopWatching(): void {
  void watcher?.close()
  watcher = null
  target = null
  queue = []
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  selfWrites.clear()
}

/** True if the vault folder still exists. Used to notice an unmounted drive. */
export function vaultStillExists(): boolean {
  const vault = currentVault()
  if (!vault) return false
  try {
    return fs.statSync(vault.path).isDirectory()
  } catch {
    return false
  }
}
