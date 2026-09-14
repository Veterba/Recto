/**
 * Link counts, grouped for the "links per note" filter.
 *
 * Doubling bins, because link counts in a vault are wildly skewed: most notes
 * have 0-3 links and a handful have hundreds. Even-width bins would give one
 * bar for nearly everything and forty empty ones.
 */

export type DegreeBin = { label: string; min: number; max: number }

export const DEGREE_BINS: readonly DegreeBin[] = [
  { label: '0', min: 0, max: 0 },
  { label: '1', min: 1, max: 1 },
  { label: '2', min: 2, max: 2 },
  { label: '3–4', min: 3, max: 4 },
  { label: '5–8', min: 5, max: 8 },
  { label: '9–16', min: 9, max: 16 },
  { label: '17–32', min: 17, max: 32 },
  { label: '33–64', min: 33, max: 64 },
  { label: '65+', min: 65, max: Infinity },
]

/** Kept notes' link counts: `max` null means no upper limit. */
export type LinkRange = { min: number; max: number | null }

export const ALL_LINKS: LinkRange = { min: 0, max: null }

export const binOf = (degree: number): number => {
  const i = DEGREE_BINS.findIndex((bin) => degree >= bin.min && degree <= bin.max)
  return i < 0 ? DEGREE_BINS.length - 1 : i
}

export function histogram(degrees: Iterable<number>): number[] {
  const counts = new Array<number>(DEGREE_BINS.length).fill(0)
  for (const degree of degrees) counts[binOf(degree)]!++
  return counts
}

/** The range as bin indices, for the slider. */
export function rangeToBins(range: LinkRange): [number, number] {
  return [binOf(range.min), range.max === null ? DEGREE_BINS.length - 1 : binOf(range.max)]
}

export function binsToRange(low: number, high: number): LinkRange {
  const last = DEGREE_BINS.length - 1
  return { min: DEGREE_BINS[low]?.min ?? 0, max: high >= last ? null : (DEGREE_BINS[high]?.max ?? null) }
}

export const inRange = (degree: number, range: LinkRange): boolean =>
  degree >= range.min && (range.max === null || degree <= range.max)

export function coerceLinkRange(raw: unknown): LinkRange {
  const r = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const min = typeof r['min'] === 'number' && Number.isFinite(r['min']) && r['min'] >= 0 ? Math.floor(r['min']) : 0
  const max = typeof r['max'] === 'number' && Number.isFinite(r['max']) && r['max'] >= min ? Math.floor(r['max']) : null
  return { min, max }
}
