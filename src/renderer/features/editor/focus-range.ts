import type { Text } from '@codemirror/state'

/**
 * What focus mode keeps lit: the line, sentence or paragraph around the caret.
 *
 * Pure, over CodeMirror's `Text`, so the rules can be tested without an editor.
 */

export type FocusUnit = 'line' | 'sentence' | 'paragraph'

const blank = (text: string): boolean => text.trim() === ''

/** The block of non-blank lines around a position; a blank line is its own paragraph. */
export function paragraphAt(doc: Text, pos: number): { from: number; to: number } {
  const here = doc.lineAt(pos)
  if (blank(here.text)) return { from: here.from, to: here.to }
  let first = here.number
  let last = here.number
  while (first > 1 && !blank(doc.line(first - 1).text)) first--
  while (last < doc.lines && !blank(doc.line(last + 1).text)) last++
  return { from: doc.line(first).from, to: doc.line(last).to }
}

/**
 * A sentence ends at `.`, `!`, `?` or `…` (and any closing quotes or brackets
 * after it) followed by whitespace, or at the end of its paragraph. A line
 * break inside a paragraph does not end one - that is only wrapping - but in a
 * list or a heading each line stands alone, so those are treated as their own
 * paragraph.
 */
const END = /[.!?…]+["'”’»)\]]*(?=\s|$)/g
const STANDALONE = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>)/

export function sentenceAt(doc: Text, pos: number): { from: number; to: number } {
  const line = doc.lineAt(pos)
  const block = STANDALONE.test(line.text) ? { from: line.from, to: line.to } : paragraphAt(doc, pos)
  const text = doc.sliceString(block.from, block.to)
  const offset = pos - block.from

  let start = 0
  let end = text.length
  END.lastIndex = 0
  for (const match of text.matchAll(END)) {
    const stop = (match.index ?? 0) + match[0].length
    if (stop <= offset) {
      start = stop
    } else {
      end = stop
      break
    }
  }
  // Skip the whitespace that separates this sentence from the last.
  while (start < end && /\s/.test(text[start] ?? '')) start++
  // A caret sitting in that gap still belongs to the sentence just ended.
  if (start > offset) return sentenceAt(doc, Math.max(block.from, pos - 1) === pos ? pos : pos - 1)
  return { from: block.from + start, to: block.from + end }
}

export function focusRange(doc: Text, pos: number, unit: FocusUnit): { from: number; to: number } {
  if (unit === 'line') {
    const line = doc.lineAt(pos)
    return { from: line.from, to: line.to }
  }
  return unit === 'paragraph' ? paragraphAt(doc, pos) : sentenceAt(doc, pos)
}
