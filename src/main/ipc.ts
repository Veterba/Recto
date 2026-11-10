import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { ATTACHMENTS_FOLDER as ATTACHMENTS, type RenameOutcome } from '../shared/vault'
import { IPC, IPC_EVENT, type IpcApi } from '../shared/ipc'
import { sendEvent } from './events'
import * as ai from './ai'
import * as bots from './bots'
import { stopBackground } from './bots/background'
import { cancelAllQuickAsk } from './providers/quick-ask'
import * as answers from './bots/answers'
import { migrateChats } from './bots/migration'
import { migrateBoards } from './board-migration'
import { createBoardOps, ensureReadme } from './boards'
import { migrateLayout, type LayoutMigrationResult } from './layout-migration'
import { inRecto } from '../shared/recto-paths'
import { formatLink } from '../shared/obsidian-links'
import { currentLinkSettings, currentLinkVault, rememberAlwaysUpdate } from './link-context'
import type { BoardMigrationResult } from '../shared/board-migration'
import * as topics from './topics/service'
import * as topicCommands from './topics/commands'
import * as topicStorage from './topics/storage'
import * as archive from './archive'
import * as overview from './overview'
import { START_PLACE } from '../shared/overview'
import { readState as readAppState, writeState as writeAppState } from './store'
import * as obsidianSync from './sync'
import { openIndexForVault, send, stopIndexer } from './index-client'
import { readState, writeState } from './state'
import * as vaultFs from './vault-fs'
import { chooseVaultFolder, closeVault, currentVault, forgetRecentVault, openVault, pickVault, recentVaults, startupState } from './vault'
import { clearKey, keyStatus, writeKey } from './secrets'
import { markSelfWrite, startWatching, stopWatching } from './watcher'
import { registerAiAccessIpc } from './vault-tools/ipc'
import { moveCanvasState, registerCanvasIpc, registerLinkPreviews } from './canvas'
import { registerPlayer } from './player'
import { registerProvidersIpc } from './providers/ipc'

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
/** One answer to Update links, shared by a run of moves; unset until asked. */
export type LinkAnswer = { update?: boolean }
/** Update links dialogs waiting for the window's answer. */
const linkAnswers = new Map<string, (answer: 'always' | 'once' | 'never') => void>()
const renameUndo = new Map<string, { from: string; to: string; entries: vaultFs.RewrittenFile[] }>()

/** Restart the watcher and the index whenever the open vault changes. */
/** What the boards migration did when this vault opened, until the app has said so. */
let boardsMigration: BoardMigrationResult = { state: 'none' }

