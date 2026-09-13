import { DEFAULT_TUNABLES, type Tunables } from './protocol'

/**
 * What the graph remembers between launches, in `.recto/graph.json`.
 *
 * Force tunables are a matter of taste at a given vault size, so having to
 * re-dial them on every launch would make them decorative.
 *
 * The file is meant to be human-editable - that is the whole point of one JSON
 * file per feature - which means every field may be missing, the wrong type, or
 * nonsense. So this reads defensively and silently falls back rather than
 * throwing: a hand-edited settings file must never be able to stop the app
 * from opening. It also clamps, because a `repelStrength` of 1e9 is a graph you
 * cannot see and cannot fix from inside the app.
 */

export type GraphSettings = {
  tunables: Tunables
  showLabels: boolean
  showOrphans: boolean
  /**
   * Task cards are notes, so the graph would show them - but the Data tree
   * hides the folder they live in, and a note you can see in one place and not
   * the other reads as a ghost. Off by default, with a switch, so the graph
   * agrees with the file list AND nothing is hidden from you by force.
   */
  showTasks: boolean
}

export const DEFAULT_SETTINGS: GraphSettings = {
  tunables: DEFAULT_TUNABLES,
  showLabels: true,
  showOrphans: true,
  showTasks: false,
}

/** Sane outer edges for each force, matching the slider ranges in the UI. */
const LIMITS: Readonly<Record<keyof Tunables, [number, number]>> = {
  repelStrength: [0, 4000],
  linkDistance: [1, 1000],
  linkStrength: [0, 2],
  centerStrength: [0, 1],
}

const clamp = (value: number, [min, max]: [number, number]): number =>
  Math.min(max, Math.max(min, value))

export function parseSettings(raw: unknown): GraphSettings {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_SETTINGS
  const record = raw as Record<string, unknown>

  const tunables = { ...DEFAULT_TUNABLES }
  const saved = record['tunables']
  if (saved !== null && typeof saved === 'object' && !Array.isArray(saved)) {
    const values = saved as Record<string, unknown>
    for (const key of Object.keys(DEFAULT_TUNABLES) as (keyof Tunables)[]) {
      const value = values[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        tunables[key] = clamp(value, LIMITS[key])
      }
    }
  }

  return {
    tunables,
    showLabels: typeof record['showLabels'] === 'boolean' ? record['showLabels'] : true,
    showOrphans: typeof record['showOrphans'] === 'boolean' ? record['showOrphans'] : true,
    showTasks: typeof record['showTasks'] === 'boolean' ? record['showTasks'] : false,
  }
}
