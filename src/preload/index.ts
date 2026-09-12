import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type ExposedApi, type IpcChannel } from '../shared/ipc-contract'

const allowed = new Set<string>(IPC_CHANNELS)

const api: ExposedApi = {
  invoke: (channel, ...args) => {
    if (!allowed.has(channel)) {
      return Promise.reject(new Error(`blocked ipc channel: ${String(channel)}`))
    }
    return ipcRenderer.invoke(channel as IpcChannel, ...args)
  },
}

contextBridge.exposeInMainWorld('api', api)
