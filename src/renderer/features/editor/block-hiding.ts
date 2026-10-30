/**
 * Live preview's block-level hiding: code fence lines and horizontal rules,
 * which need block decorations and so a state field of their own.
 */

import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { Facet, StateField } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { livePreviewEnabled } from './live-preview-state'
import { mathSource, MathWidget, stripContainers } from './rich-widgets'
import { TableWidget } from './table-widget'
import { EditableTableWidget, rawTables } from './table-editor'
import { detailsEnd, htmlWithText, HtmlBlockWidget, isRenderedHtmlBlock } from './html-blocks'

const FENCE_LINE = /^---\s*$/

/**
 * Block-level hiding: the frontmatter block, `---` rules, and the `<div align>`
 * tags that carry paragraph alignment.
 *
 * CodeMirror refuses block decorations from a ViewPlugin ("Block decorations
 * may not be specified via plugins") - they have to come from a StateField, so
 * the editor can account for their height before it renders. Hence this second,
 * small decoration source alongside the main plugin.
 *
 * And a block range must span whole lines, ending at a line END. Ending at the
 * next line's `from` includes the newline, is not a line end, and CodeMirror
 * silently ignores the whole decoration - which looks exactly like a condition
 * that never matched.
 */
const FENCE = /^\s*(`{3,}|~{3,})/

const hiddenBlock = Decoration.replace({ block: true })

/**
 * Where the note's properties are drawn: an element the view that owns the
 * editor renders them into (MarkdownView, through a portal). Without one - a
 * read-only reader, a floating note - the frontmatter is simply hidden.
 */
export const propertiesSlot = Facet.define<HTMLElement, HTMLElement | null>({ combine: (values) => values[0] ?? null })

/**
 * The properties, in place of the frontmatter, inside the note: they scroll
 * with the text and take no room on a note that has none.
 *
 * The slot is one element for the life of the editor, so what React drew in it
 * - an open table, a value being typed - survives the widget being redrawn. It
 * goes into a fresh wrapper each time, so an old widget's DOM being removed
 * never takes the slot with it. Every event inside is the properties' own.
 */
class PropertiesWidget extends WidgetType {
  constructor(
    readonly slot: HTMLElement,
    /** The note has no frontmatter: only "Add property", on hover. */
    readonly empty = false,
  ) {
    super()
  }
  override eq(other: PropertiesWidget): boolean {
    return other.slot === this.slot && other.empty === this.empty
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = this.empty ? 'cm-props cm-props--empty' : 'cm-props'
    wrap.append(this.slot)
    return wrap
  }
  override ignoreEvent(): boolean {
    return true
  }
}

/**
 * A horizontal rule, drawn ON its line rather than instead of it.
 *
 * It used to be a block widget replacing the whole line, which left the line
 * with no place to put a cursor: arrowing down the note jumped straight over
 * it, and a rule you cannot reach is a rule you cannot delete. The line stays a
 * line - the `---` is hidden inline, the rule is drawn across the row in CSS -
 * so the caret lands there like anywhere else and the markers come back, the
 * way every other piece of syntax in Live Preview behaves.
 */
const ruleLine = Decoration.line({ class: 'cm-rule-line' })

const ruleMarks = Decoration.replace({})

export const blockHiding = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, transaction) => {
    // The syntax tree finishes parsing a long note in the background, after the
    // transaction that opened it; a table or formula further down only appears
    // in the tree later. Recompute when the tree changes too, or those stay raw
    // until something else happens to move the caret.
    const treeChanged = syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
    // Switching Live Preview is a transaction with nothing but its effect;
    // skipping it left the blocks hidden in Source until the caret moved.
    const toggled = transaction.startState.field(livePreviewEnabled, false) !== transaction.state.field(livePreviewEnabled, false)
    if (!transaction.docChanged && transaction.selection === undefined && !treeChanged && !toggled && value !== Decoration.none) {
      return value.map(transaction.changes)
    }

    const state = transaction.state
    if (!(state.field(livePreviewEnabled, false) ?? false)) return Decoration.none

    const doc = state.doc
    const editable = state.facet(EditorView.editable)
    /** Line numbers the selection touches; those stay raw - none in a read-only view. */
    const touched = new Set<number>()
    for (const range of state.facet(EditorView.editable) ? state.selection.ranges : []) {
      const from = doc.lineAt(range.from).number
      const to = doc.lineAt(range.to).number
      for (let n = from; n <= to; n++) touched.add(n)
    }

    const ranges: { from: number; to: number; deco: Decoration }[] = []

    // --- frontmatter ------------------------------------------------------
    let frontmatterEnd = 0
    if (doc.lines >= 2 && FENCE_LINE.test(doc.line(1).text)) {
      for (let n = 2; n <= doc.lines; n++) {
        if (!FENCE_LINE.test(doc.line(n).text)) continue
        frontmatterEnd = n
        break
      }
      if (frontmatterEnd > 0) {
        let cursorInside = false
        for (let n = 1; n <= frontmatterEnd; n++) if (touched.has(n)) cursorInside = true
        if (!cursorInside) {
          const slot = state.facet(propertiesSlot)
          const deco = slot === null ? hiddenBlock : Decoration.replace({ block: true, widget: new PropertiesWidget(slot) })
          ranges.push({ from: 0, to: doc.line(frontmatterEnd).to, deco })
        }
      }
    }
    // No properties yet: the same widget above the first line, drawn faint
    // until the pointer is over it, so "Add property" is where they would go.
    const slot = state.facet(propertiesSlot)
    if (frontmatterEnd === 0 && slot !== null && editable) {
      ranges.push({ from: 0, to: 0, deco: Decoration.widget({ block: true, side: -1, widget: new PropertiesWidget(slot, true) }) })
    }

    // --- rules, maths blocks and tables, from the grammar -----------------
    //
    // Rules used to be guessed from the text: a `---` line counted unless the
    // line above had text, to avoid eating a setext heading. That guessed wrong
    // both ways - a `---` right after a list item stayed raw, and a `---` under
    // a `$$` block the grammar did not understand became a heading. The parser
    // knows which one it is, so it decides.
    /** End of a `<details>` already rendered with what it encloses. */
    let consumedTo = -1
    syntaxTree(state).iterate({
      enter: (node) => {
        const name = node.name
        if (name !== 'HorizontalRule' && name !== 'MathBlock' && name !== 'Table' && name !== 'HTMLBlock' && name !== 'FencedCode')
          return undefined
        if (node.from < consumedTo) return false
        const first = doc.lineAt(node.from)
        let last = doc.lineAt(node.to)
        if (name === 'FencedCode') {
          // The fence lines go too, not just their backticks: hiding only the
          // ``` of "```python" leaves "python" inside the block, and the
          // closing fence an empty row under it. The language is a chip
          // instead, from blocks.ts. Which lines are fences is the parser's
          // call - a regex hid any line starting with ```, prose included.
          // Only a line that is nothing but the fence: one opening in a list
          // item ("- ```") keeps its marker and stays as it was.
          if (first.number <= frontmatterEnd || !FENCE.test(first.text)) return false
          if (!touched.has(first.number)) ranges.push({ from: first.from, to: first.to, deco: hiddenBlock })
          const closed = last.number > first.number && FENCE.test(last.text)
          if (closed && !touched.has(last.number)) ranges.push({ from: last.from, to: last.to, deco: hiddenBlock })
          return false
        }
        if (name === 'HTMLBlock') {
          // `<details>` with blank lines inside parses as several blocks; render
          // it whole, up to its `</details>`, or leave it as source.
          const end = detailsEnd(doc.sliceString(node.from, node.to), doc.sliceString(node.to, Math.min(doc.length, node.to + 20_000)))
          if (end === -1) return false
          if (end > 0) last = doc.lineAt(node.to + end)
        }
        if (first.number <= frontmatterEnd) return false
        // A table you can edit in place never turns into source because the
        // caret is next to it: typing there would land in its markdown. Only
        // Source mode or "Edit as markdown" (rawTables) show it as text.
        const inPlace =
          name === 'Table' && editable && stripContainers(doc.sliceString(first.from, last.to)) === doc.sliceString(first.from, last.to)
        if (inPlace && (state.field(rawTables, false) ?? []).includes(node.from)) return false
        if (!inPlace) for (let n = first.number; n <= last.number; n++) if (touched.has(n)) return false

        if (name === 'HorizontalRule') {
          ranges.push({ from: first.from, to: first.from, deco: ruleLine })
          if (last.to > first.from) ranges.push({ from: first.from, to: last.to, deco: ruleMarks })
        } else if (name === 'HTMLBlock') {
          // Simple HTML (a pasted table, <details>, <br>) is rendered, sanitised;
          // anything else stays source.
          const html = doc.sliceString(first.from, last.to)
          if (!isRenderedHtmlBlock(html)) return false
          consumedTo = last.to
          ranges.push({
            from: first.from,
            to: last.to,
            deco: Decoration.replace({ block: true, widget: new HtmlBlockWidget(htmlWithText(stripContainers(html))) }),
          })
        } else if (name === 'MathBlock') {
          const tex = mathSource(doc.sliceString(node.from, node.to))
          ranges.push({
            from: first.from,
            to: last.to,
            deco: Decoration.replace({ block: true, widget: new MathWidget(tex, true, true) }),
          })
        } else {
          // A table at the top level of an editable note is edited in place;
          // one in a quote or a list, or in a read-only view, is drawn as before.
          const raw = doc.sliceString(first.from, last.to)
          const stripped = stripContainers(raw)
          const widget = editable && stripped === raw ? new EditableTableWidget(raw) : new TableWidget(stripped)
          ranges.push({ from: first.from, to: last.to, deco: Decoration.replace({ block: true, widget }) })
        }
        return false
      },
    })

    return Decoration.set(
      ranges.map((range) => range.deco.range(range.from, range.to)),
      true,
    )
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    /**
     * Atomic, or the cursor walks INTO a hidden block.
     *
     * A replaced block still occupies document positions. Without this, arrowing
     * up out of the body put the caret inside the hidden frontmatter or a hidden
     * code fence - which renders as nothing, so it looked like the cursor had
     * jumped to an empty row and then refused to move line by line. Atomic
     * ranges make the whole block one step.
     */
    EditorView.atomicRanges.from(field, (value) => () => value),
  ],
})