/** boards.json to board notes, once (main/board-migration.ts); a failure is said, and the vault opens anyway. */
function runBoardsMigration(vault: string, names: Record<string, string> = {}): BoardMigrationResult {
  try {
    return migrateBoards(vault, names)
  } catch (err) {
    console.error('[boards] migration', err)
    return { state: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
}

/** What the layout migration did when this vault opened, until the app has said so. */
let layoutMigration: LayoutMigrationResult = { state: 'none' }

/**
 * The AI work of the vault going: answers in the chats and in Quick ask, and
 * the background cards and vectors. Left running, an answer saved its topic
 * into the next vault and its tools read the next vault's notes.
 */
function windDownAi(): void {
  void bots.stopAnswers()
  cancelAllQuickAsk()
  stopBackground()
}

/** tasks/ and chats/ into Recto/, once (main/layout-migration.ts); a failure is said, and the vault opens anyway. */
function runLayoutMigration(vault: string): LayoutMigrationResult {
  try {
    const result = migrateLayout(vault)
    // What follows a note by its path - authorship, the overview's edits - follows it here too.
    if (result.state === 'migrated')
      for (const move of result.moves) {
        moveAuthorship(move.from, move.to)
        overview.moved(move.from, move.to)
      }
    return result
  } catch (err) {
    console.error('[layout] migration', err)
    return { state: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
}

const movedBy = (result: LayoutMigrationResult): { from: string; to: string }[] => (result.state === 'migrated' ? result.moves : [])

function rewatch(): void {
  // Before the watcher starts, so the files it moves are not reported as edits.
  const vault = currentVault()
  boardsMigration = vault === null ? { state: 'none' } : runBoardsMigration(vault.path)
  // Bots on or off is decided first, from the vault as it is: the migrations
  // below make a chats folder, which would read as "has bots".
  const botsOn = vault !== null && bots.botsEnabled()
  // After the boards migration, which writes boards into tasks/; while it
  // waits for names, so does this.
  layoutMigration =
    vault === null || boardsMigration.state === 'conflicts' || boardsMigration.state === 'failed'
      ? { state: 'none' }
      : runLayoutMigration(vault.path)
  if (vault !== null && botsOn) {
    try {
      const report = migrateChats(vault.path)
      if (report !== null) console.log(`[bots] chats became Recto's topics: ${report.moved.length} moved, ${report.skipped.length} skipped`)
    } catch (err) {
      console.error('[bots] chat migration', err)
    }
  }
  const window = BrowserWindow.getAllWindows()[0]
  if (window) startWatching(window)
  // Topics reads the index, so it starts once the index is open.
  const moved = movedBy(layoutMigration)
  void openIndexForVault(moved)
    .then(async () => {
      for (const move of moved) await topicCommands.moved(move.from, move.to).catch((err: unknown) => console.error('[topics]', err))
      // Edits before counting began, from version history, once; and the
      // day's first word count, taken before anything is typed into it.
      await overview.backfillEdits().catch((err: unknown) => console.error('[overview]', err))
      await overview.countWords(overview.todayHere())
    })
    .then(() => topics.start())
    .then(() => bots.startBackground())
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
  // Edits still waiting for their batch are written before the app goes.
  app.on('before-quit', () => void overview.flushStats())
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
    // What the overview counted here is written to this vault, not the next.
    void overview.flushStats()
    windDownAi()
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
    void overview.flushStats()
    windDownAi()
    stopWatching()
    topics.stop()
    stopIndexer()
    // A closed vault must not keep syncing in the background.
    obsidianSync.stopAll()
    return closeVault()
  })

  registerAiAccessIpc(handle)
  registerProvidersIpc(handle)
  registerCanvasIpc(handle)
  registerLinkPreviews(handle)
  registerPlayer(handle)
  handle(IPC.fsTree, () => vaultFs.listTree())
  handle(IPC.fsOutsideLinks, () => vaultFs.takeOutsideLinks())
  handle(IPC.fsRead, (p) => vaultFs.readFile(p))
  handle(IPC.fsReadText, (p) => vaultFs.readText(p))
  handle(IPC.fsWrite, (p, content) => {
    // Declared BEFORE the write, or the watcher event can arrive first and be
    // mistaken for an external edit.
    markSelfWrite(p)
    return vaultFs.writeFile(p, content)
  })
  handle(IPC.fsCreate, async (parent, name, kind, onTaken) => {
    markSelfWrite(parent === '' ? name : `${parent}/${name}`)
    const created = await vaultFs.create(parent, name, kind, onTaken)
    const vault = currentVault()
    if (created.ok && vault !== null && inRecto(parent)) ensureReadme(vault.path)
    return created
  })
  /**
   * Obsidian's Update links dialog, in the window: "Always update" turns the
   * vault's setting on (link-context.ts), "Just once" updates this time, "Do
   * not update" leaves the links. One answer serves a whole run of moves.
   */
  async function askToUpdate(plan: vaultFs.LinkPlan, asked: LinkAnswer): Promise<boolean> {
    if (asked.update !== undefined) return asked.update
    const win = BrowserWindow.getAllWindows()[0]
    // Nobody to ask: links are kept working, as they always were.
    if (win === undefined) return true
    const id = `links-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const answer = await new Promise<'always' | 'once' | 'never'>((resolve) => {
      linkAnswers.set(id, resolve)
      sendEvent(win, IPC_EVENT.linksAsk, { id, links: plan.links, files: plan.files.length })
    })
    if (answer === 'always') rememberAlwaysUpdate()
    asked.update = answer !== 'never'
    return asked.update
  }
  handle(IPC.linksAnswer, (id, answer) => {
    linkAnswers.get(id)?.(answer)
    linkAnswers.delete(id)
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
    /** One answer to Update links for a run of moves - a board's folder, file by file. */
    asked: LinkAnswer = {},
  ): Promise<RenameOutcome | { ok: false; error: string }> {
    // The vault as it is BEFORE the move: what each link meant is read from it.
    const before = currentLinkVault()

    // And the canvases that have it on them (or anything in it, for a folder).
    let canvases: string[] = []
    try {
      const response = await send({ kind: 'canvas-referrers', path: from }, 15_000)
      if (response.kind === 'canvases-result') canvases = response.canvases
    } catch {
      // No index: no canvas rewrite.
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
    moveCanvasState(from, moved.path)
    overview.moved(from, moved.path)
    void topicCommands.moved(from, moved.path).catch((err: unknown) => console.error('[topics]', err))

    // Every file that moved: this one, or everything in a folder.
    const moves = new Map<string, string>()
    for (const file of before.byPath.values())
      if (file.path === from) moves.set(from, moved.path)
      else if (file.path.startsWith(`${from}/`)) moves.set(file.path, `${moved.path}${file.path.slice(from.length)}`)
    const settings = currentLinkSettings()
    const plan = await vaultFs.planLinkUpdates(moves, before, currentLinkVault(), settings)
    const update = plan.links > 0 && (settings.alwaysUpdateLinks || (await askToUpdate(plan, asked)))
    const links = update ? await vaultFs.applyLinkPlan(plan) : { changed: [], links: 0 }
    // A canvas moved itself is not one of its own referrers.
    const onCanvases = await vaultFs.rewriteCanvasesTo(canvases.filter((c) => c !== from), from, moved.path)
    const rewrite = { changed: [...links.changed, ...onCanvases], links: links.links + onCanvases.length }
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
  const boardOps = createBoardOps({
    relocate,
    listBoards: async () => {
      const response = await send({ kind: 'boards' }, 30_000)
      return response.kind === 'boards-result' ? response.boards.map((b) => b.path) : []
    },
  })
  handle(IPC.fsSameNamed, (fileName) => vaultFs.sameNamed(fileName))
  handle(IPC.fsExisting, (paths) => vaultFs.existing(paths))
  handle(IPC.linksSettings, () => currentLinkSettings())
  handle(IPC.linksFormat, (target, source, opts) => formatLink(target, source, currentLinkVault(), currentLinkSettings(), opts))
  handle(IPC.boardsPlace, (cards, boards) => boardOps.placeCards(cards, boards))
  handle(IPC.boardsRename, (p, name) => boardOps.renameBoard(p, name))
  handle(IPC.boardsDelete, (p, choice) => boardOps.deleteBoard(p, choice))
  handle(IPC.boardsUndoDelete, (undoId) => boardOps.undoDelete(undoId))
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
    // A canvas's folded nodes go back with it.
    if (back.ok) moveCanvasState(entry.from, entry.to)
    const { restored } = await vaultFs.restoreContents(entry.entries)
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
  handle(IPC.fsOpenWithApp, (p) => vaultFs.openWithApp(p))
  handle(IPC.fsReadBytes, (p) => vaultFs.readBytes(p))
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

  handle(IPC.fsImportFiles, async () => {
    const picked = await dialog.showOpenDialog({
      title: 'Add files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Images, video, audio and PDF',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'heic', 'mp4', 'mov', 'webm', 'm4v', 'mp3', 'm4a', 'wav', 'ogg', 'flac', 'pdf'],
        },
        { name: 'All files', extensions: ['*'] },
      ],
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

  handle(IPC.botsList, () => bots.list())
  handle(IPC.botsEnabled, () => bots.botsEnabled())
  handle(IPC.botsSetEnabled, (on) => bots.setEnabled(on))
  handle(IPC.botsStatus, (model, warm) => bots.status(model, warm === true))
  handle(IPC.botsWarm, (botId) => bots.warm(botId))
  handle(IPC.botsMemory, () => bots.memoryStatus())
  handle(IPC.botsSettings, () => bots.settings())
  handle(IPC.botsSetSettings, (patch) => bots.setSettings(patch))
  handle(IPC.botsSend, (request) =>
    bots.botsEnabled() ? answers.send(request) : { ok: false as const, error: 'Bots are off. Turn them on in Settings → Bots.' },
  )
  handle(IPC.botsCancel, (target, discard) => ({ ok: answers.jobs.cancel(target, discard === true) > 0 }))
  handle(IPC.botsRetry, (request) => answers.retry(request))
  handle(IPC.botsJobs, () => answers.jobs.list())
  handle(IPC.botsViewing, (view) => {
    answers.setViewing(view)
    return { ok: true }
  })
  handle(IPC.botsSetModel, (botId, model) => bots.setModel(botId, model))
  handle(IPC.botsTitle, (request) => bots.title(request))
  handle(IPC.botsModels, () => bots.models())
  handle(IPC.botsPull, (name) => bots.pull(name))
  handle(IPC.botsPullCancel, () => bots.cancelPull())
  handle(IPC.botsCards, () => bots.cardsStatus())

  handle(IPC.indexSearch, async (query, limit) => {
    const response = await send({ kind: 'search', query, ...(limit === undefined ? {} : { limit }) }, 15_000)
    return response.kind === 'search-result' ? response.hits : []
  })
  handle(IPC.indexCanvasesOf, async (p) => {
    const response = await send({ kind: 'canvases-of', path: p }, 15_000)
    return response.kind === 'canvases-result' ? response.canvases : []
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
  handle(IPC.overviewData, (today, now) => overview.overviewData(today, now).catch(() => null))
  handle(IPC.overviewTopics, () => overview.overviewTopics().catch(() => null))
  handle(IPC.overviewEdited, (p, day) => {
    overview.recordEdit(p, day)
    return { ok: true }
  })
  handle(IPC.overviewOpened, (p, at) => {
    overview.recordOpened(p, at)
    return { ok: true }
  })
  handle(IPC.overviewActive, (day, seconds) => {
    overview.recordActive(day, seconds)
    return { ok: true }
  })
  handle(IPC.boardsMigration, () => {
    const result = boardsMigration
    // Said once; conflicts stay until they are answered.
    if (result.state !== 'conflicts') boardsMigration = { state: 'none' }
    return result
  })
  handle(IPC.boardsMigrate, (names): BoardMigrationResult => {
    const vault = currentVault()
    if (vault === null) return { state: 'none' }
    // The watcher is running by now: every file this writes is reported, and indexed, like any change.
    boardsMigration = runBoardsMigration(vault.path, names)
    const result = boardsMigration
    if (result.state !== 'conflicts') boardsMigration = { state: 'none' }
    if (result.state === 'migrated' || result.state === 'none') {
      // The boards are in tasks/ now; the layout migration waited for them.
      layoutMigration = runLayoutMigration(vault.path)
      for (const move of movedBy(layoutMigration)) void send({ kind: 'note-renamed', from: move.from, to: move.to }, 15_000).catch(() => undefined)
    }
    return result
  })
  handle(IPC.layoutMigration, () => {
    const result = layoutMigration
    layoutMigration = { state: 'none' }
    return result
  })
  handle(IPC.overviewPlace, () => readAppState().overviewPlace ?? START_PLACE)
  handle(IPC.overviewSetPlace, (place) => {
    writeAppState({ overviewPlace: place })
    return { ok: true }
  })
  handle(IPC.indexResolveLink, async (target, source) => {
    const response = await send({ kind: 'resolve-link', target, source }, 15_000)
    return response.kind === 'resolve-link-result' ? response.path : null
  })
  handle(IPC.indexResolveLinks, async (targets, source) => {
    if (targets.length === 0) return {}
    const response = await send({ kind: 'resolve-links', targets, source }, 15_000)
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
  handle(IPC.indexCards, async (targets, board) => {
    const response = await send({ kind: 'board-cards', targets, board }, 30_000)
    return response.kind === 'board-cards-result' ? response.cards : {}
  })
  handle(IPC.indexBoards, async () => {
    const response = await send({ kind: 'boards' }, 30_000)
    return response.kind === 'boards-result' ? response.boards : []
  })
  handle(IPC.indexCardPlaces, async () => {
    const response = await send({ kind: 'card-places' }, 30_000)
    return response.kind === 'card-places-result' ? response.places : []
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
