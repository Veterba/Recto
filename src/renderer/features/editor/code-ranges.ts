import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

/**
 * Where a note is code, between `from` and `to`: fenced and indented blocks
 * and inline code. What the line passes draw by regex - a task's box, a
 * link, an embed, a callout head, a highlight - is never drawn there: code
 * is shown as written, and a box drawn in it was clickable and changed the
 * code.
 */
export function codeRanges(state: EditorState, from: number, to: number): readonly { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'InlineCode') {
        out.push({ from: node.from, to: node.to })
        return false
      }
    },
  })
  return out
}

/** Whether `[from, to)` touches any of `code`. */
export const inCode = (code: readonly { from: number; to: number }[], from: number, to: number): boolean =>
  code.some((c) => from < c.to && to > c.from)
