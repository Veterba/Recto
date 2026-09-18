import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { CALLOUT_HEAD, isLivePreviewOn } from './live-preview'
import { calloutGroup } from './rich-widgets'
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

/**
 * Block-level looks: fenced code and blockquotes.
 *
 * These apply in BOTH modes. Live Preview hides the *markers* (the backticks,
 * the `>`, the `<div>` tags); this module gives the blocks themselves a shape,
 * and it has to keep doing so in Source mode too - otherwise a quote and a code
 * block are two indistinguishable runs of grey text, which is exactly the
 * complaint that produced this file.
 *
 * Everything here is a line decoration rather than a block replacement, so it
 * can come from a ViewPlugin and cost only the visible lines. The one widget is
 * the copy button, which is inline at the end of the opening fence.
 */

/** Copy the code in a fence. Positioned at the opening fence line. */
class CopyButton extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly to: number,
  ) {
    super()
  }

  override eq(other: CopyButton): boolean {
    return other.from === this.from && other.to === this.to
  }

  override toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('button')
    button.className = 'cm-code-copy'
    button.type = 'button'
    button.title = 'Copy code'
    button.setAttribute('aria-label', 'Copy code')
    button.textContent = 'Copy'
    button.addEventListener('mousedown', (event) => {
      // mousedown, not click: the editor would otherwise move the cursor into
      // the code block before the handler runs.
      event.preventDefault()
      const text = view.state.doc.sliceString(this.from, this.to)
      void navigator.clipboard.writeText(text).then(
        () => {
          button.textContent = 'Copied'
          button.classList.add('is-done')
          window.setTimeout(() => {
            button.textContent = 'Copy'
            button.classList.remove('is-done')
          }, 1200)
        },
        () => {
          // Clipboard access can be refused; saying so beats doing nothing.
          button.textContent = 'Failed'
        },
      )
    })
    return button
  }

  override ignoreEvent(): boolean {
    return false
  }
}

const codeLine = Decoration.line({ class: 'cm-codeblock' })
const codeFirst = Decoration.line({ class: 'cm-codeblock cm-codeblock-first' })
const codeLast = Decoration.line({ class: 'cm-codeblock cm-codeblock-last' })
const codeOnly = Decoration.line({ class: 'cm-codeblock cm-codeblock-first cm-codeblock-last' })
const quoteLine = Decoration.line({ class: 'cm-quoteblock' })
const highlightMark = Decoration.mark({ class: 'cm-highlight' })
/** A nested item's leading whitespace: structure, drawn as a column instead. */
const hideLead = Decoration.replace({})

const HIGHLIGHT = /==([^=\n]+)==/g
const QUOTE = /^\s*>\s?/
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/

/** Callout lines, cached by group, since a note may have many. */
const calloutLines = new Map<string, { body: Decoration; head: Decoration }>()
function calloutDecos(group: string): { body: Decoration; head: Decoration } {
  let decos = calloutLines.get(group)
  if (decos === undefined) {
    decos = {
      body: Decoration.line({ class: `cm-callout cm-callout-${group}` }),
      head: Decoration.line({ class: `cm-callout cm-callout-${group} cm-callout-head` }),
    }
    calloutLines.set(group, decos)
  }
  return decos
}

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

