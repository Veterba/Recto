import { zoneAt, type DropZone, type Rect } from './pane-drop'

/**
 * A drag that ends in a pane: the session, the hit-testing, and the drop.
 *
 * Two kinds of drag feed it. Tabs, links in a note, palette results and
 * floating note windows are pointer drags this module follows itself. A note dragged out of the file
 * tree is a native HTML drag, because the tree already moves files that way;
 * its dragover and drop events are followed instead. Either way the pane under
 * the pointer is found by its `data-tabs-id`, the zone by `zoneAt`, and the
 * overlay (`PaneDropOverlay`) draws whatever the session says.
 */

export type PaneDragPayload =
  | { kind: 'leaf'; leafId: string }
  | { kind: 'path'; path: string; heading?: string | null }
  | { kind: 'link'; target: string; heading: string | null; source: string }
  /** A floating note window, dragged into the layout with ⌥. */
  | { kind: 'window'; windowId: string; path: string }

export type PaneDragSession = {
  payload: PaneDragPayload
  label: string
  /** Native drags draw their own drag image; pointer drags get a label. */
  native: boolean
  x: number
  y: number
  /** `slot` is set over a tab strip: where in the row a dragged tab would go, and the x of that gap. */
  over: { tabsId: string; rect: Rect; zone: DropZone; slot?: TabSlot } | null
}

export type TabSlot = { index: number; x: number }

let session: PaneDragSession | null = null
const listeners = new Set<() => void>()
let onDrop: ((payload: PaneDragPayload, tabsId: string, zone: DropZone, slot?: TabSlot) => void) | null = null

export const subscribePaneDrag = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const paneDragSnapshot = (): PaneDragSession | null => session

/** What a drop does - set by the shell, which knows the workspace. */
export function setPaneDropHandler(handler: typeof onDrop): void {
  onDrop = handler
}

const emit = (next: PaneDragSession | null): void => {
  session = next
  for (const listener of listeners) listener()
}

/**
 * The pane and zone under a point. A pane that takes drops of its own - a
 * board column - is left to do so.
 */
function hitTest(x: number, y: number, payload: PaneDragPayload): PaneDragSession['over'] {
  const element = document.elementFromPoint(x, y)
  if (element === null || element.closest('[data-accepts-drop]') !== null) return null
  const strip = element.closest<HTMLElement>('.tabs__strip')
  if (strip !== null && payload.kind === 'leaf') {
    const tabsId = strip.closest<HTMLElement>('[data-tabs-id]')?.dataset['tabsId']
    if (tabsId !== undefined) {
      const box = strip.getBoundingClientRect()
      return { tabsId, rect: { left: box.left, top: box.top, width: box.width, height: box.height }, zone: 'center', slot: slotAt(strip, x, payload.leafId) }
    }
  }
  const pane = element.closest<HTMLElement>('[data-tabs-id]')
  const tabsId = pane?.dataset['tabsId']
  if (pane == null || tabsId === undefined) return null
  const box = pane.getBoundingClientRect()
  const rect = { left: box.left, top: box.top, width: box.width, height: box.height }
  const zone = zoneAt(rect, x, y)
  return zone === null ? null : { tabsId, rect, zone }
}

/**
 * The gap in a tab strip nearest the pointer: before the first tab whose
 * middle is right of it. The dragged tab itself is left out, so the index is
 * the one `Workspace.moveLeaf` takes once the tab is lifted out of the row.
 */
function slotAt(strip: HTMLElement, x: number, dragged: string): TabSlot {
  const tabs = [...strip.querySelectorAll<HTMLElement>('[data-leaf-id]')].filter((tab) => tab.dataset['leafId'] !== dragged)
  for (const [index, tab] of tabs.entries()) {
    const box = tab.getBoundingClientRect()
    if (x < box.left + box.width / 2) return { index, x: box.left }
  }
  const last = tabs.at(-1)?.getBoundingClientRect()
  return { index: tabs.length, x: last?.right ?? strip.getBoundingClientRect().left }
}

function moveTo(x: number, y: number): void {
  if (session === null) return
  emit({ ...session, x, y, over: hitTest(x, y, session.payload) })
}

function finish(commit: boolean): void {
  const ended = session
  if (ended === null) return
  stopListening()
  document.body.classList.remove('is-pane-dragging')
  emit(null)
  if (commit && ended.over !== null) onDrop?.(ended.payload, ended.over.tabsId, ended.over.zone, ended.over.slot)
}

// --- pointer drags ---------------------------------------------------------

const onPointerMove = (event: PointerEvent): void => moveTo(event.clientX, event.clientY)
const onPointerUp = (event: PointerEvent): void => {
  moveTo(event.clientX, event.clientY)
  finish(true)
}
/** Esc cancels, and goes no further: it is not also leaving focus mode. */
const onKeyDown = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  finish(false)
}
const onBlur = (): void => finish(false)

// --- native drags (the file tree) ------------------------------------------

/**
 * Captured, so the pane gets the drop before anything inside it does: the
 * editor would otherwise paste the dragged path into the note.
 */
const onDragOver = (event: DragEvent): void => {
  moveTo(event.clientX, event.clientY)
  if (session?.over == null) return
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}
const onNativeDrop = (event: DragEvent): void => {
  moveTo(event.clientX, event.clientY)
  if (session?.over == null) {
    // Not on a pane - a folder in the tree, say. Its own drop still runs.
    finish(false)
    return
  }
  event.preventDefault()
  event.stopPropagation()
  finish(true)
}
const onDragEnd = (): void => finish(false)
/** Leaving the window: nothing to show until it comes back. */
const onDragLeave = (event: DragEvent): void => {
  if (event.relatedTarget === null && session !== null) emit({ ...session, over: null })
}

function stopListening(): void {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('blur', onBlur)
  window.removeEventListener('dragover', onDragOver, true)
  window.removeEventListener('drop', onNativeDrop, true)
  window.removeEventListener('dragend', onDragEnd, true)
  window.removeEventListener('dragleave', onDragLeave, true)
}

/** Start following a pointer drag, from where the pointer already is. */
export function beginPaneDrag(payload: PaneDragPayload, label: string, x: number, y: number): void {
  finish(false)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('blur', onBlur)
  document.body.classList.add('is-pane-dragging')
  emit({ payload, label, native: false, x, y, over: null })
  moveTo(x, y)
}

/** Start following a native drag, from its dragstart. Esc is the browser's. */
export function beginNativePaneDrag(payload: PaneDragPayload, label: string): void {
  finish(false)
  window.addEventListener('dragover', onDragOver, true)
  window.addEventListener('drop', onNativeDrop, true)
  window.addEventListener('dragend', onDragEnd, true)
  window.addEventListener('dragleave', onDragLeave, true)
  emit({ payload, label, native: true, x: 0, y: 0, over: null })
}
