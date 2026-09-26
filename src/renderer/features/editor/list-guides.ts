/**
 * The indent guides drawn beside nested lists.
 */

import { type EditorView, RectangleMarker, layer } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
import type { Tree, SyntaxNode } from '@lezer/common'
import { isLivePreviewOn } from './live-preview-state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { plainLevels, LIST_GUTTER, levelStep, bulletWidth, itemColumns } from './list-geometry'
import { trimEnd, foldsChanged } from './folding'

/**
 * Where the scroller's content origin is on screen.
 *
 * Layer markers are positioned inside the scroller, so screen coordinates from
 * `coordsAtPos` have to be moved into that space. This mirrors CodeMirror's own
 * (unexported) helper for the selection layer.
 */
function base(view: EditorView): { left: number; top: number } {
  const rect = view.scrollDOM.getBoundingClientRect()
  return {
    left: rect.left - view.scrollDOM.scrollLeft * view.scaleX,
    top: rect.top - view.scrollDOM.scrollTop * view.scaleY,
  }
}

/**
 * One line per list item that has a nested list: from under its bullet, down
 * to its last child.
 *
 * Measured from the rendered bullet rather than computed from the indentation,
 * so the guide sits under the dot whatever the font - in a proportional font a
 * space is not a column, and lines placed by counting spaces drifted off the
 * bullets they belonged to.
 */
/** Whether the nearest line with anything on it, in this direction, is in a list. */
function neighbourIsList(state: EditorState, tree: Tree, from: number, step: 1 | -1): boolean {
  for (let n = from + step; n >= 1 && n <= state.doc.lines && Math.abs(n - from) <= 40; n += step) {
    const line = state.doc.line(n)
    if (line.text.trim() === '') continue
    for (let node: SyntaxNode | null = tree.resolveInner(line.from, 1); node; node = node.parent) {
      if (node.name === 'ListItem') return true
    }
    return false
  }
  return false
}

/**
 * A blank line that is a list's own padding, rather than somewhere to write.
 *
 * An indent guide belongs to its line and is drawn whether or not the cursor is
 * anywhere near it - the line is the point of pressing Tab, and one that
 * appears only while you stand on it is not a thing you made, it is a hover
 * effect. The single exception is the blank rows a list puts between its items
 * and its blocks: they carry the list's indentation without being anyone's
 * indent, and drawing them put a second vertical beside every block in a
 * maths-heavy note. What identifies them is what surrounds them - list on both
 * sides. A blank line under a paragraph is nobody's padding, however many lists
 * appear further down.
 */
const isListPadding = (state: EditorState, tree: Tree, n: number): boolean =>
  neighbourIsList(state, tree, n, -1) && neighbourIsList(state, tree, n, 1)

