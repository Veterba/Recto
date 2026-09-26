import { codeFolding } from '@codemirror/language'
import { type Extension } from '@codemirror/state'
import { toggleLayer } from './folding'
import { guideLayer } from './list-guides'

/**
 * A note's structure, the way Obsidian shows it.
 *
 * - Every heading and every list item with something under it gets a fold
 *   arrow in the margin, shown on hover and kept visible while folded. Folding
 *   a heading hides its whole section, down to the next heading of the same or
 *   a higher level - the outline of a long note, one click at a time.
 * - Nested lists get indentation guides: a thin line from each bullet down
 *   through its children, so the depth of a list reads without counting spaces.
 *
 * CodeMirror already had folding - `foldGutter()` was in the editor all along -
 * but the gutter is hidden (the text column is centred, and a gutter pinned to
 * the window edge would sit a screen away from the line it folds), so the
 * feature existed and nobody could reach it. The arrows now sit next to the
 * text instead.
 */

/**
 * A folded section shows NOTHING in its place.
 *
 * CodeMirror wants a placeholder and its own is an ellipsis; a count of the
 * hidden lines was no better. Both are a second mark for a state the arrow in
 * the margin already carries - it turns, and it stays visible while the fold is
 * closed, which is the whole signal. An empty node keeps the editor happy and
 * leaves the line ending where the writing ends.
 */
const placeholder = codeFolding({
  placeholderDOM: () => {
    const nothing = document.createElement('span')
    nothing.className = 'cm-fold-more'
    nothing.setAttribute('aria-hidden', 'true')
    return nothing
  },
})

export const noteStructure = (): Extension => [placeholder, toggleLayer, guideLayer]
