/**
 * Keys that confirm a Chinese or Japanese input method's candidate are not
 * the app's. While a word is being composed, Enter picks the candidate, Esc
 * drops it, the arrows and Tab move among them - but the same keydown also
 * reached Recto's own handlers: Enter in a note's title renamed the note to
 * the half-typed name, Enter in the switcher opened the first hit, Esc closed
 * Quick ask. One listener, ahead of every other (window, capture), keeps
 * those keys from them while composing; the input method has them regardless,
 * as composing is the browser's own work. CodeMirror reads composition
 * properly itself, so keys typed into an editor's own text go on as they are -
 * but not those in the widgets drawn inside it (a table's cells, the
 * properties' fields), which handle Enter and Esc themselves.
 */

const COMPOSING_KEYS = new Set(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

/** A key an input method is using to compose; keyCode 229 is how some engines say "composing". */
export const isCompositionKey = (event: KeyboardEvent): boolean =>
  (event.isComposing || event.keyCode === 229) && COMPOSING_KEYS.has(event.key)

export function installImeGuard(target: Window = window): () => void {
  const guard = (event: KeyboardEvent): void => {
    if (!isCompositionKey(event)) return
    // CodeMirror's text itself: the key's target is its content element; a widget's own field is not.
    if (event.target instanceof Element && event.target.classList.contains('cm-content')) return
    event.stopImmediatePropagation()
  }
  target.addEventListener('keydown', guard, true)
  return () => target.removeEventListener('keydown', guard, true)
}
