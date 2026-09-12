import type { ExposedApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    api: ExposedApi
  }
}

export const api = window.api
