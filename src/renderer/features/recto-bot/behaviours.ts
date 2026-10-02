/**
 * What the bot is doing: the behaviours, how it picks one, and the face each
 * one asks for at a moment in time. Pure - randomness comes in as a function,
 * so a seeded source makes every choice repeatable.
 *
 * The numbers are the approved prototype's (docs/design/recto-bot-reference.html,
 * the switch in its frame loop). They are tuned; change them there first.
 */

import type { BehaviourId, Weights } from '@shared/bot-presets'
import { clamp } from './face'

export type Random = () => number

/** A repeatable Random (mulberry32): the same seed gives the same sequence. */
export function seededRandom(seed: number): Random {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type { BehaviourId, Weights }
/** `watch` is never picked by weight: interest in the cursor starts it. */
export type ActiveBehaviour = BehaviourId | 'watch'

export const BEHAVIOURS: Record<BehaviourId, { label: string; about: string; ms: number }> = {
  daydream: { label: 'Daydreaming', about: 'Looks up and aside, lids a little low, gaze drifts.', ms: 4500 },
  bored: { label: 'Bored', about: 'Looks away and down, heavy lids, a sigh now and then.', ms: 4500 },
  eyeroll: { label: 'Eye roll', about: 'Eyes sweep up and over in an arc, then settle half-closed.', ms: 2000 },
  glance: { label: 'Glance', about: 'A quick look somewhere and back.', ms: 1400 },
  scan: { label: 'Reading', about: 'Eyes run along its own lines, line by line.', ms: 4300 },
  doze: { label: 'Dozing', about: 'Lids sink slowly, then it startles awake and looks around.', ms: 5600 },
  squint: { label: 'Suspicious', about: 'Narrows its eyes, lids slanted.', ms: 2600 },
  curious: { label: 'Curious', about: 'Wide eyes, a quick look, a tiny hop. Also on click.', ms: 1600 },
}

export const rnd = (random: Random, lo: number, hi: number): number => lo + random() * (hi - lo)
const pick = <T>(random: Random, items: readonly T[]): T => items[Math.floor(random() * items.length)]!

/** One behaviour by weight. Curious is never picked: only a click starts it. */
export function pickBehaviour(random: Random, weights: Weights): BehaviourId {
  const entries = Object.entries(weights) as [BehaviourId, number][]
  let r = random() * entries.reduce((sum, [, w]) => sum + w, 0)
  for (const [id, w] of entries) if ((r -= w) < 0) return id
  return 'glance'
}

/**
 * How long a behaviour runs: its duration (the bot's own, or the default),
 * varied by 0.85-1.2 unless it is looping on its own.
 */
export function behaviourMs(id: BehaviourId, random: Random, varied = true, durations: Partial<Record<BehaviourId, number>> = {}): number {
  return (durations[id] ?? BEHAVIOURS[id].ms) * (varied ? rnd(random, 0.85, 1.2) : 1)
}

// --- interest in the cursor --------------------------------------------------

/** Within this distance (or 2.5 × the bot's size) a moving cursor counts as nearby. */
export const NEAR_PX = 360
/** How far, in px, a full sideways look reaches. */
export const GAZE_PX = 220

export const isNear = (distance: number, size: number): boolean => distance < Math.max(NEAR_PX, size * 2.5)

/**
 * Rises while the cursor moves nearby; otherwise decays. Curiosity scales both:
 * at 0.5 (the reference) interest rises 1.6 a second and fades from full to
 * none in about four; a more curious bot catches on faster and stays longer.
 */
export function nextInterest(interest: number, dt: number, movingNearby: boolean, curiosity = 0.5): number {
  const c = Math.max(0.05, curiosity)
  return movingNearby ? Math.min(1, interest + dt * 3.2 * c) : Math.max(0, interest - (dt * 0.125) / c)
}

/**
 * Whether to start watching the cursor this frame. The prototype rolled 4% a
 * frame at 60 fps; this is the same rate at any frame rate.
 */
export function startsWatching(interest: number, movingNearby: boolean, dt: number, random: Random): boolean {
  return interest > 0.55 && movingNearby && random() < 1 - Math.pow(0.96, dt * 60)
}

export const WATCH_MS: readonly [number, number] = [2500, 4500]

/** Watching stops when the cursor leaves or the bot loses interest. */
export const stopsWatching = (near: boolean, interest: number): boolean => !near || interest < 0.2

// --- the face each behaviour asks for ------------------------------------------

export type Point = { x: number; y: number }

export type Face = {
  /** Where the eyes want to look, -1..1 each way. */
  target: Point
  upper: number
  lower: number
  slant: number
  wide: number
  /** Squash target: 1 is none. */
  squash: number
  /** True on the frame a behaviour wants a hop. */
  hop: boolean
}

export type FaceContext = {
  /** Seconds since the behaviour began. */
  pt: number
  /** Seconds, a free-running clock (drifts and sweeps use it). */
  t: number
  /** The cursor's direction, -1..1. */
  cursor: Point
  /** Looping one behaviour for show: no cursor to look at. */
  forced: boolean
  /** Per-behaviour memory, cleared when the behaviour starts. */
  memo: Record<string, unknown>
  random: Random
}

const once = (memo: Record<string, unknown>, key: string): boolean => {
  if (memo[key] === true) return false
  memo[key] = true
  return true
}

function remember<T>(memo: Record<string, unknown>, key: string, make: () => T): T {
  if (memo[key] === undefined) memo[key] = make()
  return memo[key] as T
}

export function faceFor(behaviour: ActiveBehaviour, c: FaceContext): Face {
  const face: Face = { target: { x: 0, y: 0 }, upper: 0, lower: 0, slant: 0, wide: 1, squash: 1, hop: false }
  const { pt, t, memo, random } = c
  switch (behaviour) {
    case 'watch':
      face.target = c.cursor
      face.upper = 0.05
      break
    case 'curious':
      face.target = c.forced ? { x: Math.sin(t * 2) * 0.6, y: 0 } : c.cursor
      face.wide = 1.22
      face.hop = pt < 0.1 && once(memo, 'hop')
      break
    case 'daydream': {
      const d = remember(memo, 'd', () => ({ x: pick(random, [-1, 1]) * rnd(random, 0.5, 0.9), y: -rnd(random, 0.6, 0.95) }))
      face.target = { x: d.x + Math.sin(t * 0.7) * 0.12, y: d.y + Math.cos(t * 0.5) * 0.08 }
      face.upper = 0.28
      break
    }
    case 'bored': {
      const side = remember(memo, 's', () => pick(random, [-1, 1]))
      face.target = { x: side * 0.95, y: 0.45 }
      face.upper = 0.48
      if (pt % 2.6 < 0.5) face.squash = 0.93
      break
    }
    case 'eyeroll': {
      const p = clamp(pt / 0.9, 0, 1)
      const a = Math.PI * (1 - p)
      face.target = { x: Math.cos(a) * 0.9, y: -Math.sin(a) * 0.95 }
      face.upper = p > 0.95 ? 0.42 : 0.12
      break
    }
    case 'glance': {
      const g = remember(memo, 'g', () => ({ x: pick(random, [-1, 1]) * rnd(random, 0.6, 1), y: rnd(random, -0.7, 0.5) }))
      face.target = pt < 0.7 ? g : { x: 0, y: 0 }
      break
    }
    case 'scan': {
      const along = (pt * 0.7) % 1
      const line = Math.floor(pt * 0.7) % 3
      face.target = { x: -0.75 + along * 1.5, y: 0.55 + line * 0.17 }
      face.upper = 0.18
      break
    }
    case 'doze': {
      const sink = clamp(pt / 3.2, 0, 1)
      face.upper = 0.15 + sink * 0.8
      face.target = { x: 0, y: 0.3 }
      if (pt > 3.6 && pt < 3.75) {
        // The startle.
        face.upper = 0
        face.wide = 1.25
        face.hop = once(memo, 'hop')
      }
      if (pt > 3.75) {
        face.upper = 0
        face.wide = 1.12
        face.target = { x: Math.sin(pt * 9) > 0 ? 0.8 : -0.8, y: -0.1 }
      }
      break
    }
    case 'squint':
      face.target = c.forced ? { x: Math.sin(t * 0.8) * 0.5, y: 0 } : c.cursor
      face.upper = 0.42
      face.lower = 0.32
      face.slant = 0.5
      break
  }
  return face
}
