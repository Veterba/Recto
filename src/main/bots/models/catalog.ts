import type { ModelChoice } from '../../../shared/bots'
import { profileFor } from './profiles'

/**
 * Which local models the picker offers, with a hint for each chosen by this
 * Mac's memory. Sizes are the download sizes from Ollama's registry (looked up
 * when this list was written; the app itself never contacts the registry).
 */

export const RECOMMENDED: readonly { name: string; bytes: number; blurb: string }[] = [
  { name: 'qwen3.5:9b', bytes: 6_590_000_000, blurb: 'Good in Russian and English' },
  { name: 'gemma4:12b', bytes: 8_020_000_000, blurb: 'Better languages, slower' },
  { name: 'gemma4:e4b', bytes: 6_580_000_000, blurb: 'Fastest, simpler answers' },
]

/** A model fits when it takes at most this share of memory: room for the app, the system and the context. */
const FIT_SHARE = 0.5
/** Above this share it fits, but tightly. */
const TIGHT_SHARE = 0.44

/** The model recommended for this much memory. */
export const recommendedFor = (ramBytes: number): string => (ramBytes >= 24 * 2 ** 30 ? 'gemma4:12b' : 'qwen3.5:9b')

const gb = (bytes: number): number => Math.round(bytes / 1e9)

/** What the picker says about one model on this Mac. */
export function hintFor(name: string, bytes: number, ramBytes: number): { hint: string; fits: boolean } {
  if (bytes > ramBytes * FIT_SHARE) return { hint: 'Too big for this Mac', fits: false }
  if (name === recommendedFor(ramBytes)) return { hint: 'Recommended', fits: true }
  const blurb = RECOMMENDED.find((m) => m.name === name)?.blurb
  const tight = bytes > ramBytes * TIGHT_SHARE ? `tight on ${Math.round(ramBytes / 2 ** 30)} GB` : null
  return { hint: [blurb, tight].filter((p) => p !== undefined && p !== null).join(', ') || `${gb(bytes)} GB`, fits: true }
}

/**
 * The picker's local list: installed models that can chat, then the
 * recommended ones not installed yet, each with its size, hint and whether it
 * fits.
 */
export function localChoices(installed: readonly { name: string; bytes: number }[], ramBytes: number): ModelChoice[] {
  const have = installed.map(({ name, bytes }) => ({
    name,
    bytes,
    installed: true,
    untested: !profileFor(name).tested,
    ...hintFor(name, bytes, ramBytes),
  }))
  const missing = RECOMMENDED.filter((m) => !installed.some((i) => i.name === m.name)).map(({ name, bytes }) => ({
    name,
    bytes,
    installed: false,
    untested: false,
    ...hintFor(name, bytes, ramBytes),
  }))
  return [...have, ...missing]
}
