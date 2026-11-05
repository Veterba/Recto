import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { IPC } from '@shared/ipc'
import { api } from '../../app/api'

/**
 * What Recto keeps about a canvas that Obsidian has no place for: which
 * groups and note nodes are folded, and which boards are shown as their
 * Markdown rather than as a board. In `.recto/canvas.json`, by the canvas's
 * path (moved with it when it is renamed), so the .canvas file itself stays
 * exactly JSON Canvas.
 */

export type CanvasLocal = { collapsed?: string[]; raw?: string[] }
type Key = keyof CanvasLocal
type All = Record<string, CanvasLocal>

const FEATURE = 'canvas'
const SAVE_MS = 300

let all: All | null = null
let loading: Promise<void> | null = null
let timer: number | null = null
const listeners = new Set<() => void>()

function load(): Promise<void> {
  loading ??= api.invoke(IPC.stateRead, FEATURE).then((raw) => {
    all = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as All) : {}
    for (const l of listeners) l()
  })
  return loading
}

function save(): void {
  if (timer !== null) window.clearTimeout(timer)
  timer = window.setTimeout(() => void api.invoke(IPC.stateWrite, FEATURE, all ?? {}), SAVE_MS)
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** One list of node ids kept for a canvas, and a switch for each id. */
function useIds(path: string, key: Key): { ids: ReadonlySet<string>; toggle: (id: string) => void } {
  useEffect(() => void load(), [])
  const snapshot = useSyncExternalStore(subscribe, () => all?.[path]?.[key]?.join('\u0000') ?? '')
  const ids = useMemo(() => new Set(snapshot === '' ? [] : snapshot.split('\u0000')), [snapshot])
  const toggle = useCallback(
    (id: string) => {
      if (all === null) return
      const now = new Set(all[path]?.[key] ?? [])
      if (now.has(id)) now.delete(id)
      else now.add(id)
      const entry: CanvasLocal = { ...all[path] }
      if (now.size === 0) delete entry[key]
      else entry[key] = [...now]
      if (Object.keys(entry).length === 0) {
        const { [path]: _gone, ...rest } = all
        all = rest
      } else all = { ...all, [path]: entry }
      for (const l of listeners) l()
      save()
    },
    [path, key],
  )
  return { ids, toggle }
}

/** The folded nodes of one canvas, and a switch for each. */
export function useCollapsed(path: string): { collapsed: ReadonlySet<string>; toggle: (id: string) => void } {
  const { ids, toggle } = useIds(path, 'collapsed')
  return { collapsed: ids, toggle }
}

/** The boards on one canvas shown as their Markdown (a board is shown as a board unless switched). */
export function useRawBoards(path: string): { raw: ReadonlySet<string>; toggle: (id: string) => void } {
  const { ids, toggle } = useIds(path, 'raw')
  return { raw: ids, toggle }
}
