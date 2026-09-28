/**
 * Tell a click from a drag, for things that act on press.
 *
 * Call it from a primary-button press. Released without moving, it is a click;
 * moved further than a few pixels first, it is a drag, handed over with where
 * the pointer is. Only one of the two ever fires.
 */

/** How far the pointer travels before a press becomes a drag, in pixels. */
export const DRAG_THRESHOLD = 5

export function pressOrDrag(
  start: { clientX: number; clientY: number; button: number },
  handlers: { onClick?: () => void; onDrag: (x: number, y: number) => void },
): void {
  if (start.button !== 0) return
  const move = (event: PointerEvent): void => {
    if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < DRAG_THRESHOLD) return
    stop()
    handlers.onDrag(event.clientX, event.clientY)
  }
  const up = (): void => {
    stop()
    handlers.onClick?.()
  }
  const stop = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
