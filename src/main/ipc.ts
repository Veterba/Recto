import { BrowserWindow, ipcMain, shell } from 'electron'
import type { IpcApi, RenameOutcome } from '../shared/ipc-contract'
import * as archive from './archive'
import { openIndexForVault, send, stopIndexer } from './index-client'
import { readState, writeState } from './state'
import * as vaultFs from './vault-fs'
import { closeVault, openVault, pickVault, startupState } from './vault'
import { markSelfWrite, startWatching, stopWatching } from './watcher'

/** Typed handler registration - the channel name and its signature stay in sync. */
function handle<C extends keyof IpcApi>(
  channel: C,
  fn: (...args: Parameters<IpcApi[C]>) => ReturnType<IpcApi[C]> | Promise<ReturnType<IpcApi[C]>>,
): void {
  ipcMain.handle(channel, (_event, ...args) => fn(...(args as Parameters<IpcApi[C]>)))
}

/**
 * Undo state for link rewrites, keyed by an opaque id.
 *
 * In memory only and capped: this is for "that rename was a mistake, put it
 * back" in the next minute, not a history feature.
 */
const renameUndo = new Map<string, { from: string; to: string; entries: { path: string; before: string }[] }>()

/** Restart the watcher and the index whenever the open vault changes. */
function rewatch(): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (window) startWatching(window)
  void openIndexForVault().catch((err: unknown) => console.error('[indexer]', err))
  // Retention is enforced on open rather than on a timer: the app may not be
  // running on the day something expires, and a check at open always catches up.
  void archive.purgeExpired().catch((err: unknown) => console.error('[archive]', err))
}

export function registerIpc(): void {
  handle('app:startup-state', () => {
    const state = startupState()
    if (state.kind === 'ready') rewatch()
    return state
  })
  handle('app:platform', () => ({ platform: process.platform, version: process.versions.electron }))
  handle('vault:pick', async () => {
    const result = await pickVault()
    if (result.ok) rewatch()
    return result
  })
  handle('vault:open', (dir) => {
    const result = openVault(dir)
    if (result.ok) rewatch()
    return result
  })
  handle('vault:close', () => {
    stopWatching()
    stopIndexer()
    return closeVault()
  })

  handle('fs:tree', () => vaultFs.listTree())
  handle('fs:read', (p) => vaultFs.readFile(p))
  handle('fs:write', (p, content) => {
    // Declared BEFORE the write, or the watcher event can arrive first and be
    // mistaken for an external edit.
    markSelfWrite(p)
    return vaultFs.writeFile(p, content)
  })
  handle('fs:create', (parent, name, kind) => {
    markSelfWrite(parent === '' ? name : `${parent}/${name}`)
    return vaultFs.create(parent, name, kind)
  })
  handle('fs:rename', async (p, newName) => {
    // Collect the referring notes BEFORE the rename: afterwards the index no
    // longer knows anything points at the old path.
    let sources: string[] = []
    try {
      const response = await send({ kind: 'backlinks', path: p }, 15_000)
      if (response.kind === 'backlinks-result') {
        sources = [...new Set(response.links.map((link) => link.path))]
      }
    } catch {
      // No index: the rename still happens, links just are not rewritten. Said
      // so in the result rather than silently pretending it worked.
    }

    const renamed = await vaultFs.rename(p, newName)
    if (!renamed.ok) return renamed

    const rewrite = await vaultFs.rewriteLinksTo(sources, p, renamed.path)
    let undoId: string | undefined
    if (rewrite.changed.length > 0) {
      undoId = `undo-${Date.now().toString(36)}`
      renameUndo.set(undoId, { from: renamed.path, to: p, entries: rewrite.changed })
      // One level of undo is enough for an accident; keeping every rename
      // forever would be an unbounded in-memory copy of the vault.
      if (renameUndo.size > 10) renameUndo.delete([...renameUndo.keys()][0] ?? '')
    }

    const outcome: RenameOutcome = {
      ok: true,
      path: renamed.path,
      rewrittenFiles: rewrite.changed.length,
      rewrittenLinks: rewrite.links,
      ...(undoId === undefined ? {} : { undoId }),
    }
    return outcome
  })

  handle('links:undo-rename', async (undoId) => {
    const entry = renameUndo.get(undoId)
    if (!entry) return { ok: false, restored: 0, error: 'That undo is no longer available.' }
    renameUndo.delete(undoId)
    // Put the note name back too, or the restored links would point at nothing.
    const back = await vaultFs.rename(entry.from, entry.to.slice(entry.to.lastIndexOf('/') + 1))
    const restored = await vaultFs.restoreContents(entry.entries)
    return { ok: back.ok, restored }
  })
  // Deleting from the UI archives; `fs:trash` remains for a real, immediate delete.
  handle('fs:trash', (p) => vaultFs.trash(p))
  handle('archive:add', (p) => archive.archive(p))
  handle('archive:list', () => archive.list())
  handle('archive:restore', (id) => archive.restore(id))
  handle('archive:purge', (id) => archive.purge(id))
  handle('archive:set-retention', (days) => archive.setRetention(days))
  handle('fs:move', (p, newParent) => vaultFs.move(p, newParent))
  handle('fs:reveal', (p) => vaultFs.reveal(p))

  handle('index:search', async (query, limit) => {
    const response = await send({ kind: 'search', query, ...(limit === undefined ? {} : { limit }) }, 15_000)
    return response.kind === 'search-result' ? response.hits : []
  })
  handle('index:backlinks', async (p) => {
    const response = await send({ kind: 'backlinks', path: p }, 15_000)
    return response.kind === 'backlinks-result' ? response.links : []
  })
  handle('index:stats', async () => {
    const response = await send({ kind: 'stats' }, 15_000)
    return response.kind === 'stats-result'
      ? { notes: response.notes, links: response.links, unresolved: response.unresolved, tags: response.tags }
      : { notes: 0, links: 0, unresolved: 0, tags: 0 }
  })
  handle('index:resolve-link', async (target) => {
    const response = await send({ kind: 'resolve-link', target }, 15_000)
    return response.kind === 'resolve-link-result' ? response.path : null
  })
  handle('index:resolve-links', async (targets) => {
    if (targets.length === 0) return {}
    const response = await send({ kind: 'resolve-links', targets }, 15_000)
    return response.kind === 'resolve-links-result' ? response.resolved : {}
  })
  handle('index:unresolved', async () => {
    const response = await send({ kind: 'unresolved' }, 15_000)
    return response.kind === 'unresolved-result' ? response.entries : []
  })
  handle('index:reindex', async () => {
    await send({ kind: 'reindex', force: true })
    return { ok: true }
  })
  handle('state:read', (feature) => readState(feature))
  handle('state:write', (feature, data) => writeState(feature, data))
  handle('shell:open-external', async (url) => {
    if (!/^https?:\/\//.test(url)) return { ok: false }
    await shell.openExternal(url)
    return { ok: true }
  })
}
