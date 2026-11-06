/**
 * The typed trust boundary. Imported by main, preload and renderer.
 *
 * Every channel is named here and nowhere else: code refers to `IPC.fsRead`,
 * never to the string. `IpcApi` and `IpcEvents` give each channel its
 * signature, and fail to compile if they and the name lists ever disagree.
 */

import type { LinkSettings } from './obsidian-links'
import type { AiDelta, AiDone, AiError, AiMessage } from './ai'
import type { ArchiveState } from './archive'
import type { Bot, BotJob, BotMemoryStatus, BotMessage, BotModelStatus, BotSettings, ModelChoice, NoteCardsStatus, PullProgress } from './bots'
import type { ProviderStatus } from './providers'
import type { QuickAskEvent } from './quick-ask'
import type {
  BacklinkResult,
  BoardCardInfo,
  BoardSummaryInfo,
  CardPlaceInfo,
  GraphInfo,
  IndexStats,
  NoteContextInfo,
  SearchResult,
  SnapshotInfo,
} from './index-results'
import type { ObsidianSyncStatus, ObsidianVaultInfo, SyncCounts, SyncProblem } from './obsidian-sync'
import type { TopicInfo, TopicsPreview, TopicsRunNotice, TopicsSettings, TopicsStatus } from './topics'
import type { FileNode, OpenVaultResult, RecentVault, RenameOutcome, StartupState, StateFeature, VaultChange } from './vault'
import type { TextFileResult } from './file-kind'
import type { OverviewData, OverviewPlace, OverviewTopic } from './overview'
import type { BoardMigrationResult } from './board-migration'
import type { LayoutMigrationResult } from './recto-paths'
import type { ActivityEntry, AiAccessSettings, ClientId, ClientPlan, ClientStatus, Proposal } from './ai-access'
import type { Finding, FormattingProfile } from './formatting'
import type { LinkPreview } from './canvas'

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
/** What the mini-player plays: a YouTube video by its id, or a video in the vault by its path; `ratio` is width / height. */
export type PlayerItem =
  | { kind: 'youtube'; id: string; title: string; ratio?: number }
  | { kind: 'file'; path: string; title: string; ratio?: number }

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
  fsOutsideLinks: 'fs:outside-links',
  fsRead: 'fs:read',
  fsReadText: 'fs:read-text',
  fsWrite: 'fs:write',
  fsCreate: 'fs:create',
  fsRename: 'fs:rename',
  fsTrash: 'fs:trash',
  fsMove: 'fs:move',
  fsSameNamed: 'fs:same-named',
  linksSettings: 'links:settings',
  linksFormat: 'links:format',
  linksAnswer: 'links:answer',
  fsExisting: 'fs:existing',
  boardsPlace: 'boards:place',
  boardsRename: 'boards:rename',
  boardsDelete: 'boards:delete',
  boardsUndoDelete: 'boards:undo-delete',
  fsReveal: 'fs:reveal',
  fsOpenWithApp: 'fs:open-with-app',
  fsReadBytes: 'fs:read-bytes',
  fsImportImages: 'fs:import-images',
  fsImportFiles: 'fs:import-files',
  fsImportData: 'fs:import-data',
  indexSearch: 'index:search',
  indexBacklinks: 'index:backlinks',
  indexCanvasesOf: 'index:canvases-of',
  indexStats: 'index:stats',
  indexReindex: 'index:reindex',
  indexResolveLink: 'index:resolve-link',
  indexResolveLinks: 'index:resolve-links',
  indexUnresolved: 'index:unresolved',
  indexGraph: 'index:graph',
  indexCards: 'index:cards',
  indexBoards: 'index:boards',
  indexCardPlaces: 'index:card-places',
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
  botsEnabled: 'bots:enabled',
  botsSetEnabled: 'bots:set-enabled',
  botsStatus: 'bots:status',
  botsWarm: 'bots:warm',
  botsMemory: 'bots:memory',
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
  botsRetry: 'bots:retry',
  botsJobs: 'bots:jobs',
  botsViewing: 'bots:viewing',
  overviewData: 'overview:data',
  overviewTopics: 'overview:topics',
  overviewEdited: 'overview:edited',
  overviewOpened: 'overview:opened',
  overviewActive: 'overview:active',
  overviewPlace: 'overview:place',
  overviewSetPlace: 'overview:set-place',
  boardsMigration: 'boards:migration',
  layoutMigration: 'layout:migration',
  boardsMigrate: 'boards:migrate',
  aiAccessSettings: 'ai-access:settings',
  aiAccessSetSettings: 'ai-access:set-settings',
  aiAccessDetectFormatting: 'ai-access:detect-formatting',
  aiAccessDraftGuide: 'ai-access:draft-guide',
  aiAccessSaveGuide: 'ai-access:save-guide',
  aiAccessActivity: 'ai-access:activity',
  canvasProposeLink: 'canvas:propose-link',
  canvasLinkPreview: 'canvas:link-preview',
  playerOpen: 'player:open',
  aiProposals: 'ai-proposals:list',
  aiProposalApply: 'ai-proposals:apply',
  aiProposalDiscard: 'ai-proposals:discard',
  aiClients: 'ai-clients:list',
  aiClientPlan: 'ai-clients:plan',
  aiClientConnect: 'ai-clients:connect',
  aiClientDisconnect: 'ai-clients:disconnect',
  aiClientInstallExtension: 'ai-clients:install-extension',
  aiClientTest: 'ai-clients:test',
  providers: 'providers:list',
  providersSetOpenAiKey: 'providers:set-openai-key',
  providersChatGptSignIn: 'providers:chatgpt-sign-in',
  providersChatGptCancel: 'providers:chatgpt-cancel',
  providersChatGptSignOut: 'providers:chatgpt-sign-out',
  providersOpenUrl: 'providers:open-url',
  quickAskSend: 'quick-ask:send',
  quickAskCancel: 'quick-ask:cancel',
  botsSaveThread: 'bots:save-thread',
} as const

