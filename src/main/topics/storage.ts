/**
 * Where topics keep their settings and their state: two JSON files in .recto/.
 */

import { type TopicsSettings, DEFAULT_TOPICS_SETTINGS } from '../../shared/topics'
import { readState, writeState } from '../state'
import { type TopicsState, coerceState } from './state'

const SETTINGS = 'topics-settings'

const STATE = 'topics'

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
}

export function readSettings(): TopicsSettings {
  const raw = (readState(SETTINGS) ?? {}) as Partial<TopicsSettings>
  const d = DEFAULT_TOPICS_SETTINGS
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : d.enabled,
    quietMinutes: clampInt(raw.quietMinutes, 15, 240, d.quietMinutes),
    minWords: clampInt(raw.minWords, 30, 10_000, d.minWords),
    excluded: Array.isArray(raw.excluded) ? raw.excluded.filter((f): f is string => typeof f === 'string') : [],
    initializedAt: num(raw.initializedAt),
    reviewedAt: num(raw.reviewedAt),
  }
}

export const saveSettings = (next: TopicsSettings): void => void writeState(SETTINGS, next)

export const readTopics = (): TopicsState => coerceState(readState(STATE))

export const saveTopics = (s: TopicsState): void => void writeState(STATE, s)
