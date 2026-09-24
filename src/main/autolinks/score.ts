/**
 * Deciding: when a note is looked at, how a candidate scores, what gets kept.
 *
 * Pure numbers in, decisions out - no model, no files - so every rule here is
 * tested on its own. The numbers are the spec's; the one that is NOT a
 * constant is T_ADD, which comes from calibration against the vault's own
 * manual links.
 */

import type { CalibrationReport, CalibrationRow } from '../../shared/autolinks'
import { mentions } from './text'

export const DRIFT_COSINE = 0.92
export const GROWTH = 0.3
export const TITLE_BONUS = 0.15
export const TAG_BONUS = 0.05
export const TAG_CAP = 0.1
export const COCITE_BONUS = 0.05
export const HUB_WEIGHT = 0.04
export const HYSTERESIS = 0.85
export const CANDIDATES = 20
export const PRECISION_TARGET = 0.7
/** Random pairs sampled to learn what "similar by chance" means in a vault. */
export const SAMPLE_PAIRS = 500
export const AUTO_FLOOR = 0.75
export const AUTO_PERCENTILE = 0.99
export const SUGGEST_FLOOR = 0.7
export const SUGGEST_PERCENTILE = 0.95
/** Auto adds at most this many links to a note. */
export const AUTO_MAX_LINKS = 2
/** Feedback: over the last 20 auto-links, more than a third deleted raises T_AUTO by 0.02, up to 0.90. */
export const FEEDBACK_WINDOW = 20
export const FEEDBACK_SHARE = 1 / 3
export const RAISE_STEP = 0.02
export const RAISE_CAP = 0.9

export const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0)
  return sum
}

/** Mean of unit vectors, re-normalised. */
export function meanVector(vectors: readonly ArrayLike<number>[]): Float32Array {
  const dims = vectors[0]?.length ?? 0
  const out = new Float32Array(dims)
  for (const v of vectors) for (let i = 0; i < dims; i++) out[i]! += v[i] ?? 0
  const norm = Math.hypot(...out) || 1
  for (let i = 0; i < dims; i++) out[i]! /= norm
  return out
}

export type EvalState = { evaluatedAt: number | null; meanVec: ArrayLike<number> | null; ownWords: number }

/**
 * Is this note ready to be looked at? Quiet for long enough (by mtime, so an
 * edit from Obsidian counts), long enough, and either never evaluated or
 * changed in meaning or size since it was.
 */
export function isSettled(input: {
  now: number
  mtime: number
  quietMs: number
  ownWords: number
  minWords: number
  state: EvalState | null
  currentMean: ArrayLike<number> | null
}): boolean {
  const { now, mtime, quietMs, ownWords, minWords, state, currentMean } = input
  if (now - mtime < quietMs) return false
  if (ownWords < minWords) return false
  if (state === null || state.evaluatedAt === null || state.meanVec === null) return true
  if (currentMean !== null && dot(currentMean, state.meanVec) < DRIFT_COSINE) return true
  return ownWords >= state.ownWords * (1 + GROWTH)
}

/** sem: the mean of the best two chunk-to-chunk similarities. */
export function semantic(sims: readonly number[]): number {
  if (sims.length === 0) return -1
  let first = -Infinity
  let second = -Infinity
  for (const s of sims) {
    if (s > first) {
      second = first
      first = s
    } else if (s > second) second = s
  }
  return second === -Infinity ? first : (first + second) / 2
}

/**
 * sem(source -> target): every source chunk against every target chunk and
 * the target's title vector, and which source chunk carried the best match
 * (the reason shown to the user).
 */
export function compareVectors(
  source: readonly ArrayLike<number>[],
  target: readonly ArrayLike<number>[],
): { sem: number; bestChunk: number } {
  const sims: number[] = []
  let bestChunk = 0
  let best = -Infinity
  source.forEach((chunk, i) => {
    for (const other of target) {
      const s = dot(chunk, other)
      sims.push(s)
      if (s > best) {
        best = s
        bestChunk = i
      }
    }
  })
  return { sem: semantic(sims), bestChunk }
}

export type TargetFacts = {
  /** Title and aliases, matched verbatim in the source's own text. */
  names: readonly string[]
  tags: ReadonlySet<string>
  /** Resolved outgoing links. */
  out: ReadonlySet<string>
  inDegree: number
}

