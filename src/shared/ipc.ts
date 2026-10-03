/**
 * The typed trust boundary. Imported by main, preload and renderer.
 *
 * Every channel is named here and nowhere else: code refers to `IPC.fsRead`,
 * never to the string. `IpcApi` and `IpcEvents` give each channel its
 * signature, and fail to compile if they and the name lists ever disagree.
 */

import type { AiDelta, AiDone, AiError, AiMessage } from './ai'
import type { ArchiveState } from './archive'
import type { Bot, BotModelStatus, BotSettings, BotSource, ModelChoice, NoteCardsStatus, PullProgress } from './bots'
import type {
  BacklinkResult,
  BoardCardInfo,
  GraphInfo,
  IndexStats,
  NoteContextInfo,
  SearchResult,
  SnapshotInfo,
  VaultUsage,
} from './index-results'
import type { ObsidianSyncStatus, ObsidianVaultInfo, SyncCounts, SyncProblem } from './obsidian-sync'
import type { TopicInfo, TopicsPreview, TopicsRunNotice, TopicsSettings, TopicsStatus } from './topics'
import type { FileNode, OpenVaultResult, RecentVault, RenameOutcome, StartupState, StateFeature, VaultChange } from './vault'

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

/** Invoke channels: renderer -> main, request/response. */
export const IPC = {
  appStartupState: 'app:startup-state',
  appPlatform: 'app:platform',
  appSetVibrancy: 'app:set-vibrancy',
  appSetThemeSource: 'app:set-theme-source',
  appIsFullscreen: 'app:is-fullscreen',
  vaultPick: 'vault:pick',
  vaultOpen: 'vault:open',
  vaultClose: 'vault:close',
  vaultRecent: 'vault:recent',
  vaultForgetRecent: 'vault:forget-recent',
  appClipboardText: 'app:clipboard-text',
  vaultChooseFolder: 'vault:choose-folder',
  vaultSwitch: 'vault:switch',
  shellOpenExternal: 'shell:open-external',
  stateRead: 'state:read',
  stateWrite: 'state:write',
  fsTree: 'fs:tree',
  fsRead: 'fs:read',
  fsWrite: 'fs:write',
  fsCreate: 'fs:create',
  fsRename: 'fs:rename',
  fsTrash: 'fs:trash',
  fsMove: 'fs:move',
  fsReveal: 'fs:reveal',
  fsImportImages: 'fs:import-images',
  fsImportData: 'fs:import-data',
  indexSearch: 'index:search',
  indexBacklinks: 'index:backlinks',
  indexStats: 'index:stats',
  indexVaultUsage: 'index:vault-usage',
  indexReindex: 'index:reindex',
  indexResolveLink: 'index:resolve-link',
  indexResolveLinks: 'index:resolve-links',
  indexUnresolved: 'index:unresolved',
  indexGraph: 'index:graph',
  indexBoard: 'index:board',
  indexBoards: 'index:boards',
  indexContext: 'index:context',
  linksUndoRename: 'links:undo-rename',
  historyList: 'history:list',
  historyGet: 'history:get',
  historyRestore: 'history:restore',
  archiveAdd: 'archive:add',
  archiveList: 'archive:list',
  archiveRestore: 'archive:restore',
  archivePurge: 'archive:purge',
  archiveSetRetention: 'archive:set-retention',
  aiKeyStatus: 'ai:key-status',
  aiSetKey: 'ai:set-key',
  aiClearKey: 'ai:clear-key',
  aiTest: 'ai:test',
  aiSend: 'ai:send',
  aiCancel: 'ai:cancel',
  obsidianVaults: 'obsidian:vaults',
  obsidianPick: 'obsidian:pick',
  obsidianStatus: 'obsidian:status',
  obsidianPreview: 'obsidian:preview',
  obsidianEnable: 'obsidian:enable',
  obsidianDisable: 'obsidian:disable',
  obsidianSyncNow: 'obsidian:sync-now',
  topicsSettings: 'topics:settings',
  topicsSetSettings: 'topics:set-settings',
  topicsStatus: 'topics:status',
  topicsDownload: 'topics:download',
  topicsList: 'topics:list',
  topicsRename: 'topics:rename',
  topicsDelete: 'topics:delete',
  topicsRebuild: 'topics:rebuild',
  topicsPreview: 'topics:preview',
  topicsSeen: 'topics:seen',
  topicsUndoLastRun: 'topics:undo-last-run',
  botsList: 'bots:list',
  botsStatus: 'bots:status',
  botsSettings: 'bots:settings',
  botsSetSettings: 'bots:set-settings',
  botsSend: 'bots:send',
  botsCancel: 'bots:cancel',
  botsSetModel: 'bots:set-model',
  botsTitle: 'bots:title',
  botsModels: 'bots:models',
  botsPull: 'bots:pull',
  botsPullCancel: 'bots:pull-cancel',
  botsCards: 'bots:cards',
} as const

