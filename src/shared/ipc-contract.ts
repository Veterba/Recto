/**
 * The typed trust boundary. Imported by main, preload and renderer.
 * Every channel the renderer can reach is listed here and nowhere else.
 */

export const VAULT_STATE_DIR = '.obsidian-like'

export type VaultInfo = {
  /** Absolute path. Main-process side only ever; renderer treats it as opaque. */
  path: string
  /** Basename, for display. */
  name: string
}

/** Why the app is showing the first-run screen instead of a vault. */
export type StartupState =
  | { kind: 'needs-vault'; reason: 'first-run' | 'missing' | 'unreadable'; lastPath?: string }
  | { kind: 'ready'; vault: VaultInfo }

export type OpenVaultResult =
  | { ok: true; vault: VaultInfo; scaffolded: boolean }
  | { ok: false; error: string }
  | { ok: false; cancelled: true }

/**
 * One JSON file per feature inside `.obsidian-like/`, named by feature id.
 * Human-editable, individually deletable, diffable in git - Obsidian's pattern.
 * The id is a bare name: no slashes, no dots, no traversal.
 */
export type StateFeature = string

/** Invoke channels: renderer -> main, request/response. */
export type IpcApi = {
  'app:startup-state': () => StartupState
  'app:platform': () => { platform: NodeJS.Platform; version: string }
  'vault:pick': () => OpenVaultResult
  'vault:open': (path: string) => OpenVaultResult
  'vault:close': () => StartupState
  'shell:open-external': (url: string) => { ok: boolean }
  'state:read': (feature: StateFeature) => unknown
  'state:write': (feature: StateFeature, data: unknown) => { ok: boolean; error?: string }
}

export type IpcChannel = keyof IpcApi
export type IpcRequest<C extends IpcChannel> = Parameters<IpcApi[C]>
export type IpcResponse<C extends IpcChannel> = Awaited<ReturnType<IpcApi[C]>>

/** The single object exposed on `window.api`. Keep this surface small. */
export type ExposedApi = {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcRequest<C>): Promise<IpcResponse<C>>
}

export const IPC_CHANNELS: readonly IpcChannel[] = [
  'app:startup-state',
  'app:platform',
  'vault:pick',
  'vault:open',
  'vault:close',
  'shell:open-external',
  'state:read',
  'state:write',
] as const
