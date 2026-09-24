import {
  codeFolding,
  ensureSyntaxTree,
  foldedRanges,
  foldEffect,
  syntaxTree,
  unfoldEffect,
} from '@codemirror/language'
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  RectangleMarker,
  ViewPlugin,
  WidgetType,
  layer,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import type { SyntaxNode, Tree } from '@lezer/common'
import { LIST_GUTTER, bulletWidth, itemColumns, levelStep, plainLevels } from './blocks'
import { isLivePreviewOn } from './live-preview'

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

export type FoldRange = { from: number; to: number }

const HEADING = /^ATXHeading(\d)$/

const headingLevel = (node: SyntaxNode): number | null => {
  const match = HEADING.exec(node.name)
  return match === null ? null : Number(match[1])
}

/**
 * Pull a range's end back past trailing blank lines.
 *
 * A section runs until the next heading, and the blank line before that heading
 * belongs visually to the gap, not to the section - folding it too glued the
 * next heading onto the folded one.
 */
function trimEnd(state: EditorState, from: number, to: number): number {
  let line = state.doc.lineAt(to)
  while (line.from > from && line.text.trim() === '') line = state.doc.lineAt(line.from - 1)
  return Math.max(from, line.to)
}

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

/** The heading that starts on this line, if any, as a top-level node. */
function headingOn(tree: Tree, lineFrom: number): SyntaxNode | null {
  const top = tree.topNode
  let node = top.childAfter(lineFrom)
  // childAfter returns the first child ending after the position, which may
  // start on an earlier line (a paragraph running into this one).
  while (node !== null && node.from < lineFrom) node = node.nextSibling
  if (node === null || node.from !== lineFrom || headingLevel(node) === null) return null
  return node
}

/** The list item whose marker is on this line, if any. */
function listItemOn(state: EditorState, tree: Tree, lineFrom: number, lineTo: number): SyntaxNode | null {
  const text = state.doc.sliceString(lineFrom, lineTo)
  const lead = /^[\s>]*/.exec(text)?.[0].length ?? 0
  if (lineFrom + lead >= lineTo) return null
  for (let node: SyntaxNode | null = tree.resolveInner(lineFrom + lead, 1); node; node = node.parent) {
    if (node.name === 'ListItem') return node.from >= lineFrom && node.from <= lineTo ? node : null
  }
  return null
}

/**
 * What folding this line would hide, or null if there is nothing under it.
 *
 * Starts at the END of the line, so the heading or the item itself stays
 * visible with its fold marker after it.
 */
export function foldRangeAt(state: EditorState, lineNumber: number, tree: Tree = syntaxTree(state)): FoldRange | null {
  if (lineNumber < 1 || lineNumber > state.doc.lines) return null
  const line = state.doc.line(lineNumber)

  const heading = headingOn(tree, line.from)
  if (heading !== null) {
    const level = headingLevel(heading) ?? 6
    let end = state.doc.length
    for (let next = heading.nextSibling; next !== null; next = next.nextSibling) {
      const nextLevel = headingLevel(next)
      if (nextLevel !== null && nextLevel <= level) {
        end = Math.max(line.to, next.from - 1)
        break
      }
    }
    const to = trimEnd(state, line.to, end)
    return to > line.to ? { from: line.to, to } : null
  }

  const item = listItemOn(state, tree, line.from, line.to)
  if (item !== null) {
    const to = trimEnd(state, line.to, item.to)
    return to > line.to ? { from: line.to, to } : null
  }

  return null
}

/**
 * The tree for the whole note, parsing the rest if it has to.
 *
 * The editor parses lazily, around what is on screen. Folding everything, or
 * restoring folds as a long note opens, needs headings far below the viewport -
 * which an unparsed tree does not have yet, so those folds silently did nothing.
 */
const whole = (state: EditorState): Tree => ensureSyntaxTree(state, state.doc.length, 300) ?? syntaxTree(state)

/** The fold currently hiding what is under this line, if there is one. */
function foldedAt(state: EditorState, lineNumber: number): FoldRange | null {
  const line = state.doc.line(lineNumber)
  let found: FoldRange | null = null
  foldedRanges(state).between(line.to, line.to, (from, to) => {
    if (from === line.to) found = { from, to }
  })
  return found
}

/** Fold or unfold the structure under one line. False if it has none. */
export function toggleFoldAt(view: EditorView, lineNumber: number): boolean {
  const existing = foldedAt(view.state, lineNumber)
  if (existing !== null) {
    view.dispatch({ effects: unfoldEffect.of(existing) })
    return true
  }
  const range = foldRangeAt(view.state, lineNumber)
  if (range === null) return false
  // A caret inside the range would unfold it again on the very next update -
  // CodeMirror opens any fold the selection lands in - so it moves to the line
  // that stays visible.
  const head = view.state.selection.main.head
  const selection = head > range.from && head <= range.to ? { anchor: range.from } : undefined
  view.dispatch({ effects: foldEffect.of(range), ...(selection === undefined ? {} : { selection }) })
  return true
}

