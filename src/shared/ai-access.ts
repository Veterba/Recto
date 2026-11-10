import type { CanvasProposal } from './canvas-ops'
/**
 * AI access: what AI clients (Claude Code, Codex, Claude Desktop, Cursor -
 * and later Recto's own providers) may do with the vault, through Recto's
 * one tool layer (main/vault-tools). Settings are per vault, in
 * `.recto/ai-access.json`; proposals and the activity log sit beside them.
 */

import { coerceProfile, LEAVE_ALL, type FormattingProfile } from './formatting'

/** Read only: write tools refuse. Propose: writes wait for Apply. Write: applied at once, after a backup. */
export type WriteMode = 'read' | 'propose' | 'write'

export type AiAccessSettings = {
  /** The note the AI reads first, or null. */
  guide: string | null
  formatting: FormattingProfile
  writeMode: WriteMode
  /** Folders and notes (vault paths) no tool ever returns, counts, links into or writes. */
  excluded: string[]
  /** Cloud providers may answer in this vault (Settings → AI → Providers); off until turned on. */
  cloud: boolean
}

export const AI_ACCESS_STATE = 'ai-access'
export const AI_PROPOSALS_STATE = 'ai-proposals'
/** In `.recto/`: one JSON line per tool call. */
export const AI_ACTIVITY_FILE = 'ai-activity.jsonl'

export const DEFAULT_AI_ACCESS: AiAccessSettings = { guide: null, formatting: LEAVE_ALL, writeMode: 'propose', excluded: [], cloud: false }

export function coerceAiAccess(value: unknown): AiAccessSettings {
  const raw = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const mode = raw['writeMode']
  return {
    guide: typeof raw['guide'] === 'string' && raw['guide'] !== '' ? raw['guide'] : null,
    formatting: coerceProfile(raw['formatting']),
    writeMode: mode === 'read' || mode === 'write' ? mode : 'propose',
    excluded: Array.isArray(raw['excluded']) ? raw['excluded'].filter((e): e is string => typeof e === 'string' && e.trim() !== '') : [],
    cloud: raw['cloud'] === true,
  }
}

/** Is `path` one of `excluded`, or inside one of them? Case-insensitive, like the file system. */
export function isExcludedPath(path: string, excluded: readonly string[]): boolean {
  // Any case and any Unicode form, as the disk compares names: a folder typed "Café" is the one the Mac wrote decomposed.
  const lower = path.normalize('NFC').toLowerCase()
  return excluded.some((entry) => {
    const e = entry.normalize('NFC').toLowerCase().replace(/^\/+|\/+$/g, '')
    return e !== '' && (lower === e || lower === `${e}.md` || lower.startsWith(`${e}/`))
  })
}

/** One file a proposal changes: its text when proposed (null: a new file) and after. */
export type FileChange = { path: string; before: string | null; after: string }

export type ProposalStatus = 'pending' | 'applied' | 'discarded' | 'stale'

export type Proposal = {
  id: string
  /** Who asked: the client's id, as its config names it. */
  client: string
  tool: string
  /** One line for the list: "Append to 2026-11-01". */
  summary: string
  created: number
  status: ProposalStatus
  files: FileChange[]
  /** Formatting rules applied to the AI's lines. */
  formatted: string[]
  /**
   * A change to a canvas, as edits each accepted or rejected on the canvas
   * (shared/canvas-ops.ts). `files` then holds the canvas with every edit
   * applied, for the list.
   */
  canvas?: CanvasProposal
}

export type ActivityEntry = {
  at: number
  client: string
  tool: string
  /** The arguments, summarised: paths and short queries, never note text. */
  args: string
  outcome: 'ok' | 'error' | 'proposed' | 'applied'
  error?: string
}

export type ClientId = 'claude-code' | 'codex' | 'claude-desktop' | 'cursor'

export type ClientStatus = {
  id: ClientId
  name: string
  installed: boolean
  state: 'connected' | 'not-connected' | 'broken'
  /** Why it is broken, or where its config is. */
  detail: string | null
  /** Where to get it, when it is not installed. */
  url: string
}

/** What Connect or Disconnect will do, shown before it is done. */
export type ClientPlan = { ok: true; file: string; lines: string; note: string | null } | { ok: false; error: string }
