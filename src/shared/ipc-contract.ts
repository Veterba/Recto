/**
 * The typed trust boundary. Imported by main, preload and renderer.
 * Every channel the renderer can reach is listed here and nowhere else.
 */

export const VAULT_STATE_DIR = '.recto'

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

/**
 * Where pasted, dropped and inserted images go, at the vault root.
 *
 * Hidden from the Data tree - it is the app's storage for images you put in
 * notes, not a folder you file things into - and shown in Settings → Vault.
 */
export const ATTACHMENTS_FOLDER = 'attachments'

export type RecentVault = { path: string; name: string; available: boolean }

export type OpenVaultResult =
  | { ok: true; vault: VaultInfo; scaffolded: boolean }
  | { ok: false; error: string }
  | { ok: false; cancelled: true }

/**
 * One JSON file per feature inside `.recto/`, named by feature id.
 * Human-editable, individually deletable, diffable in git - Obsidian's pattern.
 * The id is a bare name: no slashes, no dots, no traversal.
 */
export type StateFeature = string

/**
 * How sharp the backdrop stays, sharpest first.
 *
 * `fullscreen-ui` blurs least, so shapes behind the window survive; `window`
 * blurs most, so they dissolve. AppKit exposes no blur radius, so these are
 * three materials **measured** for how much detail survives behind them. Edge
 * energy in the sidebar region, with the sidebar's own tint at 6% so the
 * material is the only variable:
 *
 *   fullscreen-ui  2.29   sidebar  1.72   window  1.27
 *
 * `window` sounds like a light material and is in fact the most obscuring of
 * the three, which is the whole reason these were measured rather than guessed.
 *
 * Not a setting any more: the app picks one per theme. The list stays because
 * the IPC channel has to validate what it is handed.
 */
export const VIBRANCY_MATERIALS = ['fullscreen-ui', 'sidebar', 'window'] as const

export type VibrancyMaterial = (typeof VIBRANCY_MATERIALS)[number]

/**
 * The models offered in Settings.
 *
 * A short list rather than whatever the API returns: the app has to be able to
 * say what each one is *for*, and a dropdown of forty ids does not help anyone
 * choose. Ordered most capable first.
 */
export const AI_MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5', blurb: 'Most capable. Slower, and costs the most.' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', blurb: 'The balance. A good default.' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', blurb: 'Fastest and cheapest.' },
] as const

export type AiModelId = (typeof AI_MODELS)[number]['id']

export const isAiModel = (value: unknown): value is AiModelId =>
  typeof value === 'string' && AI_MODELS.some((model) => model.id === value)

/** One turn. The content is plain markdown - the same text the note holds. */
export type AiMessage = { role: 'user' | 'assistant'; content: string }

/** What a running stream reports back. `id` matches the `ai:send` request. */
export type AiDelta = { id: string; text: string }
export type AiDone = { id: string; stopReason: string | null; inputTokens: number; outputTokens: number }
export type AiError = { id: string; message: string }

/** An Obsidian vault found on this machine, from Obsidian's own vault list. */
export type ObsidianVaultInfo = { path: string; name: string; notes: number; open: boolean }

export type SyncCounts = {
  toRecto: number
  toObsidian: number
  deleteInRecto: number
  deleteInObsidian: number
  conflicts: number
}

/**
 * Why a sync is not running, in terms the settings screen can explain.
 * `guard` is the one that needs a person: a pass would delete a lot at once.
 */
export type SyncProblem =
  | { reason: 'missing'; side: 'recto' | 'obsidian' }
  | { reason: 'nested' }
  | { reason: 'guard'; side: 'recto' | 'obsidian'; count: number }
  | { reason: 'error'; message: string }

export type ObsidianSyncStatus = {
  /** The Obsidian folder this vault syncs with, or null if it syncs with none. */
  obsidianPath: string | null
  enabled: boolean
  running: boolean
  lastSyncAt: number | null
  last: { counts: SyncCounts; conflicts: string[]; errors: string[] } | null
  problem: SyncProblem | null
}

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
  /** The window entered or left macOS full screen. */
  'app:fullscreen': (on: boolean) => void
  /**
   * A model's reply, token by token.
   *
   * Push channels rather than a promise, because the whole point is that the
   * answer appears while it is being written. `ai:done` and `ai:error` are
   * terminal - exactly one of them follows every accepted `ai:send`.
   */
  /** Sync state changed: a pass started, finished, or stopped for a reason. */
  'obsidian:status': (status: ObsidianSyncStatus) => void
  'ai:delta': (delta: AiDelta) => void
  'ai:done': (done: AiDone) => void
  'ai:error': (error: AiError) => void
}