/** Push channels: main -> renderer. Subscribed through `api.on`. */
export const IPC_EVENT = {
  vaultChanged: 'vault:changed',
  appFullscreen: 'app:fullscreen',
  obsidianStatus: 'obsidian:status',
  aiDelta: 'ai:delta',
  aiDone: 'ai:done',
  aiError: 'ai:error',
  topicsStatus: 'topics:status',
  topicsRun: 'topics:run',
  botsDelta: 'bots:delta',
  botsDone: 'bots:done',
  botsError: 'bots:error',
  botsPullProgress: 'bots:pull-progress',
  botsProgress: 'bots:progress',
  botsCardsStatus: 'bots:cards-status',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
export type IpcEventChannel = (typeof IPC_EVENT)[keyof typeof IPC_EVENT]

/** Every channel in `C` has an entry in `T`, and `T` has no others. */
type Exhaustive<C extends string, T extends Record<C, unknown> & Record<Exclude<keyof T, C>, never>> = T

export type IpcEvents = Exhaustive<
  IpcEventChannel,
  {
    [IPC_EVENT.vaultChanged]: (changes: VaultChange[]) => void
    /** The window entered or left macOS full screen. */
    [IPC_EVENT.appFullscreen]: (on: boolean) => void
    /** Sync state changed: a pass started, finished, or stopped for a reason. */
    [IPC_EVENT.obsidianStatus]: (status: ObsidianSyncStatus) => void
    /**
     * A model's reply, token by token.
     *
     * Push channels rather than a promise, because the whole point is that the
     * answer appears while it is being written. `ai:done` and `ai:error` are
     * terminal - exactly one of them follows every accepted `ai:send`.
     */
    [IPC_EVENT.aiDelta]: (delta: AiDelta) => void
    [IPC_EVENT.aiDone]: (done: AiDone) => void
    [IPC_EVENT.aiError]: (error: AiError) => void
    /** Model download, backfill and the first-run review. */
    [IPC_EVENT.topicsStatus]: (status: TopicsStatus) => void
    /** A run wrote something - for the status-bar notice with Undo. */
    [IPC_EVENT.topicsRun]: (run: TopicsRunNotice) => void
    /**
     * A bot's reply, token by token, on channels of its own: bots run on a
     * local model and never share the main chat's client or its streams.
     * `bots:done` and `bots:error` are terminal, one per accepted `bots:send`.
     */
    [IPC_EVENT.botsDelta]: (delta: { id: string; text: string }) => void
    [IPC_EVENT.botsDone]: (done: { id: string }) => void
    [IPC_EVENT.botsError]: (error: { id: string; message: string }) => void
    /** A model download: progress, then one event with `done` (success, cancelled or error). */
    [IPC_EVENT.botsPullProgress]: (progress: PullProgress & { done: boolean; error?: string }) => void
    /** What a bot is doing before it answers ("Checking your tasks…"), for the status line; the steps card from 3.8. */
    [IPC_EVENT.botsProgress]: (progress: { id: string; text: string }) => void
    /** Note cards being built in the background: how many notes have one. */
    [IPC_EVENT.botsCardsStatus]: (status: NoteCardsStatus) => void
  }
>

export type IpcApi = Exhaustive<
  IpcChannel,
  {
    [IPC.appStartupState]: () => StartupState
    [IPC.appPlatform]: () => { platform: NodeJS.Platform; version: string }
    /** macOS vibrancy material; null takes the blur off the window entirely. */
    [IPC.appSetVibrancy]: (material: VibrancyMaterial | null) => { ok: boolean }
    /**
     * The window's macOS appearance, which decides which VARIANT of the vibrancy
     * material AppKit draws - the light frost or the dark one. Without this the
     * app's own light theme could be wearing dark-mode vibrancy, which is a dark
     * sidebar no tint can lighten.
     */
    [IPC.appSetThemeSource]: (source: 'system' | 'light' | 'dark') => { ok: boolean }
    /** Asked once at boot; after that `app:fullscreen` pushes the changes. */
    [IPC.appIsFullscreen]: () => boolean
    [IPC.vaultPick]: () => OpenVaultResult
    [IPC.vaultOpen]: (path: string) => OpenVaultResult
    [IPC.vaultClose]: () => StartupState
    /** Vaults opened before, most recent first, excluding the open one. */
    [IPC.vaultRecent]: () => RecentVault[]
    /** Take a vault off the recent list (it is not deleted); returns the list as it is now. */
    [IPC.vaultForgetRecent]: (path: string) => RecentVault[]
    /** Plain text on the system clipboard, read in main - the web clipboard API refuses an unfocused page. */
    [IPC.appClipboardText]: () => string
    /** The folder dialog alone. Null when cancelled. */
    [IPC.vaultChooseFolder]: () => string | null
    /**
     * Close the open vault and open another. On failure the previous vault stays
     * open and running.
     */
    [IPC.vaultSwitch]: (path: string) => OpenVaultResult
    [IPC.shellOpenExternal]: (url: string) => { ok: boolean }
    [IPC.stateRead]: (feature: StateFeature) => unknown
    [IPC.stateWrite]: (feature: StateFeature, data: unknown) => { ok: boolean; error?: string }
    [IPC.fsTree]: () => FileNode[]
    [IPC.fsRead]: (path: string) => { ok: true; content: string } | { ok: false; error: string }
    [IPC.fsWrite]: (path: string, content: string) => { ok: boolean; error?: string }
    [IPC.fsCreate]: (parentPath: string, name: string, kind: 'file' | 'folder') => { ok: true; path: string } | { ok: false; error: string }
    [IPC.fsRename]: (path: string, newName: string) => RenameOutcome | { ok: false; error: string }
    [IPC.fsTrash]: (path: string) => { ok: boolean; error?: string }
    [IPC.fsMove]: (path: string, newParent: string) => RenameOutcome | { ok: false; error: string }
    [IPC.fsReveal]: (path: string) => { ok: boolean }
    /** Pick image files and copy them into the vault. Empty when cancelled. */
    [IPC.fsImportImages]: () => { ok: true; paths: string[] } | { ok: false; error: string }
    /**
     * Write dropped or pasted bytes into the vault's attachments folder.
     *
     * Bytes rather than a source path on purpose: a drag from Finder, a drag out
     * of a browser and a pasted screenshot all arrive in the renderer as a `File`
     * with no path at all, and `webUtils.getPathForFile` only covers the first.
     */
    [IPC.fsImportData]: (name: string, data: Uint8Array) => { ok: true; path: string } | { ok: false; error: string }
    [IPC.indexSearch]: (query: string, limit?: number) => SearchResult[]
    [IPC.indexBacklinks]: (path: string) => BacklinkResult[]
    [IPC.indexStats]: () => IndexStats
    [IPC.indexVaultUsage]: () => VaultUsage
    [IPC.indexReindex]: () => { ok: boolean }
    [IPC.indexResolveLink]: (target: string) => string | null
    [IPC.indexResolveLinks]: (targets: string[]) => Record<string, string | null>
    [IPC.indexUnresolved]: () => { target: string; sources: string[] }[]
    [IPC.indexGraph]: () => GraphInfo
    [IPC.indexBoard]: (board: string) => BoardCardInfo[]
    [IPC.indexBoards]: () => { board: string; count: number }[]
    [IPC.indexContext]: () => NoteContextInfo[]
    [IPC.linksUndoRename]: (undoId: string) => { ok: boolean; restored: number; error?: string }
    [IPC.historyList]: (path: string) => SnapshotInfo[]
    [IPC.historyGet]: (id: number) => SnapshotInfo | null
    [IPC.historyRestore]: (id: number) => { ok: boolean; path?: string; error?: string }
    [IPC.archiveAdd]: (path: string) => { ok: true; id: string } | { ok: false; error: string }
    [IPC.archiveList]: () => ArchiveState
    [IPC.archiveRestore]: (id: string) => { ok: true; path: string } | { ok: false; error: string }
    [IPC.archivePurge]: (id: string) => { ok: boolean; error?: string }
    [IPC.archiveSetRetention]: (days: number) => ArchiveState
    /**
     * The API key. Note what is NOT here: any way to read it back.
     *
     * The renderer can set it, clear it, ask whether one exists and show the
     * masked hint. Using it happens in main. A channel that returned the key
     * would put it one `executeJavaScript` away from anything that ever runs in
     * the window.
     */
    [IPC.aiKeyStatus]: () => { present: boolean; hint: string | null; available: boolean }
    [IPC.aiSetKey]: (key: string) => { ok: boolean; error?: string }
    [IPC.aiClearKey]: () => { ok: boolean }
    /** One-token round trip, so "wrong key" and "no network" look different. */
    [IPC.aiTest]: (model: string) => { ok: boolean; error?: string }
    /**
     * Start a reply. Resolves as soon as the request is accepted; the reply
     * itself arrives on `ai:delta` and ends with `ai:done` or `ai:error`.
     */
    [IPC.aiSend]: (request: { id: string; model: string; system: string; messages: AiMessage[] }) => { ok: boolean; error?: string }
    /** Stop a running stream. Unknown ids are a no-op, not an error. */
    [IPC.aiCancel]: (id: string) => { ok: boolean }
    /** Obsidian vaults registered on this machine. */
    [IPC.obsidianVaults]: () => ObsidianVaultInfo[]
    /** Pick an Obsidian vault folder by hand. Null when cancelled. */
    [IPC.obsidianPick]: () => string | null
    [IPC.obsidianStatus]: () => ObsidianSyncStatus
    /** What the first pass with this folder would do - nothing is written. */
    [IPC.obsidianPreview]: (obsidianPath: string) => { ok: true; counts: SyncCounts } | { ok: false; problem: SyncProblem }
    /** Start syncing the open vault with this Obsidian folder. */
    [IPC.obsidianEnable]: (obsidianPath: string) => ObsidianSyncStatus
    [IPC.obsidianDisable]: () => ObsidianSyncStatus
    /** Run a pass now. `force` runs one the deletion guard stopped. */
    [IPC.obsidianSyncNow]: (force?: boolean) => ObsidianSyncStatus
    [IPC.topicsSettings]: () => TopicsSettings
    [IPC.topicsSetSettings]: (patch: Partial<TopicsSettings>) => TopicsSettings
    [IPC.topicsStatus]: () => TopicsStatus
    [IPC.topicsDownload]: () => { ok: boolean }
    [IPC.topicsList]: () => TopicInfo[]
    /** Rewrites every `[[topics/Old]]` to the new name; never renamed automatically after. */
    [IPC.topicsRename]: (id: string, name: string) => { ok: boolean; error?: string }
    /** Out of every note, and never created again. */
    [IPC.topicsDelete]: (id: string) => { ok: boolean }
    [IPC.topicsRebuild]: () => { ok: boolean }
    /** What the next run would write, computed without writing. */
    [IPC.topicsPreview]: () => TopicsPreview
    /** Settings has shown the first-run line; the next scheduled run may write. */
    [IPC.topicsSeen]: () => { ok: boolean }
    /** Reverse the most recent run: added topics come out (and are blocked), removed entries go back. */
    [IPC.topicsUndoLastRun]: () => { ok: boolean; changes: number }
    /** The open vault's bots, from `.recto/bots/`. The first call in a vault without bots creates Recto. */
    [IPC.botsList]: () => Bot[]
    /** Whether the local model can run: Ollama reachable, and the model downloaded. */
    [IPC.botsStatus]: (model?: string) => BotModelStatus
    [IPC.botsSettings]: () => BotSettings
    [IPC.botsSetSettings]: (patch: Partial<BotSettings>) => BotSettings
    /**
     * Ask a bot. Main searches the vault for the question, puts what it found
     * into the prompt, and resolves with those sources as soon as the model has
     * the request; the reply arrives on `bots:delta`. `id` names the stream:
     * the thread's note path.
     */
    [IPC.botsSend]: (request: {
      id: string
      botId: string
      messages: AiMessage[]
      /** What the last two answers in this topic read, newest last: they stay in reach (sticky context). */
      sticky?: BotSource[]
    }) => { ok: true; sources: BotSource[] } | { ok: false; error: string; status?: BotModelStatus }
    /** Stop a running reply. Unknown ids are a no-op. */
    [IPC.botsCancel]: (id: string) => { ok: boolean }
    /** A bot's model, written to its bot.json: an API model id, an Ollama model, or null for the local default. Returns the bots. */
    [IPC.botsSetModel]: (botId: string, model: string | null) => Bot[]
    /** A 2-5 word title for a chat topic from its first exchange, by the bot's model; null when it cannot make one. */
    [IPC.botsTitle]: (request: { botId: string; messages: AiMessage[] }) => string | null
    /** The local models for the picker, whether Ollama runs, and this Mac's memory. */
    [IPC.botsModels]: () => { local: ModelChoice[]; running: boolean; ramBytes: number }
    /** How far the background note cards are. */
    [IPC.botsCards]: () => NoteCardsStatus
    /** Download a model the user picked and confirmed; progress arrives on `bots:pull-progress`. */
    [IPC.botsPull]: (name: string) => { ok: boolean; error?: string }
    [IPC.botsPullCancel]: () => { ok: boolean }
  }
>

export type IpcRequest<C extends IpcChannel> = Parameters<IpcApi[C]>
export type IpcResponse<C extends IpcChannel> = Awaited<ReturnType<IpcApi[C]>>

/** The single object exposed on `window.api`. Keep this surface small. */
export type ExposedApi = {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcRequest<C>): Promise<IpcResponse<C>>
  /** Subscribe to a push channel. Returns an unsubscribe function. */
  on<C extends IpcEventChannel>(channel: C, listener: IpcEvents[C]): () => void
}

/** What the preload lets through; anything else is refused. */
export const IPC_CHANNELS: readonly string[] = Object.values(IPC)
export const IPC_EVENT_CHANNELS: readonly string[] = Object.values(IPC_EVENT)
