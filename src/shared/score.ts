/**
 * When a note is looked at again: the settle rule, and the vector helpers it
 * needs. Pure, so each rule is tested on its own.
 */

export const DRIFT_COSINE = 0.92
export const GROWTH = 0.3

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
