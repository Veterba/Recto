/** Obsidian sync as the settings screen sees it. */

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
