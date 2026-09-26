import { BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { ATTACHMENTS_FOLDER as ATTACHMENTS, type RenameOutcome } from '../shared/vault'
import { IPC, type IpcApi } from '../shared/ipc'
import * as ai from './ai'
import * as topics from './topics/service'
import * as topicCommands from './topics/commands'
import * as topicStorage from './topics/storage'
import * as archive from './archive'
import * as obsidianSync from './sync'
import { openIndexForVault, send, stopIndexer } from './index-client'
import { readState, writeState } from './state'
import * as vaultFs from './vault-fs'
import { chooseVaultFolder, closeVault, currentVault, forgetRecentVault, openVault, pickVault, recentVaults, startupState } from './vault'
import { clearKey, keyStatus, writeKey } from './secrets'
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
  // Topics reads the index, so it starts once the index is open.
  void openIndexForVault()
    .then(() => topics.start())
    .catch((err: unknown) => console.error('[indexer]', err))
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
  handle(IPC.appStartupState, () => {
    const state = startupState()
    if (state.kind === 'ready') rewatch()
    return state
  })
  handle(IPC.appPlatform, () => ({ platform: process.platform, version: process.versions.electron }))
  handle(IPC.vaultPick, async () => {
    const result = await pickVault()
    if (result.ok) rewatch()
    return result
  })
  handle(IPC.vaultOpen, (dir) => {
    const result = openVault(dir)
    if (result.ok) rewatch()
    return result
  })
  handle(IPC.vaultRecent, () => recentVaults())
  handle(IPC.vaultForgetRecent, (p) => forgetRecentVault(p))
  handle(IPC.appClipboardText, () => clipboard.readText())
  handle(IPC.vaultChooseFolder, () => chooseVaultFolder())
  handle(IPC.vaultSwitch, (dir) => {
    // Wind the open vault down first: its watcher, index and sync must not keep
    // running against a vault that is no longer on screen.
    const previous = currentVault()
    stopWatching()
    topics.stop()
    stopIndexer()
    obsidianSync.stopAll()
    const result = openVault(dir)
    // Success or not, something is open now - the new vault, or the old one
    // still - and it needs its watcher, index and sync back.
    if (result.ok || previous !== null) rewatch()
    return result
  })
  handle(IPC.vaultClose, () => {
    stopWatching()
    topics.stop()
    stopIndexer()
    // A closed vault must not keep syncing in the background.
    obsidianSync.stopAll()
    return closeVault()
  })

  handle(IPC.fsTree, () => vaultFs.listTree())
  handle(IPC.fsRead, (p) => vaultFs.readFile(p))
  handle(IPC.fsWrite, (p, content) => {
    // Declared BEFORE the write, or the watcher event can arrive first and be
    // mistaken for an external edit.
    markSelfWrite(p)
    return vaultFs.writeFile(p, content)
  })
  handle(IPC.fsCreate, (parent, name, kind) => {
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
    void topicCommands.moved(from, moved.path).catch((err: unknown) => console.error('[topics]', err))

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

  handle(IPC.fsRename, (p, newName) => relocate(p, () => vaultFs.rename(p, newName)))
  handle(IPC.fsMove, (p, newParent) => relocate(p, () => vaultFs.move(p, newParent)))

  handle(IPC.linksUndoRename, async (undoId) => {
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
  handle(IPC.fsTrash, (p) => vaultFs.trash(p))
  handle(IPC.historyList, async (p) => {
    const response = await send({ kind: 'history', path: p }, 15_000)
    return response.kind === 'history-result' ? response.snapshots : []
  })
  handle(IPC.historyGet, async (id) => {
    const response = await send({ kind: 'history-get', id }, 15_000)
    return response.kind === 'history-get-result' ? response.snapshot : null
  })
  handle(IPC.historyRestore, async (id) => {
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
  handle(IPC.archiveAdd, (p) => archive.archive(p))
  handle(IPC.archiveList, () => archive.list())
  handle(IPC.archiveRestore, (id) => archive.restore(id))
  handle(IPC.archivePurge, (id) => archive.purge(id))
  handle(IPC.archiveSetRetention, (days) => archive.setRetention(days))
  handle(IPC.appSetVibrancy, (material) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win === undefined || process.platform !== 'darwin') return { ok: false }
    win.setVibrancy(material)
    return { ok: true }
  })
  handle(IPC.appSetThemeSource, (source) => {
    // Drives the NSVisualEffectView variant behind the whole window, so the
    // app's theme and the blur's own appearance cannot disagree.
    nativeTheme.themeSource = source
    return { ok: true }
  })
  handle(IPC.fsReveal, (p) => vaultFs.reveal(p))
  handle(IPC.fsImportImages, async () => {
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

  handle(IPC.fsImportData, async (name, data) => {
    // The renderer sends a Uint8Array; structured clone can hand it over as a
    // plain object shape depending on the bridge, so normalise before writing.
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(Object.values(data as object) as number[])
    return vaultFs.importData(name, bytes, ATTACHMENTS)
  })

  handle(IPC.appIsFullscreen, () => BrowserWindow.getAllWindows()[0]?.isFullScreen() ?? false)

  handle(IPC.obsidianVaults, () => obsidianSync.detectVaults())
  handle(IPC.obsidianPick, () => obsidianSync.pickFolder())
  handle(IPC.obsidianStatus, () => obsidianSync.status())
  handle(IPC.obsidianPreview, (p) => obsidianSync.preview(p))
  handle(IPC.obsidianEnable, (p) => obsidianSync.enable(p))
  handle(IPC.obsidianDisable, () => obsidianSync.disable())
  handle(IPC.obsidianSyncNow, (force) => obsidianSync.syncNow(force === true))

  handle(IPC.aiKeyStatus, () => keyStatus())
  handle(IPC.aiSetKey, (key) => {
    const result = writeKey(key)
    // The client caches the key it was built with, so a new key needs a new one.
    if (result.ok) ai.resetProvider()
    return result
  })
  handle(IPC.aiClearKey, () => {
    clearKey()
    ai.resetProvider()
    return { ok: true }
  })
  handle(IPC.aiTest, (model) => ai.test(model))
  handle(IPC.aiSend, (request) => ai.startStream(request))
  handle(IPC.aiCancel, (id) => ai.cancel(id))

  handle(IPC.indexSearch, async (query, limit) => {
    const response = await send({ kind: 'search', query, ...(limit === undefined ? {} : { limit }) }, 15_000)
    return response.kind === 'search-result' ? response.hits : []
  })
  handle(IPC.indexBacklinks, async (p) => {
    const response = await send({ kind: 'backlinks', path: p }, 15_000)
    return response.kind === 'backlinks-result' ? response.links : []
  })
  handle(IPC.indexStats, async () => {
    const response = await send({ kind: 'stats' }, 15_000)
    return response.kind === 'stats-result'
      ? { notes: response.notes, links: response.links, unresolved: response.unresolved, tags: response.tags }
      : { notes: 0, links: 0, unresolved: 0, tags: 0 }
  })
  handle(IPC.indexVaultUsage, async () => {
    const response = await send({ kind: 'vault-usage' }, 15_000)
    return response.kind === 'vault-usage-result'
      ? response.usage
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
  handle(IPC.indexResolveLink, async (target) => {
    const response = await send({ kind: 'resolve-link', target }, 15_000)
    return response.kind === 'resolve-link-result' ? response.path : null
  })
  handle(IPC.indexResolveLinks, async (targets) => {
    if (targets.length === 0) return {}
    const response = await send({ kind: 'resolve-links', targets }, 15_000)
    return response.kind === 'resolve-links-result' ? response.resolved : {}
  })
  handle(IPC.indexUnresolved, async () => {
    const response = await send({ kind: 'unresolved' }, 15_000)
    return response.kind === 'unresolved-result' ? response.entries : []
  })
  handle(IPC.indexGraph, async () => {
    const response = await send({ kind: 'graph', autoProperty: 'topics' }, 30_000)
    return response.kind === 'graph-result' ? response.graph : { nodes: [], edges: [] }
  })
  handle(IPC.indexBoard, async (board) => {
    const response = await send({ kind: 'board', board }, 30_000)
    return response.kind === 'board-result' ? response.cards : []
  })
  handle(IPC.indexBoards, async () => {
    const response = await send({ kind: 'boards' }, 30_000)
    return response.kind === 'boards-result' ? response.boards : []
  })
  handle(IPC.indexContext, async () => {
    const response = await send({ kind: 'context' }, 30_000)
    return response.kind === 'context-result' ? response.notes : []
  })
  handle(IPC.indexReindex, async () => {
    await send({ kind: 'reindex', force: true })
    return { ok: true }
  })
  handle(IPC.topicsSettings, () => topicStorage.readSettings())
  handle(IPC.topicsSetSettings, (patch) => topics.updateSettings(patch))
  handle(IPC.topicsStatus, () => topics.status())
  handle(IPC.topicsDownload, () => {
    void topics.download()
    return { ok: true }
  })
  handle(IPC.topicsList, () => topicCommands.list())
  handle(IPC.topicsRename, (id, name) => topicCommands.rename(id, name))
  handle(IPC.topicsDelete, async (id) => {
    await topicCommands.remove(id)
    return { ok: true }
  })
  handle(IPC.topicsRebuild, async () => {
    await topicCommands.rebuild()
    return { ok: true }
  })
  handle(IPC.topicsPreview, () => topicCommands.preview())
  handle(IPC.topicsSeen, () => {
    topicCommands.seen()
    return { ok: true }
  })
  handle(IPC.topicsUndoLastRun, async () => ({ ok: true, changes: await topicCommands.undoLastRun() }))
  handle(IPC.stateRead, (feature) => readState(feature))
  handle(IPC.stateWrite, (feature, data) => writeState(feature, data))
  handle(IPC.shellOpenExternal, async (url) => {
    if (!/^https?:\/\//.test(url)) return { ok: false }
    await shell.openExternal(url)
    return { ok: true }
  })
}
