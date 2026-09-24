import { BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { ATTACHMENTS_FOLDER as ATTACHMENTS, type IpcApi, type RenameOutcome } from '../shared/ipc-contract'
import * as ai from './ai'
import * as archive from './archive'
import * as obsidianSync from './sync'
import { openIndexForVault, send, stopIndexer } from './index-client'
import { readState, writeState } from './state'
import * as vaultFs from './vault-fs'
import { chooseVaultFolder, closeVault, currentVault, openVault, pickVault, recentVaults, startupState } from './vault'
import { clearKey, keyStatus, writeKey } from './secrets'
import { markSelfWrite, startWatching, stopWatching } from './watcher'

/** Where images land. A folder in the vault, so the vault stays portable. */

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
  // Old snapshots go on vault open, for the same reason archive retention does:
  // the app may not be running on the day something expires.
  void send({ kind: 'history-prune' }, 30_000).catch(() => undefined)
  // Sync follows the open vault: each vault has its own pairing, or none.
  obsidianSync.startForCurrentVault()
}

/**
 * Authorship is kept by path in `.recto/authors.json`; a renamed note or folder
 * takes its entries with it, or its AI passages would silently turn human.
 */
function moveAuthorship(from: string, to: string): void {
  try {
    const raw = readState('authors') as { notes?: Record<string, unknown> } | null
    const notes = raw?.notes
    if (notes === undefined || notes === null || typeof notes !== 'object') return
    let changed = false
    for (const key of Object.keys(notes)) {
      const next = key === from ? to : key.startsWith(`${from}/`) ? `${to}${key.slice(from.length)}` : null
      if (next === null) continue
      notes[next] = notes[key]
      delete notes[key]
      changed = true
    }
    if (changed) writeState('authors', { ...raw, notes })
  } catch (err) {
    console.error('[authors]', err)
  }
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
  handle('vault:recent', () => recentVaults())
  handle('app:clipboard-text', () => clipboard.readText())
  handle('vault:choose-folder', () => chooseVaultFolder())
  handle('vault:switch', (dir) => {
    // Wind the open vault down first: its watcher, index and sync must not keep
    // running against a vault that is no longer on screen.
    const previous = currentVault()
    stopWatching()
    stopIndexer()
    obsidianSync.stopAll()
    const result = openVault(dir)
    // Success or not, something is open now - the new vault, or the old one
    // still - and it needs its watcher, index and sync back.
    if (result.ok || previous !== null) rewatch()
    return result
  })
  handle('vault:close', () => {
    stopWatching()
    stopIndexer()
    // A closed vault must not keep syncing in the background.
    obsidianSync.stopAll()
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
  /**
   * Rename and move are the same operation to a user: the note ends up
   * somewhere else and every link to it must follow. They were not sharing
   * this, so dragging a file into a folder silently broke its links while
   * renaming it fixed them.
   */
  async function relocate(
    from: string,
    apply: () => Promise<{ ok: true; path: string } | { ok: false; error: string }>,
  ): Promise<RenameOutcome | { ok: false; error: string }> {
    // Collect referrers BEFORE the move: afterwards the index no longer knows
    // anything pointed at the old path.
    let sources: string[] = []
    try {
      const response = await send({ kind: 'backlinks', path: from }, 15_000)
      if (response.kind === 'backlinks-result') {
        sources = [...new Set(response.links.map((link) => link.path))]
      }
    } catch {
      // No index: the move still happens, links just are not rewritten. Said in
      // the result rather than silently pretending it worked.
    }

    const moved = await apply()
    if (!moved.ok) return moved

    /**
     * Move the note's version history with it, before the watcher notices.
     *
     * The watcher reports the rename as unlink(old) + add(new), and the unlink
     * deletes the old path's snapshots. That event is at least a batching
     * interval away (chokidar settles for 120ms, the queue flushes after 60),
     * while this send happens in the same tick as the rename returning - so it
     * wins by a wide margin rather than by luck. If it ever lost, the cost is
     * losing history for a renamed note, not losing the note.
     */
    void send({ kind: 'note-renamed', from, to: moved.path }, 15_000).catch(() => undefined)
    moveAuthorship(from, moved.path)

    const rewrite = await vaultFs.rewriteLinksTo(sources, from, moved.path)
    let undoId: string | undefined
    if (rewrite.changed.length > 0) {
      undoId = `undo-${Date.now().toString(36)}`
      renameUndo.set(undoId, { from: moved.path, to: from, entries: rewrite.changed })
      // One level of undo per action, capped: enough for an accident, not an
      // unbounded in-memory copy of the vault.
      if (renameUndo.size > 10) renameUndo.delete([...renameUndo.keys()][0] ?? '')
    }

    const outcome: RenameOutcome = {
      ok: true,
      path: moved.path,
      rewrittenFiles: rewrite.changed.length,
      rewrittenLinks: rewrite.links,
      ...(undoId === undefined ? {} : { undoId }),
    }
    return outcome
  }

  handle('fs:rename', (p, newName) => relocate(p, () => vaultFs.rename(p, newName)))
  handle('fs:move', (p, newParent) => relocate(p, () => vaultFs.move(p, newParent)))

  handle('links:undo-rename', async (undoId) => {
    const entry = renameUndo.get(undoId)
    if (!entry) return { ok: false, restored: 0, error: 'That undo is no longer available.' }
    renameUndo.delete(undoId)
    // Put the note name back too, or the restored links would point at nothing.
    // `to` is the original full path: a move needs the folder back as well as
    // the name, so undo it as a move followed by a rename.
    const originalParent = entry.to.slice(0, Math.max(0, entry.to.lastIndexOf('/')))
    const currentParent = entry.from.slice(0, Math.max(0, entry.from.lastIndexOf('/')))
    let current = entry.from
    if (originalParent !== currentParent) {
      const moved = await vaultFs.move(current, originalParent)
      if (moved.ok) current = moved.path
    }
    const back = await vaultFs.rename(current, entry.to.slice(entry.to.lastIndexOf('/') + 1))
    const restored = await vaultFs.restoreContents(entry.entries)
    return { ok: back.ok, restored }
  })
  // Deleting from the UI archives; `fs:trash` remains for a real, immediate delete.
  handle('fs:trash', (p) => vaultFs.trash(p))
  handle('history:list', async (p) => {
    const response = await send({ kind: 'history', path: p }, 15_000)
    return response.kind === 'history-result' ? response.snapshots : []
  })
  handle('history:get', async (id) => {
    const response = await send({ kind: 'history-get', id }, 15_000)
    return response.kind === 'history-get-result' ? response.snapshot : null
  })
  handle('history:restore', async (id) => {
    const response = await send({ kind: 'history-get', id }, 15_000)
    if (response.kind !== 'history-get-result' || response.snapshot?.content === undefined) {
      return { ok: false, error: 'That version is no longer stored.' }
    }
    const { path: notePath, content } = response.snapshot
    // Marked as a self-write so the editor does not treat the restore as an
    // external edit and fight it - and the index still sees it, which also
    // snapshots the pre-restore content so the restore itself is undoable.
    markSelfWrite(notePath)
    const written = await vaultFs.writeFile(notePath, content)
    if (!written.ok) return { ok: false, error: written.error ?? 'Could not restore.' }
    return { ok: true, path: notePath }
  })
  handle('archive:add', (p) => archive.archive(p))
  handle('archive:list', () => archive.list())
  handle('archive:restore', (id) => archive.restore(id))
  handle('archive:purge', (id) => archive.purge(id))
  handle('archive:set-retention', (days) => archive.setRetention(days))
  handle('app:set-vibrancy', (material) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win === undefined || process.platform !== 'darwin') return { ok: false }
    win.setVibrancy(material)
    return { ok: true }
  })
  handle('app:set-theme-source', (source) => {
    // Drives the NSVisualEffectView variant behind the whole window, so the
    // app's theme and the blur's own appearance cannot disagree.
    nativeTheme.themeSource = source
    return { ok: true }
  })
  handle('fs:reveal', (p) => vaultFs.reveal(p))
  handle('fs:import-images', async () => {
    const picked = await dialog.showOpenDialog({
      title: 'Add images',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'heic'] }],
    })
    if (picked.canceled) return { ok: true as const, paths: [] }

    const paths: string[] = []
    for (const source of picked.filePaths) {
      const copied = await vaultFs.importFile(source, ATTACHMENTS)
      if (!copied.ok) return copied
      paths.push(copied.path)
    }
    return { ok: true as const, paths }
  })

  handle('fs:import-data', async (name, data) => {
    // The renderer sends a Uint8Array; structured clone can hand it over as a
    // plain object shape depending on the bridge, so normalise before writing.
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(Object.values(data as object) as number[])
    return vaultFs.importData(name, bytes, ATTACHMENTS)
  })

  handle('app:is-fullscreen', () => BrowserWindow.getAllWindows()[0]?.isFullScreen() ?? false)

  handle('obsidian:vaults', () => obsidianSync.detectVaults())
  handle('obsidian:pick', () => obsidianSync.pickFolder())
  handle('obsidian:status', () => obsidianSync.status())
  handle('obsidian:preview', (p) => obsidianSync.preview(p))
  handle('obsidian:enable', (p) => obsidianSync.enable(p))
  handle('obsidian:disable', () => obsidianSync.disable())
  handle('obsidian:sync-now', (force) => obsidianSync.syncNow(force === true))

  handle('ai:key-status', () => keyStatus())
  handle('ai:set-key', (key) => {
    const result = writeKey(key)
    // The client caches the key it was built with, so a new key needs a new one.
    if (result.ok) ai.resetProvider()
    return result
  })
  handle('ai:clear-key', () => {
    clearKey()
    ai.resetProvider()
    return { ok: true }
  })
  handle('ai:test', (model) => ai.test(model))
  handle('ai:send', (request) => ai.startStream(request))
  handle('ai:cancel', (id) => ai.cancel(id))

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
  handle('index:home-stats', async () => {
    const response = await send({ kind: 'home-stats' }, 15_000)
    return response.kind === 'home-stats-result'
      ? response.stats
      : {
          notes: 0,
          links: 0,
          unresolved: 0,
          tags: 0,
          touchedThisWeek: 0,
          weekTrend: [0, 0, 0, 0, 0, 0, 0],
          topFolders: [],
          topTags: [],
          hubs: [],
        }
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
  handle('index:graph', async () => {
    const response = await send({ kind: 'graph' }, 30_000)
    return response.kind === 'graph-result' ? response.graph : { nodes: [], edges: [] }
  })
  handle('index:board', async (board) => {
    const response = await send({ kind: 'board', board }, 30_000)
    return response.kind === 'board-result' ? response.cards : []
  })
  handle('index:boards', async () => {
    const response = await send({ kind: 'boards' }, 30_000)
    return response.kind === 'boards-result' ? response.boards : []
  })
  handle('index:context', async () => {
    const response = await send({ kind: 'context' }, 30_000)
    return response.kind === 'context-result' ? response.notes : []
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
