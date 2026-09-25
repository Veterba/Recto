/**
 * Note vectors for topics.
 *
 * Raw embeddings of one vault share a large common direction - everything in
 * a vault about programming is "about programming" - which crushes every
 * similarity towards the same high number. Subtracting the vault's mean chunk
 * vector removes that shared part, so what is left is what sets a note apart.
 */

/** A note contributes at most this many chunks, evenly spaced: a 500-chunk log is one note, not 500 votes. */
export const MAX_CHUNKS = 48

export function normalise(v: Float32Array): Float32Array {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!
  n = Math.sqrt(n) || 1
  for (let i = 0; i < v.length; i++) v[i]! /= n
  return v
}

export const cosine = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0)
  return s
}

/** The mean of every chunk vector in the vault. */
export function vaultMean(chunks: readonly ArrayLike<number>[], dims: number): Float32Array {
  const out = new Float32Array(dims)
  for (const c of chunks) for (let i = 0; i < dims; i++) out[i]! += c[i] ?? 0
  if (chunks.length > 0) for (let i = 0; i < dims; i++) out[i]! /= chunks.length
  return out
}

/** Indices of at most `cap` evenly spaced items out of `n`. */
export function evenly(n: number, cap: number): number[] {
  if (n <= cap) return Array.from({ length: n }, (_, i) => i)
  return Array.from({ length: cap }, (_, i) => Math.round((i * (n - 1)) / (cap - 1)))
}

/** One vector minus the vault mean, normalised. */
export function centre(v: ArrayLike<number>, mean: Float32Array): Float32Array {
  const c = new Float32Array(mean.length)
  for (let i = 0; i < mean.length; i++) c[i] = (v[i] ?? 0) - mean[i]!
  return normalise(c)
}

/** The chunks a note vector uses: at most MAX_CHUNKS, evenly spaced. The vault mean is taken over these too. */
export const capped = <T>(chunks: readonly T[]): T[] => evenly(chunks.length, MAX_CHUNKS).map((i) => chunks[i]!)

/** Centre each chunk on the vault mean, re-normalise, average, normalise. Null for a note with no chunks. */
export function noteVector(chunks: readonly ArrayLike<number>[], mean: Float32Array): Float32Array | null {
  if (chunks.length === 0) return null
  const out = new Float32Array(mean.length)
  for (const chunk of capped(chunks)) {
    const c = centre(chunk, mean)
    for (let i = 0; i < mean.length; i++) out[i]! += c[i]!
  }
  return normalise(out)
}

/** The normalised mean of members' vectors. */
export function centroid(vectors: readonly ArrayLike<number>[]): Float32Array {
  const dims = vectors[0]?.length ?? 0
  const out = new Float32Array(dims)
  for (const v of vectors) for (let i = 0; i < dims; i++) out[i]! += v[i] ?? 0
  return normalise(out)
}