function guideMarkers(view: EditorView): readonly RectangleMarker[] {
  const { state } = view
  const markers: RectangleMarker[] = []
  const origin = base(view)
  const seen = new Set<number>()
  const livePreview = isLivePreviewOn(view)
  /**
   * Parse as far as the viewport before measuring.
   *
   * The tree is built in the background, so on the update that follows an edit
   * it still describes the document as it was - and a guide drawn from it was
   * a picture of the previous keystroke: press Tab and the line appeared only
   * after the NEXT edit. Asking for the tree up to what is on screen costs a
   * few milliseconds and makes the guides current.
   */
  const end = view.visibleRanges.length === 0 ? 0 : (view.visibleRanges[view.visibleRanges.length - 1]?.to ?? 0)
  const tree = ensureSyntaxTree(state, end, 50) ?? syntaxTree(state)
  // Where a line's own left edge is, in the coordinates markers are placed in.
  const content = view.contentDOM.getBoundingClientRect()
  const inset = parseFloat(getComputedStyle(view.contentDOM).paddingLeft)
  const lineLeft = content.left - origin.left + (Number.isFinite(inset) ? inset : 0)

  /**
   * Lines that are indented without being list items - a plain paragraph, or an
   * empty line someone pressed Tab on.
   *
   * The guide IS the indent as far as anyone using the editor is concerned, so
   * pressing Tab on an empty line has to draw one; otherwise the only feedback
   * is a caret that moved a few pixels. Lines inside a list item are skipped:
   * their item already draws the line they belong under.
   */
  for (const { from, to } of view.visibleRanges) {
    const first = state.doc.lineAt(from).number
    const last = state.doc.lineAt(to).number
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n)
      const levels = plainLevels(line.text)
      if (levels === 0) continue
      /*
       * Skip what an enclosing list item already draws.
       *
       * A line with text inside an item is covered by that item's guide. So is
       * a BLANK line between its content rows - the padding a maths-heavy note
       * is full of - and drawing those again stacked a second vertical beside
       * every block. A blank line PAST the item's last content is not covered:
       * it is the row someone presses Tab on to start writing, and its guide
       * belongs to the line, not to wherever the cursor happens to be. Tying it
       * to the cursor made the line chase the caret down the note.
       */
      let item: SyntaxNode | null = null
      for (let node: SyntaxNode | null = tree.resolveInner(line.from, 1); node; node = node.parent) {
        if (node.name === 'ListItem') {
          item = node
          break
        }
      }
      if (line.text.trim() === '') {
        if (isListPadding(state, tree, line.number)) continue
      } else if (item !== null) {
        continue
      }
      const block = view.lineBlockAt(line.from)
      const top = view.documentTop + block.top - origin.top
      const height = Math.max(2, block.height - 2)
      for (let level = 0; level < levels; level++) {
        const at = Math.round(lineLeft + LIST_GUTTER + level * levelStep(view) + bulletWidth(view) / 2)
        markers.push(new RectangleMarker('cm-indent-guide', at, top, 1, height))
      }
    }
  }

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'ListItem' || seen.has(node.from)) return undefined
        seen.add(node.from)
        const columns = itemColumns(view, state, node.node, livePreview)
        if (columns === null) return undefined
        /**
         * Down to the last child if there is a nested list, otherwise down to
         * the end of the item itself.
         *
         * An item can own lines without owning a sublist - an indented maths
         * block or paragraph under a bullet - and those belong to it just as
         * much as a child bullet does. Obsidian draws the guide beside them;
         * requiring a nested list left exactly those blocks floating free.
         */
        const nested = node.node.getChild('BulletList') ?? node.node.getChild('OrderedList')
        const body = nested ?? node.node

        /**
         * Down the middle of this item's own bullet.
         *
         * Computed from the same columns the item is laid out with, not
         * measured off the rendered marker: in Live Preview that marker is a
         * replaced widget, and asking the editor where it is gives the
         * position AFTER it - which put the line to the right of the child
         * bullets it was meant to gather, so every nested item looked like it
         * had a stray vertical rule wedged between its dot and its words.
         */
        const x = Math.round(lineLeft + LIST_GUTTER + columns.indent + columns.marker / 2)

        /**
         * A level the parser does not believe in still gets its line.
         *
         * Indenting the first item of a list gives it no parent to hang a guide
         * from, so the indent would have been a silent shift of the text. The
         * line IS the indent as far as anyone using the editor is concerned:
         * Tab puts one there, ⇧Tab takes it away.
         */
        if (columns.orphan > 0) {
          const block = view.lineBlockAt(node.from)
          const end = view.lineBlockAt(trimEnd(state, node.from, node.to))
          const top = view.documentTop + block.top - origin.top
          const bottom = view.documentTop + end.bottom - origin.top
          for (let level = 0; level < columns.orphan; level++) {
            const at = Math.round(lineLeft + LIST_GUTTER + level * columns.step + columns.marker / 2)
            markers.push(new RectangleMarker('cm-indent-guide', at, top, 1, Math.max(2, bottom - top - 2)))
          }
        }

        const first = view.lineBlockAt(node.from)
        const last = view.lineBlockAt(nested === null ? ownEnd(state, node.node) : trimEnd(state, body.from, body.to))
        const top = view.documentTop + first.bottom - origin.top
        const bottom = view.documentTop + last.bottom - origin.top
        // Folded: the children are hidden inside the item's own line, so there
        // is nothing to draw the line down to.
        if (bottom - top < 4) return undefined
        markers.push(new RectangleMarker('cm-indent-guide', x, top, 1, bottom - top - 2))
        return undefined
      },
    })
  }
  return markers
}

export const guideLayer = layer({
  above: false,
  class: 'cm-indent-guides',
  update: (update) =>
    update.docChanged ||
    update.viewportChanged ||
    update.geometryChanged ||
    foldsChanged(update) ||
    syntaxTree(update.startState) !== syntaxTree(update.state),
  markers: guideMarkers,
})

/**
 * The end of what an item actually draws inside itself.
 *
 * A line typed hard against the margin under a bullet is a lazy continuation as
 * far as the parser is concerned - the ListItem node swallows it - but it is
 * laid out at the margin rather than under the item's text, so the item's guide
 * must not run down beside it: the line would sit against a paragraph that is
 * visibly not in the list, which reads as a stray tick rather than as an
 * indent. Walk back to the last row that carries indentation of its own.
 */
function ownEnd(state: EditorState, node: SyntaxNode): number {
  const first = state.doc.lineAt(node.from).number
  let n = state.doc.lineAt(trimEnd(state, node.from, node.to)).number
  while (n > first && !/^[ \t]/.test(state.doc.line(n).text)) n--
  return state.doc.line(n).to
}
