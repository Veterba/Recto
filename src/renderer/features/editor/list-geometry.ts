/**
 * Where list items sit: text widths measured in the editor's own font, the
 * hanging indent of wrapped lines, and each item's columns.
 */

import { type EditorView, Decoration } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { EditorState } from '@codemirror/state'

export const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/

/** Width in columns of leading whitespace, tabs counted as four. */
const columns = (whitespace: string): number => [...whitespace].reduce((n, c) => n + (c === '\t' ? 4 : 1), 0)

/**
 * How wide a piece of the editor's own text is, in pixels.
 *
 * Indents used to be written in `ch`, which is the width of a "0" - exact in a
 * monospace font and wrong in every other, where a bullet's wrapped rows then
 * sat a few pixels off its own text. Measured against the editor's real font
 * instead, through a canvas, and cached per font: no layout reads, so this
 * cannot start a measure loop.
 */
let fontKey = ''

let measurer: CanvasRenderingContext2D | null = null

const textWidths = new Map<string, number>()

export function widthOf(view: EditorView, text: string): number {
  if (text === '') return 0
  const style = getComputedStyle(view.contentDOM)
  const key = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  if (key !== fontKey) {
    fontKey = key
    textWidths.clear()
    measurer ??= document.createElement('canvas').getContext('2d')
    if (measurer !== null) measurer.font = key
  }
  const cached = textWidths.get(text)
  if (cached !== undefined) return cached
  // A tab is drawn as four columns; measuring one gives whatever the font says.
  const width = measurer === null ? text.length * 8 : measurer.measureText(text.replace(/\t/g, '    ')).width
  textWidths.set(text, width)
  return width
}

/** The `ch` unit the widgets are sized in, in pixels. */
const zero = (view: EditorView): number => widthOf(view, '0')

/**
 * Hanging indent for a wrapped list item, in pixels.
 *
 * Without it a long list item wraps back to the left margin, under its own
 * bullet, and a nested list turns into a ragged wall of text - which is what a
 * note copied from Obsidian looked like. The wrapped rows now line up with the
 * text after the marker, the way Obsidian and every word processor do it.
 */
const hangCache = new Map<string, Decoration>()

export function hang(pad: number, pull: number): Decoration {
  const padPx = Math.round(pad * 2) / 2
  const pullPx = Math.round(pull * 2) / 2
  const key = `${padPx}:${pullPx}`
  let deco = hangCache.get(key)
  if (deco === undefined) {
    deco = Decoration.line({
      attributes: { style: `padding-left: calc(6px + ${padPx}px); text-indent: -${pullPx}px` },
    })
    hangCache.set(key, deco)
  }
  return deco
}

/**
 * A whole line pushed in to a column, wrapped rows included.
 *
 * For a line that CONTINUES a list item: it belongs under the item's text, and
 * it may carry no indentation of its own at all ("lazy continuation", which
 * markdown allows and people type constantly). A hanging indent is wrong here
 * - that would leave its first row at the margin and only the wrapped rows
 * indented, which is the text "floating left" then jumping right.
 */
const indentCache = new Map<string, Decoration>()

export function continuation(column: number, typed: number): Decoration {
  const px = Math.round(column * 2) / 2
  const typedPx = Math.round(typed * 2) / 2
  const key = `${px}:${typedPx}`
  let deco = indentCache.get(key)
  if (deco === undefined) {
    // Padding puts the whole line at the item's column; the negative indent
    // cancels the spaces the line was typed with, so its first row and its
    // wrapped rows land in the same place.
    deco = Decoration.line({
      attributes: { style: `padding-left: calc(6px + ${px}px); text-indent: -${typedPx}px` },
    })
    indentCache.set(key, deco)
  }
  return deco
}

/**
 * A list item's two widths, in pixels: the whitespace it was typed with, and
 * its marker as the editor DRAWS it - which is not what the source says, since
 * Live Preview replaces `- ` with a dot two columns wide and `- [ ] ` with a
 * checkbox three columns wide.
 */
type ListGeometry = { lead: number; marker: number }