/**
 * Fold every heading and every list item that has something under it.
 *
 * Outer structure only would leave nothing to see after unfolding one heading;
 * folding everything means opening a section shows its own sub-headings
 * folded, which is how an outline is read.
 */
export function foldAll(view: EditorView): void {
  const effects = []
  const head = view.state.selection.main.head
  /** The outermost fold the caret would end up inside, which must not open again. */
  let outer: FoldRange | null = null
  const tree = whole(view.state)
  for (let n = 1; n <= view.state.doc.lines; n++) {
    const range = foldRangeAt(view.state, n, tree)
    if (range === null || foldedAt(view.state, n) !== null) continue
    effects.push(foldEffect.of(range))
    if (head > range.from && head <= range.to && (outer === null || range.from < outer.from)) outer = range
  }
  if (effects.length === 0) return
  view.dispatch({ effects, ...(outer === null ? {} : { selection: { anchor: outer.from } }) })
}

export function unfoldAll(view: EditorView): void {
  const effects: ReturnType<typeof unfoldEffect.of>[] = []
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }))
  })
  if (effects.length > 0) view.dispatch({ effects })
}

/**
 * Folded lines, by line number - the form folds are remembered in.
 *
 * Line numbers rather than offsets because they are what a person would say
 * ("the section at line 12") and survive an edit elsewhere on the same line.
 * A remembered fold whose line no longer folds anything is simply dropped.
 */
export function foldedLines(state: EditorState): number[] {
  const lines: number[] = []
  foldedRanges(state).between(0, state.doc.length, (from) => {
    lines.push(state.doc.lineAt(from).number)
  })
  return lines
}

export function restoreFolds(view: EditorView, lines: readonly number[]): void {
  const effects = []
  const tree = whole(view.state)
  for (const n of lines) {
    const range = foldRangeAt(view.state, n, tree)
    if (range !== null) effects.push(foldEffect.of(range))
  }
  if (effects.length > 0) view.dispatch({ effects })
}

// --- the arrows ---------------------------------------------------------------

class FoldToggle extends WidgetType {
  constructor(
    private readonly folded: boolean,
    /** `h1`…`h6` for a heading, `li` for a list item - sets the size. */
    private readonly kind: string,
  ) {
    super()
  }

  override eq(other: FoldToggle): boolean {
    return other.folded === this.folded && other.kind === this.kind
  }

  override toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('span')
    button.className = `cm-fold-toggle cm-fold-toggle--${this.kind}${this.folded ? ' is-folded' : ''}`
    button.setAttribute('role', 'button')
    button.setAttribute('aria-label', this.folded ? 'Unfold' : 'Fold')
    button.setAttribute('aria-expanded', String(!this.folded))
    // A chevron drawn in CSS: one element, no icon font, and it rotates.
    button.appendChild(document.createElement('span'))
    button.addEventListener('mousedown', (event) => {
      // mousedown, and prevented: a click would first move the caret into the
      // line - and a caret inside a fold is exactly what opens it again.
      event.preventDefault()
      event.stopPropagation()
      const pos = view.posAtDOM(button)
      toggleFoldAt(view, view.state.doc.lineAt(pos).number)
    })
    return button
  }

  override ignoreEvent(): boolean {
    return true
  }
}

const toggles = new Map<string, Decoration>()
function toggle(folded: boolean, kind: string): Decoration {
  const key = `${kind}:${folded}`
  let deco = toggles.get(key)
  if (deco === undefined) {
    deco = Decoration.widget({ widget: new FoldToggle(folded, kind), side: -1 })
    toggles.set(key, deco)
  }
  return deco
}

function buildToggles(view: EditorView): DecorationSet {
  const { state } = view
  const found: { pos: number; deco: Decoration }[] = []
  const seen = new Set<number>()

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name
        if (name === 'FencedCode' || name === 'MathBlock' || name === 'Table' || name === 'FrontMatter') return false
        const level = HEADING.exec(name)
        if (level === null && name !== 'ListItem') return undefined
        const line = state.doc.lineAt(node.from)
        if (seen.has(line.number)) return undefined
        seen.add(line.number)
        if (foldRangeAt(state, line.number) === null) return undefined
        const folded = foldedAt(state, line.number) !== null
        found.push({ pos: node.from, deco: toggle(folded, level === null ? 'li' : `h${level[1]}`) })
        return undefined
      },
    })
  }

  found.sort((a, b) => a.pos - b.pos)
  const builder = new RangeSetBuilder<Decoration>()
  for (const { pos, deco } of found) builder.add(pos, pos, deco)
  return builder.finish()
}

const foldsChanged = (update: ViewUpdate): boolean => foldedRanges(update.startState) !== foldedRanges(update.state)

const toggleLayer = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildToggles(view)
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        foldsChanged(update) ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildToggles(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

// --- the guides ---------------------------------------------------------------

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
        if (node.name === 'ListItem') { item = node; break }
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
        const last = view.lineBlockAt(
          nested === null ? ownEnd(state, node.node) : trimEnd(state, body.from, body.to),
        )
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

const guideLayer = layer({
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
