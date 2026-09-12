import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder, type Extension } from '@codemirror/state'

/**
 * Decorations for the syntax the markdown grammar does not know about:
 * `[[wikilinks]]`, `#tags`, and `- [x]` checkboxes.
 *
 * These are *styling only* - the text is untouched, and the file on disk still
 * contains exactly what you typed. That is the whole reason for choosing
 * CodeMirror: decoration is a view-layer concern, so there is no conversion
 * step that could lose something.
 *
 * Decorations are recomputed for the visible ranges only, not the whole
 * document. On a long note that is the difference between instant and janky.
 */

const WIKILINK = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g
const TAG = /(^|[\s(<])(#[\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu
const TASK = /^(\s*[-*+]\s+)(\[[ xX]\])/

const wikiMark = Decoration.mark({ class: 'cm-wikilink' })
const wikiBracket = Decoration.mark({ class: 'cm-wikilink-bracket' })
const tagMark = Decoration.mark({ class: 'cm-tag' })
const taskDone = Decoration.mark({ class: 'cm-task-done' })
const taskBox = Decoration.mark({ class: 'cm-task-box' })
const lineDone = Decoration.line({ class: 'cm-line-done' })

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()

  for (const { from, to } of view.visibleRanges) {
    const startLine = view.state.doc.lineAt(from).number
    const endLine = view.state.doc.lineAt(to).number

    for (let n = startLine; n <= endLine; n++) {
      const line = view.state.doc.line(n)
      const text = line.text

      // Checkboxes first: a completed task styles its whole line, and the
      // ranges must be added in document order for the builder.
      const task = TASK.exec(text)
      const checked = task?.[2] !== undefined && task[2] !== '[ ]'
      if (checked) builder.add(line.from, line.from, lineDone)

      type Range = { from: number; to: number; deco: Decoration }
      const ranges: Range[] = []

      if (task?.[1] !== undefined && task[2] !== undefined) {
        const boxFrom = line.from + task[1].length
        ranges.push({ from: boxFrom, to: boxFrom + task[2].length, deco: checked ? taskDone : taskBox })
      }

      for (const match of text.matchAll(WIKILINK)) {
        const start = line.from + (match.index ?? 0)
        const end = start + match[0].length
        ranges.push({ from: start, to: start + 2, deco: wikiBracket })
        ranges.push({ from: start + 2, to: end - 2, deco: wikiMark })
        ranges.push({ from: end - 2, to: end, deco: wikiBracket })
      }

      for (const match of text.matchAll(TAG)) {
        const tag = match[2]
        if (tag === undefined) continue
        // A purely numeric tag is not a tag; same rule as the indexer.
        if (/^#[\p{N}]+$/u.test(tag)) continue
        const start = line.from + (match.index ?? 0) + (match[1]?.length ?? 0)
        ranges.push({ from: start, to: start + tag.length, deco: tagMark })
      }

      // RangeSetBuilder requires sorted, non-overlapping additions.
      ranges.sort((a, b) => a.from - b.from || a.to - b.to)
      let lastTo = -1
      for (const range of ranges) {
        if (range.from < lastTo) continue
        builder.add(range.from, range.to, range.deco)
        lastTo = range.to
      }
    }
  }

  return builder.finish()
}

export const markdownDecorations = (): Extension =>
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
