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

/** A node in the vault tree. Paths are vault-relative, POSIX-separated. */
export type FileNode = {
  /** Vault-relative path, e.g. 'work/nordicsync.md'. '' is the root. */
  path: string
  name: string
  kind: 'file' | 'folder'
  /** Present on folders only. */
  children?: FileNode[]
  /** Present on files only; used to decide whether a reindex is needed. */
  mtime?: number
  size?: number
}

/** What the watcher reports. One event per path, already debounced by chokidar. */
export type VaultChange =
  | { type: 'add' | 'change' | 'unlink'; path: string; mtime?: number; size?: number }
  | { type: 'addDir' | 'unlinkDir'; path: string }
  | { type: 'ready' }

/** Push channels: main -> renderer. Subscribed through `api.on`. */
export type IpcEvents = {
  'vault:changed': (changes: VaultChange[]) => void
}

export type IpcEventChannel = keyof IpcEvents

export const IPC_EVENT_CHANNELS: readonly IpcEventChannel[] = ['vault:changed'] as const

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
  'fs:tree': () => FileNode[]
  'fs:read': (path: string) => { ok: true; content: string } | { ok: false; error: string }
  'fs:write': (path: string, content: string) => { ok: boolean; error?: string }
  'fs:create': (
    parentPath: string,
    name: string,
    kind: 'file' | 'folder',
  ) => { ok: true; path: string } | { ok: false; error: string }
  'fs:rename': (path: string, newName: string) => { ok: true; path: string } | { ok: false; error: string }
  'fs:trash': (path: string) => { ok: boolean; error?: string }
  'fs:move': (path: string, newParent: string) => { ok: true; path: string } | { ok: false; error: string }
  'fs:reveal': (path: string) => { ok: boolean }
  'index:search': (query: string, limit?: number) => SearchResult[]
  'index:backlinks': (path: string) => BacklinkResult[]
  'index:stats': () => IndexStats
  'index:reindex': () => { ok: boolean }
  'archive:add': (path: string) => { ok: true; id: string } | { ok: false; error: string }
  'archive:list': () => ArchiveState
  'archive:restore': (id: string) => { ok: true; path: string } | { ok: false; error: string }
  'archive:purge': (id: string) => { ok: boolean; error?: string }
  'archive:set-retention': (days: number) => ArchiveState
}

/** One archived item. `originalPath` is where restore puts it back. */
export type ArchiveEntry = {
  id: string
  originalPath: string
  name: string
  kind: 'file' | 'folder'
  deletedAt: number
  size: number
}

export type ArchiveState = {
  /** Days before an archived item goes to the OS trash. 0 means keep forever. */
  retentionDays: number
  entries: ArchiveEntry[]
}

/** A full-text hit. `snippet` marks matches with << >> for the UI to highlight. */
export type SearchResult = { path: string; snippet: string; score: number }
export type BacklinkResult = { path: string; line: number; alias: string | null }
export type IndexStats = { notes: number; links: number; unresolved: number; tags: number }

export type IpcChannel = keyof IpcApi
export type IpcRequest<C extends IpcChannel> = Parameters<IpcApi[C]>
export type IpcResponse<C extends IpcChannel> = Awaited<ReturnType<IpcApi[C]>>

/** The single object exposed on `window.api`. Keep this surface small. */
export type ExposedApi = {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcRequest<C>): Promise<IpcResponse<C>>
  /** Subscribe to a push channel. Returns an unsubscribe function. */
  on<C extends IpcEventChannel>(channel: C, listener: IpcEvents[C]): () => void
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
  'fs:tree',
  'fs:read',
  'fs:write',
  'fs:create',
  'fs:rename',
  'fs:trash',
  'fs:move',
  'fs:reveal',
  'index:search',
  'index:backlinks',
  'index:stats',
  'index:reindex',
  'archive:add',
  'archive:list',
  'archive:restore',
  'archive:purge',
  'archive:set-retention',
] as const