export type SourceFacts = { ownText: string; tags: ReadonlySet<string>; out: ReadonlySet<string> }

export type ScoreTerms = { sem: number; title: number; tags: number; cocite: number; hub: number; total: number }

export function score(sem: number, target: string, source: SourceFacts, facts: TargetFacts): ScoreTerms {
  const title = facts.names.some((name) => mentions(source.ownText, name)) ? TITLE_BONUS : 0
  let shared = 0
  for (const tag of facts.tags) if (source.tags.has(tag)) shared++
  const tags = Math.min(TAG_CAP, shared * TAG_BONUS)
  let cocite = 0
  for (const third of facts.out) {
    if (third !== target && source.out.has(third)) {
      cocite = COCITE_BONUS
      break
    }
  }
  const hub = -HUB_WEIGHT * Math.log2(1 + facts.inDegree / 5)
  return { sem, title, tags, cocite, hub, total: sem + title + tags + cocite + hub }
}

export type Scored = { target: string; sem: number; total: number }

export const MIN_NAME_LENGTH = 4

/**
 * Which of a target's names may earn the title bonus. A mention of a name
 * only means something if the name picks out one note: so it must be unique
 * in the vault, not a generic word, and at least four characters. Three
 * notes called `index` and a sentence about "the index" is not a reference.
 */
export function mentionableNames(
  names: readonly string[],
  isUnique: (name: string) => boolean,
  generic: readonly string[],
): string[] {
  const banned = new Set(generic.map((g) => g.trim().toLowerCase()))
  return names.filter((name) => {
    const n = name.trim()
    return [...n].length >= MIN_NAME_LENGTH && !banned.has(n.toLowerCase()) && isUnique(n)
  })
}

/**
 * What to suggest: candidates whose sem clears the bar, best score first.
 * The bar is a percentile of raw sem, so it is compared with sem alone - a
 * bonus can reorder the candidates that passed, never lift one over.
 */
export function pick<T extends Scored>(scored: readonly T[], bar: number, max: number): T[] {
  return scored.filter((s) => s.sem >= bar).sort((a, b) => b.total - a.total).slice(0, max)
}

const percentile = (sorted: readonly number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] ?? 0

/**
 * T_AUTO and T_SUGGEST from a sample of random pairs: how similar two notes
 * in THIS vault are by chance. A fixed bar cannot know that - with this model
 * an unrelated pair sits around 0.6, and a vault about one subject is similar
 * to itself everywhere.
 */
export function vaultThresholds(sems: readonly number[]): { tAuto: number; tSuggest: number } {
  const sorted = [...sems].sort((a, b) => a - b)
  const round = (x: number): number => Math.round(x * 1000) / 1000
  return {
    tAuto: round(Math.max(AUTO_FLOOR, percentile(sorted, AUTO_PERCENTILE))),
    tSuggest: round(Math.max(SUGGEST_FLOOR, percentile(sorted, SUGGEST_PERCENTILE))),
  }
}

/** The measured base plus the feedback raise; the raise never takes it past 0.90. */
export const effectiveAuto = (base: number | null, raisedBy: number): number | null =>
  base === null ? null : Math.max(base, Math.min(RAISE_CAP, base + raisedBy))

/**
 * Should T_AUTO go up? Over the last 20 links Auto added, more than a third
 * deleted by hand says it is adding too much. Only a full window counts, and
 * only one made entirely of links added since the last raise - each raise is
 * judged on fresh evidence, never on the links that caused the previous one.
 * It never goes down on its own.
 */
export function shouldRaise(
  auto: readonly { outcome?: string }[],
  lastRaiseCount: number,
  base: number | null,
  raisedBy: number,
): { raise: boolean; deleted: number } {
  const window = auto.slice(-FEEDBACK_WINDOW)
  const deleted = window.filter((a) => a.outcome === 'deleted').length
  const current = effectiveAuto(base, raisedBy)
  const fresh = auto.length - lastRaiseCount >= FEEDBACK_WINDOW
  return {
    raise: window.length === FEEDBACK_WINDOW && fresh && deleted > FEEDBACK_WINDOW * FEEDBACK_SHARE && current !== null && current < RAISE_CAP,
    deleted,
  }
}

