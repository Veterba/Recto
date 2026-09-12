import { ipcMain, shell } from 'electron'
import type { IpcApi } from '../shared/ipc-contract'
import { closeVault, openVault, pickVault, startupState } from './vault'

/** Typed handler registration - the channel name and its signature stay in sync. */
function handle<C extends keyof IpcApi>(
  channel: C,
  fn: (...args: Parameters<IpcApi[C]>) => ReturnType<IpcApi[C]> | Promise<ReturnType<IpcApi[C]>>,
): void {
  ipcMain.handle(channel, (_event, ...args) => fn(...(args as Parameters<IpcApi[C]>)))
}

export function registerIpc(): void {
  handle('app:startup-state', () => startupState())
  handle('app:platform', () => ({ platform: process.platform, version: process.versions.electron }))
  handle('vault:pick', () => pickVault())
  handle('vault:open', (dir) => openVault(dir))
  handle('vault:close', () => closeVault())
  handle('shell:open-external', async (url) => {
    if (!/^https?:\/\//.test(url)) return { ok: false }
    await shell.openExternal(url)
    return { ok: true }
  })
}
