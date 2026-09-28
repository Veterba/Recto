import { api } from './api'
import { IPC } from '@shared/ipc'

/**
 * The preview of a link under the pointer - in a note, or in a floating note
 * window - shown with the same card the file tree uses, after the same delay.
 *
 * One at a time, app-wide: whichever editor reported the hover, there is one
 * pointer. The timings follow the tree's: once a card is up the next one opens
 * quickly, and there is a short grace for the trip from the link to the card.
 */

export type LinkPeek = { path: string; anchor: { top: number; right: number; bottom: number } }

const WARM_MS = 250
const CLOSE_MS = 180

let peek: LinkPeek | null = null
let delayMs = 2000
let timer: number | undefined
/** Bumped on every hover, so a link resolved late cannot open a card for a link already left. */
let token = 0
const listeners = new Set<() => void>()

const set = (next: LinkPeek | null): void => {
  peek = next
  for (const listener of listeners) listener()
}

export const subscribeLinkPeek = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const linkPeekSnapshot = (): LinkPeek | null => peek

/** The appearance setting, in milliseconds. */
export function setLinkPeekDelay(ms: number): void {
  delayMs = ms
}

/** The pointer came to rest on a link (or left one: null). */
export function hoverLink(link: { target: string; anchor: DOMRect } | null): void {
  window.clearTimeout(timer)
  const mine = ++token
  if (link === null) {
    if (peek !== null) timer = window.setTimeout(() => set(null), CLOSE_MS)
    return
  }
  const { top, right, bottom } = link.anchor
  timer = window.setTimeout(
    () => {
      void api.invoke(IPC.indexResolveLink, link.target).then((path) => {
        // A link to nothing has nothing to preview.
        if (mine === token && path !== null) set({ path, anchor: { top, right, bottom } })
      })
    },
    peek !== null ? WARM_MS : delayMs,
  )
}

/** The pointer is on the card: keep it. */
export function holdLinkPeek(): void {
  window.clearTimeout(timer)
  token++
}

/** The pointer left the card: the same grace as leaving the link. */
export function releaseLinkPeek(): void {
  hoverLink(null)
}

export function closeLinkPeek(): void {
  window.clearTimeout(timer)
  token++
  set(null)
}
