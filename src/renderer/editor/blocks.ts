import { syntaxTree } from '@codemirror/language'
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
const hangCache = new Map<number, Decoration>()
function hang(width: number): Decoration {
  const px = Math.round(width * 2) / 2
  let deco = hangCache.get(px)
  if (deco === undefined) {
    deco = Decoration.line({ attributes: { style: `padding-left: calc(6px + ${px}px); text-indent: -${px}px` } })
    hangCache.set(px, deco)
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
 * Where a list item's text starts, in pixels from the line's left edge - as
 * the editor DRAWS it, which is not the same as what the source says:
 * Live Preview replaces `- ` with a dot two columns wide and `- [ ] ` with a
 * checkbox three columns wide.
 */
function contentWidth(view: EditorView, text: string, livePreview: boolean): number | null {
  const item = LIST_ITEM.exec(text)
  if (item === null) return null
  const lead = widthOf(view, item[1] ?? '')
  const marker = item[2] ?? '-'
  const spaces = item[3] ?? ' '
  const task = item[4]
  if (livePreview && task !== undefined) return lead + 3 * zero(view)
  if (livePreview && /^[-*+]$/.test(marker)) return lead + 2 * zero(view)
  return lead + widthOf(view, marker + spaces + (task ?? ''))
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
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === 'FencedCode' || node.name === 'MathBlock' || node.name === 'Table') return false
        if (node.name !== 'ListItem') return undefined
        const first = state.doc.lineAt(node.from)
        const column = contentWidth(view, first.text, livePreview)
        if (column === null) return undefined
        const last = state.doc.lineAt(node.to).number
        for (let n = first.number + 1; n <= last; n++) continues.set(n, column)
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
        const own = contentWidth(view, line.text, livePreview)
        const inside = continues.get(n)
        if (own !== null) {
          // The item's own line: its marker hangs, its wrapped rows line up
          // with its text.
          if (own > 0) entries.push({ from: line.from, to: line.from, deco: hang(own), sort: SORT.line })
        } else if (inside !== undefined && line.text.trim() !== '') {
          // A continuation: the whole line sits at the item's text column,
          // whatever indentation it was typed with.
          const typed = widthOf(view, /^[ \t]*/.exec(line.text)?.[0] ?? '')
          const column = Math.max(inside, typed)
          if (column > 0) entries.push({ from: line.from, to: line.from, deco: continuation(column, typed), sort: SORT.line })
        } else {
          const lead = /^[ \t]+/.exec(line.text)?.[0]
          if (lead !== undefined && line.text.trim() !== '') {
            entries.push({ from: line.from, to: line.from, deco: hang(widthOf(view, lead)), sort: SORT.line })
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
