/**
 * Floating note windows: which are open, where, how big, and in what order.
 *
 * Pure data and pure functions - the list is kept in `use-workspace` and
 * saved in workspace.json with the rest of the layout. The order of the list
 * is the stacking order: the last window is on top. Coordinates are CSS px
 * inside the workspace area (`.shell__content`), which is also the bound
 * every window is kept fully inside.
 */

export type NoteWindowState = {
  id: string
  /** The note, vault-relative. */
  path: string
  x: number
  y: number
  width: number
  height: number
}

export type Bounds = { width: number; height: number }

/** Which sides a resize drags: an edge moves one, a corner two. */
export type Edges = { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean }

export const NOTE_WINDOW_MIN = { width: 260, height: 180 } as const
export const NOTE_WINDOW_DEFAULT = { width: 420, height: 480 } as const

let counter = 0
const nextId = (): string => `note-window-${(++counter).toString(36)}${Date.now().toString(36).slice(-4)}`

/**
 * The window moved and sized to lie wholly inside the bounds. Never smaller
 * than the minimum, never larger than the bounds (unless the bounds are
 * smaller than the minimum, when it sits at the top left).
 */
export function clampInside(w: NoteWindowState, bounds: Bounds): NoteWindowState {
  const width = Math.max(Math.min(NOTE_WINDOW_MIN.width, bounds.width), Math.min(w.width, bounds.width))
  const height = Math.max(Math.min(NOTE_WINDOW_MIN.height, bounds.height), Math.min(w.height, bounds.height))
  return {
    ...w,
    width,
    height,
    x: Math.max(0, Math.min(w.x, bounds.width - width)),
    y: Math.max(0, Math.min(w.y, bounds.height - height)),
  }
}

/**
 * Resize by dragging the given edges `dx`, `dy` from where they started. The
 * opposite edges stay put - a left edge dragged past the minimum stops there
 * rather than pushing the whole window - and the result stays inside.
 */
export function resizeFrom(start: NoteWindowState, edges: Edges, dx: number, dy: number, bounds: Bounds): NoteWindowState {
  let { x, y, width, height } = start
  const right = start.x + start.width
  const bottom = start.y + start.height
  if (edges.right === true) width = Math.min(bounds.width - x, Math.max(NOTE_WINDOW_MIN.width, start.width + dx))
  if (edges.bottom === true) height = Math.min(bounds.height - y, Math.max(NOTE_WINDOW_MIN.height, start.height + dy))
  if (edges.left === true) {
    x = Math.max(0, Math.min(right - NOTE_WINDOW_MIN.width, start.x + dx))
    width = right - x
  }
  if (edges.top === true) {
    y = Math.max(0, Math.min(bottom - NOTE_WINDOW_MIN.height, start.y + dy))
    height = bottom - y
  }
  return clampInside({ ...start, x, y, width, height }, bounds)
}

/** Move a window to the top of the stack. */
export function bringToFront(list: readonly NoteWindowState[], id: string): NoteWindowState[] {
  const w = list.find((item) => item.id === id)
  if (w === undefined || list[list.length - 1]?.id === id) return [...list]
  return [...list.filter((item) => item.id !== id), w]
}

/**
 * Open a note in a window at `at`, on top. A note already open in a window
 * is not opened twice: that window comes to the front instead.
 */
export function openNoteWindow(
  list: readonly NoteWindowState[],
  path: string,
  at: { x: number; y: number },
  bounds: Bounds,
): NoteWindowState[] {
  const existing = list.find((item) => item.path === path)
  if (existing !== undefined) return bringToFront(list, existing.id)
  const w = clampInside({ id: nextId(), path, x: at.x, y: at.y, ...NOTE_WINDOW_DEFAULT }, bounds)
  return [...list, w]
}

export function closeNoteWindow(list: readonly NoteWindowState[], id: string): NoteWindowState[] {
  return list.filter((item) => item.id !== id)
}

/** Replace a window's geometry, kept inside the bounds. */
export function placeNoteWindow(
  list: readonly NoteWindowState[],
  id: string,
  geometry: Pick<NoteWindowState, 'x' | 'y' | 'width' | 'height'>,
  bounds: Bounds,
): NoteWindowState[] {
  return list.map((item) => (item.id === id ? clampInside({ ...item, ...geometry }, bounds) : item))
}

/** The window on top, or null when none is open. */
export const topmost = (list: readonly NoteWindowState[]): NoteWindowState | null => list[list.length - 1] ?? null

/**
 * The windows saved in workspace.json, checked: anything malformed is dropped
 * rather than trusted, and ids are made fresh so two sessions never share one.
 */
export function parseNoteWindows(saved: unknown): NoteWindowState[] {
  if (!Array.isArray(saved)) return []
  const out: NoteWindowState[] = []
  for (const item of saved) {
    if (typeof item !== 'object' || item === null) continue
    const w = item as Partial<NoteWindowState>
    const numbers = [w.x, w.y, w.width, w.height]
    if (typeof w.path !== 'string' || w.path === '' || numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n))) continue
    out.push({ id: nextId(), path: w.path, x: w.x!, y: w.y!, width: w.width!, height: w.height! })
  }
  return out
}

/** What is saved: everything but the ids. */
export const serializeNoteWindows = (list: readonly NoteWindowState[]): Omit<NoteWindowState, 'id'>[] =>
  list.map(({ path, x, y, width, height }) => ({ path, x, y, width, height }))
