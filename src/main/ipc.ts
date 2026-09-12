import { BrowserWindow, ipcMain, shell } from 'electron'
import type { IpcApi } from '../shared/ipc-contract'
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

/** Restart the watcher and the index whenever the open vault changes. */
function rewatch(): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (window) startWatching(window)
  void openIndexForVault().catch((err: unknown) => console.error('[indexer]', err))
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
  handle('fs:rename', (p, newName) => vaultFs.rename(p, newName))
  handle('fs:trash', (p) => vaultFs.trash(p))
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