export type IpcEventChannel = keyof IpcEvents

export const IPC_EVENT_CHANNELS: readonly IpcEventChannel[] = [
  'vault:changed',
  'app:fullscreen',
  'obsidian:status',
  'ai:delta',
  'ai:done',
  'ai:error',
] as const

/** Invoke channels: renderer -> main, request/response. */
export type IpcApi = {
  'app:startup-state': () => StartupState
  'app:platform': () => { platform: NodeJS.Platform; version: string }
  /** macOS vibrancy material; null takes the blur off the window entirely. */
  'app:set-vibrancy': (material: VibrancyMaterial | null) => { ok: boolean }
  /**
   * The window's macOS appearance, which decides which VARIANT of the vibrancy
   * material AppKit draws - the light frost or the dark one. Without this the
   * app's own light theme could be wearing dark-mode vibrancy, which is a dark
   * sidebar no tint can lighten.
   */
  'app:set-theme-source': (source: 'system' | 'light' | 'dark') => { ok: boolean }
  /** Asked once at boot; after that `app:fullscreen` pushes the changes. */
  'app:is-fullscreen': () => boolean
  'vault:pick': () => OpenVaultResult
  'vault:open': (path: string) => OpenVaultResult
  'vault:close': () => StartupState
  /** Vaults opened before, most recent first, excluding the open one. */
  'vault:recent': () => RecentVault[]
  /** Plain text on the system clipboard, read in main - the web clipboard API refuses an unfocused page. */
  'app:clipboard-text': () => string
  /** The folder dialog alone. Null when cancelled. */
  'vault:choose-folder': () => string | null
  /**
   * Close the open vault and open another. On failure the previous vault stays
   * open and running.
   */
  'vault:switch': (path: string) => OpenVaultResult
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
  'fs:rename': (path: string, newName: string) => RenameOutcome | { ok: false; error: string }
  'fs:trash': (path: string) => { ok: boolean; error?: string }
  'fs:move': (path: string, newParent: string) => RenameOutcome | { ok: false; error: string }
  'fs:reveal': (path: string) => { ok: boolean }
  /** Pick image files and copy them into the vault. Empty when cancelled. */
  'fs:import-images': () => { ok: true; paths: string[] } | { ok: false; error: string }
  /**
   * Write dropped or pasted bytes into the vault's attachments folder.
   *
   * Bytes rather than a source path on purpose: a drag from Finder, a drag out
   * of a browser and a pasted screenshot all arrive in the renderer as a `File`
   * with no path at all, and `webUtils.getPathForFile` only covers the first.
   */
  'fs:import-data': (
    name: string,
    data: Uint8Array,
  ) => { ok: true; path: string } | { ok: false; error: string }
  'index:search': (query: string, limit?: number) => SearchResult[]
  'index:backlinks': (path: string) => BacklinkResult[]
  'index:stats': () => IndexStats
  'index:home-stats': () => VaultUsage
  'index:reindex': () => { ok: boolean }
  'index:resolve-link': (target: string) => string | null
  'index:resolve-links': (targets: string[]) => Record<string, string | null>
  'index:unresolved': () => { target: string; sources: string[] }[]
  'index:graph': () => GraphInfo
  'index:board': (board: string) => BoardCardInfo[]
  'index:boards': () => { board: string; count: number }[]
  'index:context': () => NoteContextInfo[]
  'links:undo-rename': (undoId: string) => { ok: boolean; restored: number; error?: string }
  'history:list': (path: string) => SnapshotInfo[]
  'history:get': (id: number) => SnapshotInfo | null
  'history:restore': (id: number) => { ok: boolean; path?: string; error?: string }
  'archive:add': (path: string) => { ok: true; id: string } | { ok: false; error: string }
  'archive:list': () => ArchiveState
  'archive:restore': (id: string) => { ok: true; path: string } | { ok: false; error: string }
  'archive:purge': (id: string) => { ok: boolean; error?: string }
  'archive:set-retention': (days: number) => ArchiveState
  /**
   * The API key. Note what is NOT here: any way to read it back.
   *
   * The renderer can set it, clear it, ask whether one exists and show the
   * masked hint. Using it happens in main. A channel that returned the key
   * would put it one `executeJavaScript` away from anything that ever runs in
   * the window.
   */
  'ai:key-status': () => { present: boolean; hint: string | null; available: boolean }
  'ai:set-key': (key: string) => { ok: boolean; error?: string }
  'ai:clear-key': () => { ok: boolean }
  /** One-token round trip, so "wrong key" and "no network" look different. */
  'ai:test': (model: string) => { ok: boolean; error?: string }
  /**
   * Start a reply. Resolves as soon as the request is accepted; the reply
   * itself arrives on `ai:delta` and ends with `ai:done` or `ai:error`.
   */
  'ai:send': (request: {
    id: string
    model: string
    system: string
    messages: AiMessage[]
  }) => { ok: boolean; error?: string }
  /** Stop a running stream. Unknown ids are a no-op, not an error. */
  'ai:cancel': (id: string) => { ok: boolean }
  /** Obsidian vaults registered on this machine. */
  'obsidian:vaults': () => ObsidianVaultInfo[]
  /** Pick an Obsidian vault folder by hand. Null when cancelled. */
  'obsidian:pick': () => string | null
  'obsidian:status': () => ObsidianSyncStatus
  /** What the first pass with this folder would do - nothing is written. */
  'obsidian:preview': (obsidianPath: string) => { ok: true; counts: SyncCounts } | { ok: false; problem: SyncProblem }
  /** Start syncing the open vault with this Obsidian folder. */
  'obsidian:enable': (obsidianPath: string) => ObsidianSyncStatus
  'obsidian:disable': () => ObsidianSyncStatus
  /** Run a pass now. `force` runs one the deletion guard stopped. */
  'obsidian:sync-now': (force?: boolean) => ObsidianSyncStatus
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

/** The link graph, for the graph view. */
export type GraphNodeInfo = { path: string; name: string; title: string | null; degree: number }
export type GraphEdgeInfo = { source: string; target: string }
export type GraphInfo = { nodes: GraphNodeInfo[]; edges: GraphEdgeInfo[] }

/**
 * One card on a kanban board - which is just a note whose frontmatter says so.
 * There is no card record: these fields come back out of the property index.
 */
export type BoardCardInfo = {
  path: string
  title: string
  preview: string
  status: string | null
  order: number | null
  due: string | null
  priority: string | null
}

/** A note's own signals about where it belongs, for Tidy. */
export type NoteContextInfo = { path: string; tags: string[]; links: string[] }

/** One stored version of a note. `content` is present only for a single fetch. */
export type SnapshotInfo = { id: number; path: string; ts: number; bytes: number; content?: string }

/** A full-text hit. `snippet` marks matches with << >> for the UI to highlight. */
export type SearchResult = { path: string; snippet: string; score: number }
export type BacklinkResult = {
  path: string
  line: number
  alias: string | null
  context: string | null
  title: string | null
}

/** What a rename did to other notes, so the UI can report and offer undo. */
export type RenameOutcome = {
  ok: true
  path: string
  /** Files whose links were rewritten, and how many links in total. */
  rewrittenFiles: number
  rewrittenLinks: number
  /** Present when something was rewritten; pass to `links:undo-rename`. */
  undoId?: string
}
export type IndexStats = { notes: number; links: number; unresolved: number; tags: number }

/**
 * The vault's own account of itself, for the home overlay.
 *
 * `mtime` is the only date the filesystem keeps that survives a clone or a
 * sync, so everything dated here means *touched*, not created.
 */
export type VaultUsage = {
  notes: number
  links: number
  unresolved: number
  tags: number
  touchedThisWeek: number
  /** Notes touched per day, oldest first, seven entries. */
  weekTrend: number[]
  topFolders: { name: string; count: number }[]
  topTags: { tag: string; count: number }[]
  hubs: { name: string; links: number }[]
}

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
  'app:set-vibrancy',
  'app:set-theme-source',
  'app:is-fullscreen',
  'vault:pick',
  'vault:open',
  'vault:close',
  'vault:recent',
  'app:clipboard-text',
  'vault:choose-folder',
  'vault:switch',
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
  'fs:import-images',
  'fs:import-data',
  'index:search',
  'index:backlinks',
  'index:stats',
  'index:home-stats',
  'index:reindex',
  'index:resolve-link',
  'index:resolve-links',
  'index:unresolved',
  'index:graph',
  'index:board',
  'index:boards',
  'index:context',
  'links:undo-rename',
  'history:list',
  'history:get',
  'history:restore',
  'archive:add',
  'archive:list',
  'archive:restore',
  'archive:purge',
  'archive:set-retention',
  'ai:key-status',
  'ai:set-key',
  'ai:clear-key',
  'ai:test',
  'ai:send',
  'ai:cancel',
  'obsidian:vaults',
  'obsidian:pick',
  'obsidian:status',
  'obsidian:preview',
  'obsidian:enable',
  'obsidian:disable',
  'obsidian:sync-now',
] as const
