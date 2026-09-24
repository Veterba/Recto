/**
 * `.recto/autolinks.json`: everything auto-links knows that is the user's
 * rather than the cache's, so it survives an index rebuild.
 *
 *  - `rejected`: pairs never to suggest or add again.
 *  - `confirmed`: auto-links the user moved into `Links` - kept on purpose.
 *  - `written`: per note, the targets we put in its property. Only these are
 *    ever ours to remove; a note with no entry here owns its whole property.
 *  - `auto`: every link Auto added and what became of it, the feedback that
 *    can raise T_AUTO.
 *  - `raisedBy` / `adjustments`: how far feedback has raised T_AUTO, and when.
 *
 * Pure - read and written by the service through the state files.
 */

export type AutoLinkOutcome = 'deleted' | 'confirmed'
import type { LinkScore } from '../../shared/autolinks'

/** One link Auto added, how it scored (sem, total, which bonuses fired), and what became of it. */
export type AutoAdded = {
  source: string
  target: string
  score: number
  at: number
  /** The scheduled run that wrote it, for "Undo last run". */
  run?: number
  outcome?: AutoLinkOutcome
} & Partial<LinkScore>
/** A feedback raise: by how much, how many of the window were deleted, and how many auto-links existed then. */
export type Adjustment = { at: number; by: number; deleted: number; count: number }

export type AutolinkRecord = {
  rejected: [string, string][]
  confirmed: [string, string][]
  written: Record<string, string[]>
  auto: AutoAdded[]
  raisedBy: number
  adjustments: Adjustment[]
}

export const emptyRecord = (): AutolinkRecord => ({
  rejected: [],
  confirmed: [],
  written: {},
  auto: [],
  raisedBy: 0,
  adjustments: [],
})

const isPair = (p: unknown): p is [string, string] =>
  Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** A hand-edited file is read field by field; anything malformed is dropped, not fatal. */
export function coerceRecord(raw: unknown): AutolinkRecord {
  const value = isObject(raw) ? raw : {}
  const written: Record<string, string[]> = {}
  if (isObject(value['written'])) {
    for (const [path, targets] of Object.entries(value['written'])) {
      if (Array.isArray(targets)) written[path] = targets.filter((t): t is string => typeof t === 'string')
    }
  }
  const auto = Array.isArray(value['auto'])
    ? value['auto'].filter(
        (a): a is AutoAdded => isObject(a) && typeof a['source'] === 'string' && typeof a['target'] === 'string',
      )
    : []
  const adjustments = Array.isArray(value['adjustments'])
    ? value['adjustments'].filter((a): a is Adjustment => isObject(a) && typeof a['by'] === 'number')
    : []
  return {
    rejected: Array.isArray(value['rejected']) ? value['rejected'].filter(isPair) : [],
    confirmed: Array.isArray(value['confirmed']) ? value['confirmed'].filter(isPair) : [],
    written,
    auto: auto.map((a) => ({ ...a, score: typeof a.score === 'number' ? a.score : 0, at: typeof a.at === 'number' ? a.at : 0 })),
    raisedBy: typeof value['raisedBy'] === 'number' ? value['raisedBy'] : 0,
    adjustments,
  }
}

/** What we wrote to this note. No entry: nothing - every link there is the user's. */
export const writtenTo = (record: AutolinkRecord, path: string): string[] => record.written[path] ?? []

export function setWritten(record: AutolinkRecord, path: string, targets: readonly string[]): AutolinkRecord {
  const written = { ...record.written }
  if (targets.length === 0) delete written[path]
  else written[path] = [...targets]
  return { ...record, written }
}

const hasPair = (pairs: readonly [string, string][], source: string, target: string): boolean =>
  pairs.some(([s, t]) => s === source && t === target)

export const isRejected = (record: AutolinkRecord, source: string, target: string): boolean =>
  hasPair(record.rejected, source, target)

export function addRejected(record: AutolinkRecord, source: string, target: string): AutolinkRecord {
  if (isRejected(record, source, target)) return record
  return { ...record, rejected: [...record.rejected, [source, target]] }
}

export function addConfirmed(record: AutolinkRecord, source: string, target: string): AutolinkRecord {
  if (hasPair(record.confirmed, source, target)) return record
  return { ...record, confirmed: [...record.confirmed, [source, target]] }
}

export const addAuto = (
  record: AutolinkRecord,
  added: readonly ({ source: string; target: string; score: number } & Partial<LinkScore>)[],
  at: number,
  run?: number,
): AutolinkRecord => ({
  ...record,
  auto: [...record.auto, ...added.map((a) => ({ ...a, at, ...(run === undefined ? {} : { run }) }))],
})

/**
 * The links the most recent run wrote that are still there: not deleted,
 * not confirmed, still in the note's record. Grouped by note.
 */
export function lastRun(record: AutolinkRecord): { run: number; bySource: Map<string, string[]> } | null {
  const runs = record.auto.flatMap((a) => (a.run === undefined ? [] : [a.run]))
  if (runs.length === 0) return null
  const run = Math.max(...runs)
  const bySource = new Map<string, string[]>()
  for (const a of record.auto) {
    if (a.run !== run || a.outcome !== undefined || !writtenTo(record, a.source).includes(a.target)) continue
    bySource.set(a.source, [...(bySource.get(a.source) ?? []), a.target])
  }
  return bySource.size === 0 ? null : { run, bySource }
}

/** Mark the most recent Auto add of this pair with what became of it. */
export function setOutcome(record: AutolinkRecord, source: string, target: string, outcome: AutoLinkOutcome): AutolinkRecord {
  const auto = [...record.auto]
  for (let i = auto.length - 1; i >= 0; i--) {
    const a = auto[i]!
    if (a.source === source && a.target === target) {
      if (a.outcome === undefined) auto[i] = { ...a, outcome }
      break
    }
  }
  return { ...record, auto }
}

/**
 * Follow a rename or a folder move through every path in the record, as keys
 * and as targets - otherwise a renamed target would look deleted and its link
 * would be dropped, and a renamed note would lose its ownership record.
 */
export function renameInRecord(record: AutolinkRecord, from: string, to: string): AutolinkRecord {
  const map = (p: string): string => (p === from ? to : p.startsWith(`${from}/`) ? `${to}${p.slice(from.length)}` : p)
  const written: Record<string, string[]> = {}
  for (const [path, targets] of Object.entries(record.written)) written[map(path)] = targets.map(map)
  return {
    ...record,
    rejected: record.rejected.map(([s, t]) => [map(s), map(t)]),
    confirmed: record.confirmed.map(([s, t]) => [map(s), map(t)]),
    written,
    auto: record.auto.map((a) => ({ ...a, source: map(a.source), target: map(a.target) })),
  }
}