/** Push channels: main -> renderer. Subscribed through `api.on`. */
export const IPC_EVENT = {
  vaultChanged: 'vault:changed',
  linksAsk: 'links:ask',
  appFullscreen: 'app:fullscreen',
  obsidianStatus: 'obsidian:status',
  aiDelta: 'ai:delta',
  aiDone: 'ai:done',
  aiError: 'ai:error',
  topicsStatus: 'topics:status',
  topicsRun: 'topics:run',
  botsJob: 'bots:job',
  botsUnread: 'bots:unread',
  botsOpenTopic: 'bots:open-topic',
  botsPullProgress: 'bots:pull-progress',
  botsCardsStatus: 'bots:cards-status',
  botsEnabledChanged: 'bots:enabled-changed',
  aiProposalsChanged: 'ai-proposals:changed',
  quickAskEvent: 'quick-ask:event',
  aiProposalsOpen: 'ai-proposals:open',
} as const

/** What becomes of a deleted board's cards. */
export type BoardDeleteChoice = { kind: 'unsorted' } | { kind: 'board'; to: string } | { kind: 'trash' }
export type BoardDeleteResult =
  | { ok: true; moved: { from: string; to: string }[]; trashed: string[]; undoId?: string }
  | { ok: false; error: string }

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
export type IpcEventChannel = (typeof IPC_EVENT)[keyof typeof IPC_EVENT]

/** Every channel in `C` has an entry in `T`, and `T` has no others. */
type Exhaustive<C extends string, T extends Record<C, unknown> & Record<Exclude<keyof T, C>, never>> = T

