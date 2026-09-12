import type { ExposedApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    api: ExposedApi
  }
}

/**
 * Deferred on purpose: reading `window.api` at module scope makes every module
 * that imports this one unloadable outside a browser, which silently breaks
 * unit tests of otherwise pure code.
 */
export const api: ExposedApi = {
  invoke: (channel, ...args) => window.api.invoke(channel, ...args),
  on: (channel, listener) => window.api.on(channel, listener),
}
