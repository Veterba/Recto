import { IPC } from '@shared/ipc'
import type { LinkPreview } from '@shared/canvas'
import { api } from '../../app/api'

/**
 * Link previews as the canvas shows them: asked of main once per card (main
 * keeps them), and read from the page again on "Refresh preview" - every card
 * with that link then shows the new one.
 */

const watchers = new Map<string, Set<(preview: LinkPreview | null) => void>>()

/** The link's preview, now and whenever it is refreshed; the returned function stops it. */
export function watchPreview(url: string, show: (preview: LinkPreview | null) => void): () => void {
  let live = true
  const set = watchers.get(url) ?? new Set()
  watchers.set(url, set)
  set.add(show)
  void api.invoke(IPC.canvasLinkPreview, url, false).then((found) => {
    if (live) show(found)
  })
  return () => {
    live = false
    set.delete(show)
    if (set.size === 0) watchers.delete(url)
  }
}

/** The page read again; false when that found nothing (the card keeps what it had). */
export async function refreshPreview(url: string): Promise<boolean> {
  const found = await api.invoke(IPC.canvasLinkPreview, url, true)
  if (found === null) return false
  for (const show of watchers.get(url) ?? []) show(found)
  return true
}