export function listGeometry(view: EditorView, text: string, livePreview: boolean): ListGeometry | null {
  const item = LIST_ITEM.exec(text)
  if (item === null) return null
  const lead = widthOf(view, item[1] ?? '')
  const marker = item[2] ?? '-'
  const spaces = item[3] ?? ' '
  const task = item[4]
  if (livePreview && task !== undefined) return { lead, marker: 3 * zero(view) }
  if (livePreview && /^[-*+]$/.test(marker)) return { lead, marker: 2 * zero(view) }
  return { lead, marker: widthOf(view, marker + spaces + (task ?? '')) }
}

/** The line's own left padding, the origin every list measurement starts from. */
export const LIST_GUTTER = 6

/**
 * What one nesting level is worth, in pixels.
 *
 * A fixed step off the font size, not the width of the parent's marker: a
 * marker is about two characters, which in a monospace font is exactly what
 * two typed spaces already were - so indenting by it moved nothing, and the
 * guide drawn between the two columns had nowhere to sit but on top of the
 * child's own dot. 1.6em is Obsidian's step, near enough, and it is wide
 * enough that a level is unmistakable at a glance.
 */
export function levelStep(view: EditorView): number {
  const size = parseFloat(getComputedStyle(view.contentDOM).fontSize)
  return Math.round((Number.isFinite(size) ? size : 14) * 1.6)
}

/** The width of a Live Preview bullet, which every guide column is centred on. */
export const bulletWidth = (view: EditorView): number => 2 * zero(view)

/**
 * Levels of indentation on a line that is NOT a list item - a plain paragraph,
 * or an empty line someone has just pressed Tab on.
 *
 * Markdown nests on two columns, so two columns is a level here too. Without
 * this, Tab on an empty line moved the caret by the width of two spaces - about
 * nine pixels in a proportional font - and then the text jumped to a different
 * column the moment a `- ` turned it into a list item. One model for both means
 * the caret, the text and the bullet all land in the same place.
 */
export function plainLevels(text: string): number {
  if (LIST_ITEM.test(text)) return 0
  const lead = /^[ \t]*/.exec(text)?.[0] ?? ''
  if (lead.length === text.length && lead.length === 0) return 0
  return Math.min(6, Math.floor(columns(lead) / 2))
}

/** How many list items enclose this one. */
function listDepth(item: SyntaxNode): number {
  let depth = 0
  for (let parent = item.parent; parent !== null; parent = parent.parent) {
    if (parent.name === 'ListItem') depth++
  }
  return depth
}

/**
 * Where a list item's bullet and text sit, in pixels from the line's left edge.
 *
 * Indent by nesting LEVEL, never by the whitespace in the file. Markdown nests
 * on two spaces; whether those two spaces are nine pixels or twenty is an
 * accident of the font, and letting them decide meant a child's bullet landed
 * in its parent's column and the nesting was invisible. One step per level
 * puts every bullet in a column that belongs to its depth and nothing else -
 * which is also what makes the indent guides placeable, since their x is then
 * a number this module can hand out rather than something measured off a
 * widget after the fact.
 */
export function itemColumns(
  view: EditorView,
  state: EditorState,
  item: SyntaxNode,
  livePreview: boolean,
): { indent: number; marker: number; step: number; orphan: number } | null {
  const text = state.doc.lineAt(item.from).text
  const geometry = listGeometry(view, text, livePreview)
  if (geometry === null) return null
  const step = levelStep(view)
  const orphan = listDepth(item) === 0 ? orphanDepth(text) : 0
  return { indent: (listDepth(item) || orphan) * step, marker: geometry.marker, step, orphan }
}

/**
 * Levels the PARSER did not count.
 *
 * Indenting the first item of a list changes nothing as far as markdown is
 * concerned - there is no sibling above it to become a child of, so the tree
 * keeps it at the top level however far in it is typed. The editor still draws
 * it where it was put, because a Tab that leaves the line exactly where it was
 * reads as a broken key. Only consulted when the tree says depth zero: below
 * that, the tree knows, and guessing over the top of it would show a
 * four-space file one level deeper than it is.
 */
function orphanDepth(text: string): number {
  const item = LIST_ITEM.exec(text)
  if (item === null) return 0
  const typed = (item[1] ?? '').length
  const unit = (item[2] ?? '-').length + (item[3] ?? ' ').length
  return Math.min(3, Math.floor(typed / Math.max(2, unit)))
}