/**
 * The property's entries after an Auto evaluation. Only targets in `ours` -
 * what the record says we wrote - can leave; every other entry is the user's
 * and stays, in place. New targets are appended.
 */
export function autoEntries(
  entries: readonly string[],
  resolve: (entry: string) => string | null,
  ours: ReadonlySet<string>,
  next: readonly string[],
  linkText: (path: string) => string,
): string[] {
  const nextSet = new Set(next)
  const kept = entries.filter((entry) => {
    const target = resolve(entry)
    return target === null || !ours.has(target) || nextSet.has(target)
  })
  const present = new Set(kept.flatMap((entry) => resolve(entry) ?? []))
  return [...kept, ...next.filter((t) => !present.has(t)).map(linkText)]
}

/**
 * Auto mode's next set. A link we added stays until its score falls below
 * 0.85 x T_ADD; a new one needs the full T_ADD. The gap is what stops a link
 * appearing and vanishing on alternate evaluations.
 */
export function planAuto(previous: readonly string[], scored: readonly Scored[], tAuto: number, max: number): string[] {
  const byTarget = new Map(scored.map((s) => [s.target, s]))
  // The gate is on sem, like the threshold it is measured against; the score
  // only decides which of the passing candidates get the slots.
  const keep = previous.flatMap((t) => {
    const s = byTarget.get(t)
    return s !== undefined && s.sem >= HYSTERESIS * tAuto ? [s] : []
  })
  const kept = new Set(keep.map((s) => s.target))
  const add = scored.filter((s) => !kept.has(s.target) && s.sem >= tAuto)
  return [...keep, ...add]
    .sort((a, b) => b.total - a.total)
    .slice(0, max)
    .map((s) => s.target)
}

/**
 * What happened to the links we wrote that are no longer in the property.
 * Linked somewhere else in the note: the user moved it (to `Links`, into the
 * text) - pinned, theirs now. Gone entirely: deleted by hand - a rejection.
 */
export function reconcileWritten(
  lastWritten: readonly string[],
  inProperty: ReadonlySet<string>,
  linkedElsewhere: ReadonlySet<string>,
): { still: string[]; pinned: string[]; rejected: string[] } {
  const still: string[] = []
  const pinned: string[] = []
  const rejected: string[] = []
  for (const target of lastWritten) {
    if (inProperty.has(target)) still.push(target)
    else if (linkedElsewhere.has(target)) pinned.push(target)
    else rejected.push(target)
  }
  return { still, pinned, rejected }
}

/** One hidden manual link: the scores of the top predictions, and which was right. */
export type Trial = { predictions: readonly { total: number; hit: boolean }[] }

/**
 * Precision and recall of the top-N at each threshold. A trial is one hidden
 * link; a prediction at threshold t is a top-N candidate scoring >= t, and it
 * is right when it is the hidden link.
 */
export function sweep(trials: readonly Trial[], thresholds: readonly number[]): CalibrationRow[] {
  return thresholds.map((threshold) => {
    let predicted = 0
    let hits = 0
    for (const trial of trials) {
      for (const p of trial.predictions) {
        if (p.total < threshold) continue
        predicted++
        if (p.hit) hits++
      }
    }
    return {
      threshold,
      precision: predicted === 0 ? 0 : hits / predicted,
      recall: trials.length === 0 ? 0 : hits / trials.length,
      predicted,
    }
  })
}

/** The lowest threshold whose precision reaches the target - with something to show for it. */
export function chooseThreshold(rows: readonly CalibrationRow[]): number | null {
  const ok = rows.filter((r) => r.predicted > 0 && r.precision >= PRECISION_TARGET)
  return ok.length === 0 ? null : Math.min(...ok.map((r) => r.threshold))
}

export const THRESHOLDS: readonly number[] = Array.from({ length: 66 }, (_, i) => Math.round((0.3 + i * 0.01) * 100) / 100)

export function calibrationReport(trials: readonly Trial[], at: number): CalibrationReport {
  const rows = sweep(trials, THRESHOLDS)
  return { at, links: trials.length, rows, chosen: chooseThreshold(rows) }
}
