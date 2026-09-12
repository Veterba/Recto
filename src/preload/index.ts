import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  IPC_EVENT_CHANNELS,
  type ExposedApi,
  type IpcChannel,
  type IpcEventChannel,
} from '../shared/ipc-contract'

const invokable = new Set<string>(IPC_CHANNELS)
const subscribable = new Set<string>(IPC_EVENT_CHANNELS)

const api: ExposedApi = {
  invoke: (channel, ...args) => {
    if (!invokable.has(channel)) {
      return Promise.reject(new Error(`blocked ipc channel: ${String(channel)}`))
    }
    return ipcRenderer.invoke(channel as IpcChannel, ...args)
  },

  on: (channel, listener) => {
    if (!subscribable.has(channel)) throw new Error(`blocked event channel: ${String(channel)}`)
    // The IpcRendererEvent is deliberately not forwarded: it carries `sender`,
    // which would hand the renderer a way back into main outside this bridge.
    const wrapped = (_event: unknown, ...args: unknown[]): void => {
      ;(listener as (...a: unknown[]) => void)(...args)
    }
    ipcRenderer.on(channel as IpcEventChannel, wrapped)
    return () => ipcRenderer.off(channel as IpcEventChannel, wrapped)
  },
}

contextBridge.exposeInMainWorld('api', api)