function widthOf(view: EditorView, text: string): number {
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
function hang(pad: number, pull: number): Decoration {
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
function continuation(column: number, typed: number): Decoration {
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

function listGeometry(view: EditorView, text: string, livePreview: boolean): ListGeometry | null {
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

/** The language written after the opening fence, if any. */
function fenceLanguage(text: string): string {
  return text.replace(/^\s*(`{3,}|~{3,})/, '').trim().split(/\s+/)[0] ?? ''
}

function build(view: EditorView): DecorationSet {
  const state = view.state

  /**
   * `sort` is NOT the decoration's own side - it mirrors it.
   *
   * RangeSetBuilder requires additions at one position to arrive in increasing
   * `startSide` order, and a line decoration's startSide is hugely negative
   * while a widget's is whatever `side` says. Sorting by the wrong number
   * throws inside the plugin, which CodeMirror swallows into "this plugin
   * produced no decorations" - the whole block layer silently disappeared.
   */
  type Entry = { from: number; to: number; deco: Decoration; sort: number }
  const SORT = { line: 0, copy: 1, label: 2, mark: 3 }
  const entries: Entry[] = []

  // --- fenced code, from the grammar rather than by counting backticks -----
  //
  // A fence can start above the viewport, so matching ``` on visible lines
  // alone cannot tell whether a line is inside one. The syntax tree can.
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'FencedCode') return
        const firstLine = state.doc.lineAt(node.from)
        const lastLine = state.doc.lineAt(node.to)

        // In Live Preview the fence lines are hidden, so the rounded ends have
        // to sit on the first and last lines of CODE. In Source mode the
        // fences are visible and are themselves the ends of the block.
        const hidesFences = isLivePreviewOn(view)
        const top = hidesFences ? Math.min(firstLine.number + 1, lastLine.number) : firstLine.number
        const bottom = hidesFences ? Math.max(lastLine.number - 1, firstLine.number) : lastLine.number

        for (let n = top; n <= bottom; n++) {
          const line = state.doc.line(n)
          const deco = n === top ? (n === bottom ? codeOnly : codeFirst) : n === bottom ? codeLast : codeLine
          entries.push({ from: line.from, to: line.from, deco, sort: SORT.line })
        }

        // The chip and the copy button ride on the first visible line of the
        // block, so they survive the fence line being hidden.
        const anchor = state.doc.line(top)

        // The code itself is everything between the two fence lines.
        const bodyFrom = Math.min(firstLine.to + 1, state.doc.length)
        const bodyTo = Math.max(bodyFrom, lastLine.from - 1)
        entries.push({
          from: anchor.from,
          to: anchor.from,
          deco: Decoration.widget({ widget: new CopyButton(bodyFrom, bodyTo), side: -2 }),
          sort: SORT.copy,
        })

        const language = fenceLanguage(firstLine.text)
        if (language !== '') {
          entries.push({
            from: anchor.from,
            to: anchor.from,
            deco: Decoration.widget({ widget: new LanguageLabel(language), side: -1 }),
            sort: SORT.label,
          })
        }
      },
    })

    // --- callouts: a blockquote whose first line is `> [!type]` -----------
    //
    // From the tree, so the whole quote gets the callout's colour even when its
    // first line is above the viewport.
    const calloutByLine = new Map<number, Decoration>()
    const skipHang = new Set<number>()
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === 'FencedCode' || node.name === 'MathBlock' || node.name === 'Table') {
          const a = state.doc.lineAt(node.from).number
          const b = state.doc.lineAt(node.to).number
          for (let n = a; n <= b; n++) skipHang.add(n)
          return false
        }
        if (node.name !== 'Blockquote') return undefined
        const first = state.doc.lineAt(node.from)
        const head = CALLOUT_HEAD.exec(first.text)
        if (head === null) return undefined
        const decos = calloutDecos(calloutGroup(head[2] ?? 'note'))
        const last = state.doc.lineAt(node.to).number
        for (let n = first.number; n <= last; n++) calloutByLine.set(n, n === first.number ? decos.head : decos.body)
        return false
      },
    })

    // --- line-level: quotes, callouts, hanging indents and highlight -------
    const startLine = state.doc.lineAt(from).number
    const endLine = state.doc.lineAt(to).number
    const livePreview = isLivePreviewOn(view)

    /**
     * Lines that continue a list item, and the column their item's text is at.
     *
     * From the tree, because whether a line belongs to the item above it is a
     * question about the document's structure, not about how many spaces it
     * happens to start with. Nested items are entered after their parents, so
     * their own column wins for the lines inside them.
     */
    const continues = new Map<number, number>()
    /** Each item's own line, with where its bullet and its text belong. */
    const items = new Map<number, { pad: number; pull: number }>()
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === 'FencedCode' || node.name === 'MathBlock' || node.name === 'Table') return false
        if (node.name !== 'ListItem') return undefined
        const first = state.doc.lineAt(node.from)
        const geometry = listGeometry(view, first.text, livePreview)
        const columns = itemColumns(view, state, node.node, livePreview)
        if (geometry === null || columns === null) return undefined
        /**
         * `pad` is where the item's TEXT sits, `pull` how far the first row is
         * dragged back out of it so the marker lands in front of that text.
         *
         * Live Preview hides the whitespace the item was typed with, so the
         * bullet lands in its level's own column whether the file nests by two
         * spaces or by four - the indentation is structure, and the structure
         * is already being drawn. Source mode shows the file as it is, so
         * there the typed indent is what the row is pulled back by, and the
         * padding takes whichever is wider: pulling a row further left than its
         * own padding would push the bullet out of the editor.
         */
        const pad = livePreview
          ? columns.indent + geometry.marker
          : Math.max(columns.indent, geometry.lead) + geometry.marker
        items.set(first.number, {
          pad,
          pull: livePreview ? geometry.marker : geometry.lead + geometry.marker,
        })
        const leadLength = (LIST_ITEM.exec(first.text)?.[1] ?? '').length
        if (livePreview && leadLength > 0) {
          entries.push({ from: first.from, to: first.from + leadLength, deco: hideLead, sort: SORT.mark })
        }
        const last = state.doc.lineAt(node.to).number
        for (let n = first.number + 1; n <= last; n++) continues.set(n, pad)
        return undefined
      },
    })

    for (let n = startLine; n <= endLine; n++) {
      const line = state.doc.line(n)

      const callout = calloutByLine.get(n)
      if (callout !== undefined) {
        entries.push({ from: line.from, to: line.from, deco: callout, sort: SORT.line })
      } else if (QUOTE.test(line.text)) {
        entries.push({ from: line.from, to: line.from, deco: quoteLine, sort: SORT.line })
      }

      if (!skipHang.has(n) && !QUOTE.test(line.text)) {
        const own = items.get(n)
        const inside = continues.get(n)
        if (own !== undefined) {
          // The item's own line: its marker hangs, its wrapped rows line up
          // with its text.
          entries.push({ from: line.from, to: line.from, deco: hang(own.pad, own.pull), sort: SORT.line })
        } else if (inside !== undefined && line.text.trim() !== '') {
          // A continuation: the whole line sits at the item's text column,
          // whatever indentation it was typed with.
          const typed = widthOf(view, /^[ \t]*/.exec(line.text)?.[0] ?? '')
          const column = Math.max(inside, typed)
          if (column > 0) entries.push({ from: line.from, to: line.from, deco: continuation(column, typed), sort: SORT.line })
        } else {
          // A plain line, or an empty one waiting to be typed on: its
          // indentation is levels, the same as a list item's.
          const levels = plainLevels(line.text)
          if (levels > 0) {
            const lead = /^[ \t]*/.exec(line.text)?.[0] ?? ''
            const width = widthOf(view, lead)
            entries.push({ from: line.from, to: line.from, deco: hang(levels * levelStep(view), width), sort: SORT.line })
          }
        }
      }

      for (const match of line.text.matchAll(HIGHLIGHT)) {
        const start = line.from + (match.index ?? 0)
        entries.push({ from: start, to: start + match[0].length, deco: highlightMark, sort: SORT.mark })
      }
    }
  }

  entries.sort((a, b) => a.from - b.from || a.sort - b.sort || a.to - b.to)
  const builder = new RangeSetBuilder<Decoration>()
  let lastTo = -1
  for (const entry of entries) {
    if (entry.from === entry.to) {
      builder.add(entry.from, entry.to, entry.deco)
      continue
    }
    if (entry.from < lastTo) continue
    builder.add(entry.from, entry.to, entry.deco)
    lastTo = entry.to
  }
  return builder.finish()
}

/** The `python` in ```python, shown as a chip on the fence. */
class LanguageLabel extends WidgetType {
  constructor(private readonly language: string) {
    super()
  }

  override eq(other: LanguageLabel): boolean {
    return other.language === this.language
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-code-lang'
    span.textContent = this.language
    return span
  }
}

export const blockDecorations = (): Extension =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = build(view)
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = build(update.view)
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
