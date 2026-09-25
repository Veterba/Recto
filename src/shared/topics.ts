/**
 * Topics: the settings, status and lists that cross from main to the
 * renderer. The logic lives in `src/main/topics/`.
 */

/** The one property the machine writes, and the namespace topic links live in. */
export const TOPICS_PROPERTY = 'topics'
export const TOPIC_PREFIX = 'topics/'

/** Per vault, in `.recto/topics-settings.json`. */
export type TopicsSettings = {
  enabled: boolean
  /** Minutes since the last write before a note is looked at. */
  quietMinutes: number
  /** Own words a note needs to get a topic. */
  minWords: number
  /** Vault-relative folders, on top of the ones that are always excluded. */
  excluded: string[]
  /** When every eligible note first had vectors. Tells an index rebuild from a first run. */
  initializedAt: number | null
  /** When Settings first showed what the first run would do. Nothing is written before. */
  reviewedAt: number | null
}

export const DEFAULT_TOPICS_SETTINGS: TopicsSettings = {
  enabled: true,
  quietMinutes: 60,
  minWords: 60,
  excluded: [],
  initializedAt: null,
  reviewedAt: null,
}

export type ModelStatus =
  | { state: 'missing'; bytes: number }
  | { state: 'downloading'; received: number; bytes: number }
  | { state: 'waiting-network'; received: number; bytes: number }
  | { state: 'ready'; bytes: number }
  | { state: 'error'; message: string; bytes: number }

export type TopicsStatus = {
  model: ModelStatus
  /** Eligible notes, and how many of them have vectors. */
  eligible: number
  embedded: number
  backfill: 'done' | 'running' | 'waiting-power' | 'waiting-idle' | 'idle'
  /**
   * Nothing has been shown yet in this vault: how many notes the first run
   * would review. `devGuarded`: a dev build, where the gate never lifts.
   */
  review: { pending: boolean; notes: number; devGuarded: boolean }
  /** The most recent run that changed something, for "Undo last run". */
  lastRun: { at: number; notes: number } | null
}

/** A topic in the Settings list. */
export type TopicInfo = { id: string; name: string; notes: number }

/** What the next run would write, computed without writing. */
export type TopicsPreview = {
  notes: number
  topics: { name: string; size: number; sample: string[] }[]
  assignments: { path: string; topics: string[] }[]
}

/** Pushed after a run writes, for the status-bar notice. */
export type TopicsRunNotice = { at: number; notes: number; label: string }
