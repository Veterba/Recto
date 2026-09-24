/**
 * Auto-links: the settings, status and suggestion shapes that cross from main
 * to the renderer. The logic lives in `src/main/autolinks/`.
 */

export type AutolinkMode = 'off' | 'suggest' | 'auto'

/** Per vault, in `.recto/autolinks-settings.json`. */
export type AutolinkSettings = {
  mode: AutolinkMode
  /** Minutes since the last write before a note is looked at. */
  quietMinutes: number
  minWords: number
  /** Chips per note in Suggest mode. Auto adds at most 2, whatever this says. */
  maxLinks: number
  /** The frontmatter key we write to. Nothing else is ever touched. */
  property: string
  /** Vault-relative folders, on top of the ones that are always excluded. */
  excluded: string[]
  /**
   * Measured per vault from 500 random pairs, after the backfill and weekly:
   * T_AUTO = max(0.75, 99th percentile), T_SUGGEST = max(0.70, 95th).
   * Null until the first measurement. T_AUTO here is the measured base; the
   * feedback raise lives in `.recto/autolinks.json`.
   */
  tAuto: number | null
  tSuggest: number | null
  thresholdsAt: number | null
  /** Names that never earn the title bonus (case-insensitive): `index`, `notes`... */
  genericNames: string[]
  /** The manual-link check. A diagnostic only - it sets nothing. */
  diagnostic: CalibrationReport | null
  /**
   * When the vault's vectors were first complete. Tells an index rebuild
   * (vectors gone, this set) from a first run (neither).
   */
  initializedAt: number | null
  /**
   * When Settings first showed what Auto would do in this vault. Until then
   * Auto writes nothing; the next scheduled run after it does.
   */
  reviewedAt: number | null
}

export const DEFAULT_AUTOLINK_SETTINGS: AutolinkSettings = {
  mode: 'auto',
  quietMinutes: 60,
  minWords: 60,
  maxLinks: 3,
  property: 'related',
  excluded: [],
  tAuto: null,
  tSuggest: null,
  thresholdsAt: null,
  genericNames: ['index', 'readme', 'notes', 'tags', 'todo', 'summary', 'overview', 'draft', 'untitled', 'inbox'],
  diagnostic: null,
  initializedAt: null,
  reviewedAt: null,
}

export type CalibrationRow = { threshold: number; precision: number; recall: number; predicted: number }

export type CalibrationReport = {
  at: number
  /** Manual links it was measured on. */
  links: number
  rows: CalibrationRow[]
  /** Lowest threshold with precision >= 0.7, or null when none reaches it. */
  chosen: number | null
}

export type ModelStatus =
  | { state: 'missing'; bytes: number }
  | { state: 'downloading'; received: number; bytes: number }
  | { state: 'waiting-network'; received: number; bytes: number }
  | { state: 'ready'; bytes: number }
  | { state: 'error'; message: string; bytes: number }

export type AutolinkStatus = {
  model: ModelStatus
  /** Eligible notes, and how many of them have vectors. */
  eligible: number
  embedded: number
  /** Why the backfill is not moving, when it is not. */
  backfill: 'done' | 'running' | 'waiting-power' | 'waiting-idle' | 'idle'
  calibrating: { done: number; total: number } | null
  rejected: number
  /** T_AUTO in force: the measured base plus any raise from feedback. */
  tAutoEffective: number | null
  /** The passive feedback on Auto's links so far. */
  feedback: { added: number; deleted: number; confirmed: number; raisedBy: number }
  /** Auto has not been shown yet in this vault: how many notes its first run would review. */
  review: { pending: boolean; notes: number }
  /** What the most recent Auto run wrote and is still there, for "Undo last run". */
  lastRun: { at: number; links: number; notes: number } | null
}

/** Which bonuses fired for a link, and the score they made. */
export type LinkScore = { sem: number; total: number; title: number; tags: number; cocite: number; hub: number }

/** One link Auto would write, for the preview. */
export type PreviewLink = { source: string; target: string } & LinkScore

/** Pushed after an Auto write, for the status-bar notice. */
export type AutolinkAdded = { path: string; name: string; targets: { target: string; name: string }[] }

export type AutolinkSuggestion = {
  /** Vault-relative path of the suggested note. */
  target: string
  score: number
  /** The source passage that matched best, trimmed to ~120 characters. */
  reason: string
}

/** A note's chips, and where a clicked one is written. */
export type AutolinkSuggestions = {
  property: string
  items: (AutolinkSuggestion & { name: string; link: string })[]
}
