import { api } from './api'
import { IPC } from '@shared/ipc'

/**
 * The note preview card, wherever it is asked for - a link in a note or a
 * floating note window, a row in the file tree - with one lifecycle.
 *
 * One at a time, app-wide: there is one pointer. It opens after the delay set
 * in Settings (quickly, once a card is already up), and it belongs to the
 * element it was asked for, its anchor. Anything that means you have moved on
 * puts it away at once, and cancels one that has not opened yet:
 * - a press anywhere but on the card (any button: the anchor clicked, a tab, a link);
 * - a key, the window losing focus, a scroll anywhere but in the card;
 * - navigation the shell makes without any of those (`closeLinkPeek`);
 * - the anchor gone from the page, hidden, or moved - checked every frame;
 * - the pointer off the anchor and not on the card within a moment.
 * A card never follows its anchor somewhere new: if the anchor moves, it closes.
 */

export type LinkPeek = { path: string; anchor: { top: number; right: number; bottom: number } }

const WARM_MS = 250
/** Grace for the trip from the anchor to the card. */
const CLOSE_MS = 150
/** The card's root, so a press on it is not taken for "moved on". */
export const PEEK_CARD_CLASS = 'note-peek'

let peek: LinkPeek | null = null
let delayMs = 2000
let openTimer: number | undefined
let closeTimer: number | undefined
/** Bumped on every request, so a link resolved late cannot open a card for one already left. */
let token = 0
let anchor: HTMLElement | null = null
/** Where the anchor was when its card opened: a card does not follow it. */
let anchorBox: DOMRect | null = null
let frame = 0
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

/** Still on the page, shown, and - once a card is up - where it was. */
function anchorHolds(element: HTMLElement): boolean {
  if (!element.isConnected) return false
  const box = element.getBoundingClientRect()
  if (box.width === 0 && box.height === 0) return false
  if (anchorBox === null) return true
  return Math.abs(box.top - anchorBox.top) < 1 && Math.abs(box.left - anchorBox.left) < 1
}

/** Every frame while a card is up or on its way: its anchor must still be there. */
function watch(): void {
  cancelAnimationFrame(frame)
  const tick = (): void => {
    if (anchor === null) return
    if (!anchorHolds(anchor)) {
      closeLinkPeek()
      return
    }
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
}

/**
 * The pointer came to rest on an anchor - a link (`target`, resolved like a
 * link) or a note row (`path`) - or left it (null).
 */
export function hoverLink(request: { target?: string; path?: string; element: HTMLElement } | null): void {
  window.clearTimeout(openTimer)
  window.clearTimeout(closeTimer)
  const mine = ++token
  if (request === null) {
    // Off the anchor: the card goes unless the pointer reaches it first.
    closeTimer = window.setTimeout(closeLinkPeek, CLOSE_MS)
    return
  }
  const element = request.element
  const warm = peek !== null
  anchor = element
  anchorBox = null
  watch()
  openTimer = window.setTimeout(
    () => {
      const resolve = request.path !== undefined ? Promise.resolve(request.path) : api.invoke(IPC.indexResolveLink, request.target ?? '')
      void resolve.then((path) => {
        // A link to nothing has nothing to preview; a request since, or an anchor gone, wins.
        if (mine !== token || path === null || anchor !== element || !anchorHolds(element)) return
        const box = element.getBoundingClientRect()
        anchorBox = box
        set({ path, anchor: { top: box.top, right: box.right, bottom: box.bottom } })
      })
    },
    warm ? WARM_MS : delayMs,
  )
}

/** The pointer is on the card: keep it. */
export function holdLinkPeek(): void {
  window.clearTimeout(closeTimer)
}

/** The pointer left the card: the same grace as leaving the anchor. */
export function releaseLinkPeek(): void {
  window.clearTimeout(closeTimer)
  closeTimer = window.setTimeout(closeLinkPeek, CLOSE_MS)
}

/** Put the card away, and any that was on its way. */
export function closeLinkPeek(): void {
  window.clearTimeout(openTimer)
  window.clearTimeout(closeTimer)
  cancelAnimationFrame(frame)
  token++
  anchor = null
  anchorBox = null
  if (peek !== null) set(null)
}

const onCard = (event: Event): boolean => event.target instanceof Element && event.target.closest(`.${PEEK_CARD_CLASS}`) !== null
const busy = (): boolean => anchor !== null || peek !== null

/**
 * The events that mean "moved on", for the whole window, once. Capture phase,
 * so nothing that stops a press or a key on its way (CodeMirror opening a
 * link on mousedown, say) can keep them from the card.
 */
export function installLinkPeekWatch(): () => void {
  const press = (event: Event): void => {
    if (busy() && !onCard(event)) closeLinkPeek()
  }
  const away = (): void => {
    if (busy()) closeLinkPeek()
  }
  const scroll = (event: Event): void => {
    if (busy() && !onCard(event)) closeLinkPeek()
  }
  window.addEventListener('pointerdown', press, true)
  window.addEventListener('auxclick', press, true)
  window.addEventListener('keydown', away, true)
  window.addEventListener('blur', away)
  window.addEventListener('scroll', scroll, true)
  window.addEventListener('wheel', scroll, { capture: true, passive: true })
  return () => {
    window.removeEventListener('pointerdown', press, true)
    window.removeEventListener('auxclick', press, true)
    window.removeEventListener('keydown', away, true)
    window.removeEventListener('blur', away)
    window.removeEventListener('scroll', scroll, true)
    window.removeEventListener('wheel', scroll, true)
  }
}
