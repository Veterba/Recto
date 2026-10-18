import { DEFAULT_TUNABLES, type Tunables } from './protocol'
import { coerceLook, DEFAULT_LOOK, type GraphLook } from './look'
import { coerceLayout, DEFAULT_LAYOUT, type GraphLayout } from './layout'
import { ALL_LINKS, coerceLinkRange, type LinkRange } from './degree-bins'

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

type GraphSettings = {
  /** The forces, as the Forces sliders left them. */
  tunables: Tunables
  showLabels: boolean
  showOrphans: boolean
  /** Board notes, drawn as rounded squares. On by default: a board is a note you made. */
  showBoards: boolean
  /**
   * Cards - the notes a board lists - as small dots in the colour of where
   * they stand, tied to their board by a dashed line. Off by default: a busy
   * board would bury the notes around it.
   */
  showTasks: boolean
  /**
   * Conversations with Claude are notes too, and each one links to whatever it
   * quoted - so a vault with a lot of chatting grows a cluster of them that is
   * not really part of your notes. On by default, because they ARE notes and
   * hiding them without asking is how things go missing.
   */
  showChats: boolean
  /** Colours, node and link styling, labels, backdrop. */
  look: GraphLook
  /** The shape the graph grows into. */
  layout: GraphLayout
  /** Only notes with this many links are shown. */
  linkRange: LinkRange
  /**
   * Show only the open note and what it links to, either way - Obsidian's
   * local graph, as a switch on the one graph rather than a second view.
   */
  localOnly: boolean
}

export const DEFAULT_SETTINGS: GraphSettings = {
  tunables: DEFAULT_TUNABLES,
  showLabels: true,
  showOrphans: true,
  showBoards: true,
  showTasks: false,
  showChats: true,
  look: DEFAULT_LOOK,
  layout: DEFAULT_LAYOUT,
  linkRange: ALL_LINKS,
  localOnly: false,
}

/** Sane outer edges for each force, matching the slider ranges in the UI. */
const LIMITS: Readonly<Record<keyof Tunables, [number, number]>> = {
  repelStrength: [0, 4000],
  linkDistance: [1, 1000],
  linkStrength: [0, 2],
  centerStrength: [0, 1],
  orphanPull: [0, 1],
}

const clamp = (value: number, [min, max]: [number, number]): number => Math.min(max, Math.max(min, value))

export function parseSettings(raw: unknown): GraphSettings {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_SETTINGS
  const record = raw as Record<string, unknown>

  const one = (raw: unknown, base: Tunables): Tunables => {
    const out = { ...base }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out
    const values = raw as Record<string, unknown>
    for (const key of Object.keys(DEFAULT_TUNABLES) as (keyof Tunables)[]) {
      const value = values[key]
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = clamp(value, LIMITS[key])
    }
    return out
  }

  const layout = coerceLayout(record['layout'])
  const saved = record['tunables']
  /*
   * One build kept a set of forces per layout, in a map keyed by layout name.
   * A file it wrote reads as `{ organic: {...}, tree: {...} }`, so take the
   * organic set out of it rather than throwing away a dialling someone did.
   */
  const perLayout =
    saved !== null && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Record<string, unknown>)['organic'] : undefined
  const flat = (Object.keys(DEFAULT_TUNABLES) as (keyof Tunables)[]).some(
    (key) => saved !== null && typeof saved === 'object' && key in (saved as Record<string, unknown>),
  )
  const tunables = one(flat ? saved : (perLayout ?? saved), DEFAULT_TUNABLES)

  return {
    tunables,
    showLabels: typeof record['showLabels'] === 'boolean' ? record['showLabels'] : true,
    showOrphans: typeof record['showOrphans'] === 'boolean' ? record['showOrphans'] : true,
    showBoards: typeof record['showBoards'] === 'boolean' ? record['showBoards'] : true,
    showTasks: typeof record['showTasks'] === 'boolean' ? record['showTasks'] : false,
    showChats: typeof record['showChats'] === 'boolean' ? record['showChats'] : true,
    look: coerceLook(record['look']),
    layout,
    linkRange: coerceLinkRange(record['linkRange']),
    localOnly: typeof record['localOnly'] === 'boolean' ? record['localOnly'] : false,
  }
}
