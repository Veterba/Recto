import { syntaxTree } from '@codemirror/language'
import { CALLOUT_HEAD } from './live-preview'
import { isLivePreviewOn } from './live-preview-state'
import { calloutGroup } from './callout-widget'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { listGeometry, itemColumns, LIST_ITEM, hang, widthOf, continuation, plainLevels, levelStep } from './list-geometry'
import { CopyButton, LanguageLabel } from './code-widgets'

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

/** The language written after the opening fence, if any. */
function fenceLanguage(text: string): string {
  return (
    text
      .replace(/^\s*(`{3,}|~{3,})/, '')
      .trim()
      .split(/\s+/)[0] ?? ''
  )
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
        const pad = livePreview ? columns.indent + geometry.marker : Math.max(columns.indent, geometry.lead) + geometry.marker
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
        } else if (inside !== undefined && line.text.trim() !== '' && /^[ \t]/.test(line.text)) {
          /*
           * A continuation the writer asked for.
           *
           * Markdown's lazy continuation folds a line typed hard against the
           * margin into the item above it, so a note that reads
           *
           *   - a list item
           *   a new sentence
           *
           * is one paragraph as far as the parser is concerned, and drawing it
           * that way pushes the second line under the first one's text. Nobody
           * typing at the margin means "put this inside the bullet"; the way
           * to say that is Tab, which puts whitespace at the front. So only a
           * line that carries indentation of its own is placed at the item's
           * column - the rest stay where they were written.
           */
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
