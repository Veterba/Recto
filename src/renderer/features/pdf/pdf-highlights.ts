import { useEffect, useSyncExternalStore } from 'react'
import { IPC } from '@shared/ipc'
import { api } from '../../app/api'

/**
 * Highlights in PDFs: Recto's own, kept in `.recto/` by the PDF's path (moved
 * with it when it is renamed), so the PDF itself is never changed. A highlight
 * is the text it covers and where it lies on its page, as fractions of the
 * page, so it sits right at any size.
 */

export type Rect = { x: number; y: number; w: number; h: number }
export type Highlight = { id: string; page: number; rects: Rect[]; text: string }
type All = Record<string, Highlight[]>

const FEATURE = 'pdf-highlights'
const NONE: readonly Highlight[] = []

let all: All | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function load(): Promise<void> {
  loading ??= api.invoke(IPC.stateRead, FEATURE).then((raw) => {
    all = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as All) : {}
    for (const l of listeners) l()
  })
  return loading
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

function set(path: string, list: Highlight[]): void {
  if (all === null) return
  const next = { ...all }
  if (list.length === 0) delete next[path]
  else next[path] = list
  all = next
  for (const l of listeners) l()
  void api.invoke(IPC.stateWrite, FEATURE, all)
}

/** One PDF's highlights, and adding and taking them away. */
export function useHighlights(path: string): {
  highlights: readonly Highlight[]
  add: (h: Omit<Highlight, 'id'>) => void
  remove: (id: string) => void
} {
  useEffect(() => void load(), [])
  const highlights = useSyncExternalStore(subscribe, () => all?.[path] ?? NONE)
  return {
    highlights,
    add: (h) => set(path, [...(all?.[path] ?? []), { ...h, id: Math.random().toString(36).slice(2, 10) }]),
    remove: (id) => set(path, (all?.[path] ?? []).filter((x) => x.id !== id)),
  }
}

/** The parts of a selection that lie on a page, as fractions of the page. */
export function rectsOn(page: DOMRect, client: readonly DOMRect[]): Rect[] {
  return client
    .filter((r) => r.width > 0 && r.height > 0 && r.right > page.left && r.left < page.right && r.bottom > page.top && r.top < page.bottom)
    .map((r) => ({
      x: (r.left - page.left) / page.width,
      y: (r.top - page.top) / page.height,
      w: r.width / page.width,
      h: r.height / page.height,
    }))
}
