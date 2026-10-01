/**
 * Bots as data. Every bot is Recto's family: the same figure and the same
 * behaviours, with its own face (BotLook) and its own temperament
 * (BotPersonality). A new bot is a preset here, not new code.
 */

import type { BehaviourId, Weights } from './behaviours'

export type BotLook = {
  /** The silhouette. Only 'page' is drawn yet; the others are for later bots. */
  paper: 'page' | 'card' | 'sticky'
  /**
   * The eyes at full size, in SVG units: capsule width and height, and how far
   * each eye sits from the centre line. Small bots (under 60px) scale them up
   * by the same ratios as the reference (6.6/5 wide, 13.5/12 tall).
   */
  eyes: { width: number; height: number; spacing: number }
}

export type BotPersonality = {
  weights: Weights
  /** Per-behaviour durations in ms, replacing the defaults. */
  durations?: Partial<Record<BehaviourId, number>>
  /** The pause between blinks, ms. A fifth of blinks are doubled regardless. */
  blinkEvery: readonly [number, number]
  /** How long the gaze holds before its next jump, ms: a calm bot moves its eyes slower. */
  saccade: readonly [number, number]
  /** 0..1: how fast interest in the cursor rises and how long it lasts. 0.5 is the reference. */
  curiosity: number
}

export type BotPreset = { name: string; about: string; look: BotLook; personality: BotPersonality }

/** Recto itself: the approved reference tuning. */
export const RECTO: BotPreset = {
  name: 'Recto',
  about: 'The reference tuning.',
  look: { paper: 'page', eyes: { width: 5, height: 12, spacing: 8.4 } },
  personality: {
    weights: { daydream: 0.2, bored: 0.18, glance: 0.16, scan: 0.13, eyeroll: 0.08, doze: 0.07, squint: 0.07 },
    blinkEvery: [2000, 5200],
    saccade: [180, 520],
    curiosity: 0.5,
  },
}

/** An example: slow eyes, long daydreams, dozes off easily, barely notices the cursor. */
export const CALM: BotPreset = {
  name: 'Calm',
  about: 'More daydreams and dozing, slower eyes, slow blinks, hardly bothered by the cursor.',
  look: { paper: 'page', eyes: { width: 5.6, height: 10.5, spacing: 9 } },
  personality: {
    weights: { daydream: 0.34, doze: 0.2, bored: 0.16, scan: 0.14, glance: 0.08, eyeroll: 0.04, squint: 0.04 },
    durations: { daydream: 6000, doze: 7000 },
    blinkEvery: [3200, 7000],
    saccade: [420, 950],
    curiosity: 0.3,
  },
}

/** An example: darting glances, suspicious, almost never dozes, notices everything. */
export const RESTLESS: BotPreset = {
  name: 'Restless',
  about: 'Glances and squints a lot, quick eyes and blinks, rarely dozes, catches every cursor.',
  look: { paper: 'page', eyes: { width: 4.6, height: 12.8, spacing: 7.8 } },
  personality: {
    weights: { glance: 0.3, squint: 0.18, scan: 0.18, eyeroll: 0.12, bored: 0.1, daydream: 0.1, doze: 0.02 },
    durations: { glance: 1100, scan: 3200 },
    blinkEvery: [1400, 3600],
    saccade: [110, 300],
    curiosity: 0.8,
  },
}

export const BOT_PRESETS: readonly BotPreset[] = [RECTO, CALM, RESTLESS]
