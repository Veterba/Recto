import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

/**
 * Lines marked in a read-only note: what an AI suggestion would add or change,
 * in its preview (SuggestionPreview.tsx). Fixed for the life of the editor -
 * the preview's text never changes under it.
 */
export function markedLines(lines: readonly number[]): Extension {
  const mark = Decoration.line({ class: 'cm-suggested-line' })
  return EditorView.decorations.compute([], (state) => {
    const builder = new RangeSetBuilder<Decoration>()
    for (const n of [...new Set(lines)].sort((a, b) => a - b))
      if (n >= 0 && n < state.doc.lines) builder.add(state.doc.line(n + 1).from, state.doc.line(n + 1).from, mark)
    return builder.finish()
  })
}