export type IpcEvents = Exhaustive<
  IpcEventChannel,
  {
    [IPC_EVENT.vaultChanged]: (changes: VaultChange[]) => void
    /** A rename would change links, and the vault says to ask first (Obsidian's Update links): answered with `links:answer`. */
    [IPC_EVENT.linksAsk]: (ask: { id: string; links: number; files: number }) => void
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
     * An answer's job changed (bots/jobs.ts): queued, preparing with its steps
     * and status, streaming with its text so far, or ended. The chat, History
     * and the sidebar watch it; leaving the chat only stops watching.
     */
    [IPC_EVENT.botsJob]: (job: BotJob) => void
    /** An answer finished while its chat was out of sight: the sidebar's dot. */
    [IPC_EVENT.botsUnread]: (event: { botId: string; topic: string }) => void
    /** A notification about an answer was clicked: open that topic. */
    [IPC_EVENT.botsOpenTopic]: (event: { botId: string; topic: string }) => void
    /** A model download: progress, then one event with `done` (success, cancelled or error). */
    [IPC_EVENT.botsPullProgress]: (progress: PullProgress & { done: boolean; error?: string }) => void
    /** Note cards being built in the background: how many notes have one. */
    [IPC_EVENT.botsCardsStatus]: (status: NoteCardsStatus) => void
    /** Bots were turned on or off (Settings → Bots). */
    [IPC_EVENT.botsEnabledChanged]: (on: boolean) => void
    /** An AI client proposed a change, or one was applied or discarded. */
    [IPC_EVENT.aiProposalsChanged]: () => void
    /** Quick ask's answer as it streams, its steps, its end (main/providers/quick-ask.ts). */
    [IPC_EVENT.quickAskEvent]: (event: QuickAskEvent) => void
    /** A suggested-edit notification was clicked: show Suggested edits. */
    [IPC_EVENT.aiProposalsOpen]: () => void
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
    /**
     * Symlinks the last tree walk found pointing outside the vault, each reported
     * once per session. They are never listed, opened or indexed.
     */
    [IPC.fsOutsideLinks]: () => string[]
    [IPC.fsRead]: (path: string) => { ok: true; content: string } | { ok: false; error: string }
    /** A file that is not a note, for the code editor: its text, or why it is not shown as text. */
    [IPC.fsReadText]: (path: string) => TextFileResult
    [IPC.fsWrite]: (path: string, content: string) => { ok: boolean; error?: string }
    /** A file name taken anywhere in the vault is refused, or numbered with 'number' (see vault-fs `create`). */
    [IPC.fsCreate]: (
      parentPath: string,
      name: string,
      kind: 'file' | 'folder',
      onTaken?: 'refuse' | 'number',
    ) => { ok: true; path: string } | { ok: false; error: string }
    [IPC.fsRename]: (path: string, newName: string) => RenameOutcome | { ok: false; error: string }
    [IPC.fsTrash]: (path: string) => { ok: boolean; error?: string }
    [IPC.fsMove]: (path: string, newParent: string) => RenameOutcome | { ok: false; error: string }
    [IPC.fsReveal]: (path: string) => { ok: boolean }
    /** A vault file opened in the system's app for it. */
    [IPC.fsOpenWithApp]: (path: string) => { ok: boolean }
    /** A vault file's bytes, undecoded (a PDF for its reader). */
    [IPC.fsReadBytes]: (path: string) => { ok: true; data: Uint8Array } | { ok: false; error: string }
    /** Every file with this file name (`Plan.md`), in any folder, ignoring case, read from disk: Obsidian allows one per folder. */
    [IPC.fsSameNamed]: (fileName: string) => string[]
    /** The vault's link settings: Obsidian's, from `.obsidian/app.json`, or its defaults. */
    [IPC.linksSettings]: () => LinkSettings
    /** A link to the file at `target`, written in `source` as Obsidian writes it (shared/obsidian-links.ts `formatLink`). */
    /** The Update links dialog's answer. */
    [IPC.linksAnswer]: (id: string, answer: 'always' | 'once' | 'never') => void
    [IPC.linksFormat]: (target: string, source: string, opts?: { subpath?: string; alias?: string; embed?: boolean; markdown?: boolean }) => string
    /** Which of these vault paths are on disk now, whatever the tree has caught up with. */
    [IPC.fsExisting]: (paths: string[]) => string[]
    /** Put placed cards where the layout rules say, after a change in Recto; `boards` are board notes written since the index last read. */
    [IPC.boardsPlace]: (cards: string[], boards: string[]) => { from: string; to: string }[]
    /** Rename a board, its folder with it. */
    [IPC.boardsRename]: (path: string, name: string) => { ok: true; path: string } | { ok: false; error: string }
    [IPC.boardsDelete]: (path: string, choice: BoardDeleteChoice) => BoardDeleteResult
    [IPC.boardsUndoDelete]: (undoId: string) => { ok: boolean; error?: string }
    /** Pick image files and copy them into the vault. Empty when cancelled. */
    [IPC.fsImportImages]: () => { ok: true; paths: string[] } | { ok: false; error: string }
    /** Files chosen in a dialog (media first), copied into the attachments folder by path. */
    [IPC.fsImportFiles]: () => { ok: true; paths: string[] } | { ok: false; error: string }
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
    /** The canvases a note (or any file) is on, for its Linked mentions. */
    [IPC.indexCanvasesOf]: (path: string) => string[]
    [IPC.indexStats]: () => IndexStats
    [IPC.indexReindex]: () => { ok: boolean }
    /** A link's file, read from `source` - the note it is in, or '' for none (Obsidian's rules: shared/obsidian-links.ts). */
    [IPC.indexResolveLink]: (target: string, source: string) => string | null
    [IPC.indexResolveLinks]: (targets: string[], source: string) => Record<string, string | null>
    [IPC.indexUnresolved]: () => { target: string; sources: string[] }[]
    [IPC.indexGraph]: () => GraphInfo
    /** Card fields of the notes these link texts name (null for a name no note has). */
    [IPC.indexCards]: (targets: string[], board: string) => Record<string, BoardCardInfo | null>
    /** Board notes: every note in the Obsidian Kanban format. */
    [IPC.indexBoards]: () => BoardSummaryInfo[]
    /** Every card on every board and where it stands there. */
    [IPC.indexCardPlaces]: () => CardPlaceInfo[]
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
    /** Bots are experimental and per vault: off, nothing of theirs runs. */
    [IPC.botsEnabled]: () => boolean
    [IPC.botsSetEnabled]: (on: boolean) => boolean
    /** Whether the local model can run: Ollama reachable, and the model downloaded. */
    /** `warm`: a bot chat is asking, so start loading the model too. */
    [IPC.botsStatus]: (model?: string, warm?: boolean) => BotModelStatus
    /** Someone is typing to this bot: load its model now. */
    [IPC.botsWarm]: (botId: string) => void
    [IPC.botsMemory]: () => BotMemoryStatus
    [IPC.botsSettings]: () => BotSettings
    [IPC.botsSetSettings]: (patch: Partial<BotSettings>) => BotSettings
    /**
     * Ask a bot. Main searches the vault for the question, puts what it found
     * into the prompt, and resolves with those sources as soon as the model has
     * the request; the reply arrives on `bots:delta`. `id` names the stream:
     * the thread's note path.
     */
    [IPC.botsSend]: (request: {
      botId: string
      /** The topic it goes into; null starts a new one. */
      topic: string | null
      text: string
      /** When it was asked, by the renderer's clock (local ISO, to the second): the question's time and a new topic's. */
      at?: string
    }) => { ok: true; topic: string; job: BotJob } | { ok: false; error: string; status?: BotModelStatus }
    /** Stop a job: one by id, or every job of a topic (`discard`: the topic is being deleted, write nothing more). */
    [IPC.botsCancel]: (target: { id: string } | { topic: string }, discard?: boolean) => { ok: boolean }
    /** Ask again for a topic as it stands (after an error or an interrupted answer). */
    [IPC.botsRetry]: (request: { botId: string; topic: string }) => { ok: boolean; job?: BotJob }
    /** Every job main knows about: the running one, the queue, the ones just ended. */
    [IPC.botsJobs]: () => BotJob[]
    /** What a bot's chat shows and whether it is on screen: for notifications and the unread dot. */
    [IPC.botsViewing]: (view: { botId: string; topic: string | null; visible: boolean }) => { ok: boolean }
    /** The vault overview's raw figures, with the renderer's day and clock (main/overview.ts). Null with no vault or no index. */
    [IPC.overviewData]: (today: string, now: number) => OverviewData | null
    /** The largest topics and their notes; null when Topics is off. */
    [IPC.overviewTopics]: () => OverviewTopic[] | null
    /** You edited a note on `day`: a save in the editor, a card you changed or moved. */
    /** A note you edited, and the words that came in and went (none for a board move, a field, a stamp). */
    [IPC.overviewEdited]: (path: string, day: string, added: string[], removed: string[]) => { ok: boolean }
    /** A note came on screen. */
    [IPC.overviewOpened]: (path: string, at: number) => { ok: boolean }
    /** Seconds you were active in Recto, added to `day`. */
    [IPC.overviewActive]: (day: string, seconds: number) => { ok: boolean }
    /** Where the overview was left: its page and scroll (userData). */
    [IPC.overviewPlace]: () => OverviewPlace
    [IPC.overviewSetPlace]: (place: OverviewPlace) => { ok: boolean }
    /** What the boards migration did on this vault's open, once; `none` afterwards. */
    [IPC.boardsMigration]: () => BoardMigrationResult
    /** What moving tasks/ and chats/ into Recto/ did on this open; said once. */
    [IPC.layoutMigration]: () => LayoutMigrationResult
    /** Run it again with names for the boards whose own was taken. */
    [IPC.boardsMigrate]: (names: Record<string, string>) => BoardMigrationResult
    [IPC.aiAccessSettings]: () => AiAccessSettings
    [IPC.aiAccessSetSettings]: (next: AiAccessSettings) => { ok: boolean; error?: string }
    /** Linter's settings (when the plugin is on) and the habits in the vault's notes. */
    [IPC.aiAccessDetectFormatting]: () => { profile: FormattingProfile; findings: Finding[]; linter: 'imported' | 'off' | 'missing'; notes: number }
    [IPC.aiAccessDraftGuide]: () => string
    /** A new note at the top of the vault, set as the AI guide. */
    [IPC.aiAccessSaveGuide]: (name: string, text: string) => { ok: true; path: string } | { ok: false; error: string }
    [IPC.aiAccessActivity]: () => ActivityEntry[]
    /** An edge between two notes made a [[link]] in the first: queued as a Suggested edit, never written directly. */
    [IPC.canvasProposeLink]: (from: string, to: string) => { ok: true; proposal: string | null } | { ok: false; error: string }
    /** A link node's card: the page's title, description, image and icon, fetched once and kept; null offline or when the page will not say. */
    [IPC.canvasLinkPreview]: (url: string) => LinkPreview | null
    /** A video played in the mini-player window: a YouTube video, or one from the vault. */
    [IPC.playerOpen]: (item: PlayerItem) => { ok: true } | { ok: false; error: string }
    [IPC.aiProposals]: () => Proposal[]
    [IPC.aiProposalApply]: (id: string) => { ok: boolean; error?: string; stale?: boolean }
    [IPC.aiProposalDiscard]: (id: string) => { ok: boolean }
    [IPC.aiClients]: () => ClientStatus[]
    [IPC.aiClientPlan]: (id: ClientId, action: 'connect' | 'disconnect') => ClientPlan
    [IPC.aiClientConnect]: (id: ClientId) => { ok: boolean; error?: string }
    [IPC.aiClientDisconnect]: (id: ClientId) => { ok: boolean; error?: string }
    /** Claude Desktop: build Recto.mcpb and open it with Claude Desktop. */
    [IPC.aiClientInstallExtension]: () => { ok: boolean; error?: string }
    [IPC.aiClientTest]: () => { ok: boolean; message: string }
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
    /** Every provider: ready or why not, where it was found, its models. Asks nothing that costs. */
    [IPC.providers]: () => ProviderStatus[]
    /** The OpenAI key (null forgets it); kept in main, never sent back. */
    [IPC.providersSetOpenAiKey]: (key: string | null) => { ok: boolean; error?: string }
    /** Sign in with ChatGPT in the browser; resolves when it is done, cancelled or failed. */
    [IPC.providersChatGptSignIn]: () => { ok: true; email: string | null; plan: boolean } | { ok: false; error: string }
    [IPC.providersChatGptCancel]: () => { ok: boolean }
    /** Signed out: the refresh token revoked at OpenAI when it can be (`revoked` says). */
    [IPC.providersChatGptSignOut]: () => { ok: boolean; revoked: boolean }
    /** A provider's own page (install, manage usage): only the links providers give. */
    [IPC.providersOpenUrl]: (url: string) => { ok: boolean }
    /** A Quick ask question about the open note; the answer arrives on `quick-ask:event`. */
    [IPC.quickAskSend]: (request: { thread: string; note: string; model: string; history: AiMessage[]; question: string }) => { ok: boolean }
    [IPC.quickAskCancel]: (thread: string) => { ok: boolean }
    /** A Quick ask thread kept as a normal chat with Recto: its topic file. */
    [IPC.botsSaveThread]: (request: { botId: string; messages: BotMessage[] }) => { ok: true; topic: string } | { ok: false; error: string }
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
