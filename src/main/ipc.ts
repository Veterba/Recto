import { BrowserWindow, ipcMain, shell } from 'electron'
import type { IpcApi } from '../shared/ipc-contract'
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

/** Restart the watcher whenever the open vault changes. */
function rewatch(): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (window) startWatching(window)
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
  handle('state:read', (feature) => readState(feature))
  handle('state:write', (feature, data) => writeState(feature, data))
  handle('shell:open-external', async (url) => {
    if (!/^https?:\/\//.test(url)) return { ok: false }
    await shell.openExternal(url)
    return { ok: true }
  })
}
