import type { VaultUsage } from '@shared/ipc-contract'
import { api } from '../api'

/**
 * What the home overlay's second pane shows.
 *
 * Split deliberately into what the vault can answer and what it cannot. The
 * index knows the shape of the vault - how many notes, how they link, when they
 * were last written to - because it reads the files. It knows nothing about
 * sessions: there is an `events` table in the schema for exactly that, and
 * nothing writes to it yet, so a streak or a time-in-app figure here would be
 * invention rather than measurement.
 *
 * Those fields are `null` and marked, rather than filled with a plausible
 * number. When the app starts recording usage events, this is the one place
 * that changes.
 */
export type HomeStats = {
  /** Notes in the vault. */
  notes: number
  /** Links between them, resolved and not. */
  links: number
  /** Links pointing at a note that is not there. */
  unresolved: number
  /** Distinct tags. */
  tags: number
  /**
   * Notes written to in the last seven days.
   *
   * Touched, not created: `mtime` is the only date the filesystem keeps that
   * survives a clone, a sync or a restore from the archive.
   */
  touchedThisWeek: number
  /** Notes touched per day, oldest first, seven entries - the sparkline. */
  weekTrend: number[]
  topFolders: { name: string; count: number }[]
  topTags: { tag: string; count: number }[]
  /** The most linked notes, both directions. */
  hubs: { name: string; links: number }[]
  /** TODO: real data - consecutive days with a writing session. Needs `events`. */
  streakDays: number | null
  /** TODO: real data - minutes with the window focused today. Needs `events`. */
  minutesToday: number | null
  /** TODO: real data - the weekday most writing happens on. Needs `events`. */
  busiestDay: string | null
}

const EMPTY: HomeStats = {
  notes: 0,
  links: 0,
  unresolved: 0,
  tags: 0,
  touchedThisWeek: 0,
  weekTrend: [0, 0, 0, 0, 0, 0, 0],
  topFolders: [],
  topTags: [],
  hubs: [],
  streakDays: null,
  minutesToday: null,
  busiestDay: null,
}

/**
 * Read the figures. One call, one place to change.
 *
 * A vault that has not finished indexing answers zeroes rather than throwing:
 * the overlay opens on a keystroke and must never be the thing that fails.
 */
export async function getHomeStats(): Promise<HomeStats> {
  try {
    const usage: VaultUsage = await api.invoke('index:home-stats')
    return {
      ...usage,
      // TODO: real data. These three need the `events` table populated.
      streakDays: null,
      minutesToday: null,
      busiestDay: null,
    }
  } catch {
    return EMPTY
  }
}
