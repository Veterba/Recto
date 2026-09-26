import type { BrowserWindow } from 'electron'
import type { IpcEventChannel, IpcEvents } from '../shared/ipc'

/** Push an event to a window's renderer, typed against the contract. */
export function sendEvent<C extends IpcEventChannel>(win: BrowserWindow, channel: C, ...args: Parameters<IpcEvents[C]>): void {
  win.webContents.send(channel, ...args)
}
