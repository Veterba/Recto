/**
 * The home overlay's chord, and when it belongs to the field you are typing in instead.
 */

/** The one place the binding lives. */
export const HOME_HOTKEY = 'Mod+Shift+H'

/**
 * Is the keyboard busy typing into something?
 *
 * The overlay's chord must not be stolen from a search box, a rename field or
 * the chat composer. The note editor is the deliberate exception: it is
 * contenteditable, and it is also where you are standing when you reach for
 * this - a rule that excluded it would make the surface unreachable from the
 * only screen anyone is ever on.
 */
export function typingInField(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (el === null) return false
  if (el.closest('.cm-editor') !== null) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}
