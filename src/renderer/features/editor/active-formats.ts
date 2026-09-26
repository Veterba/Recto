/**
 * Which inline formats the cursor sits inside, for the toolbar's pressed state.
 */

import type { EditorState } from '@codemirror/state'

/**
 * Which formats apply at the cursor.
 *
 * Drives the toolbar's pressed state. Pure, so the "is this bold" rule is
 * tested rather than eyeballed - and it has to agree with what the toggles do,
 * or a button will look off while its shortcut turns the format off.
 */
export type Format =
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'bold'
  | 'italic'
  | 'code'
  | 'strikethrough'
  | 'highlight'
  | 'math'
  | 'bullet'
  | 'numbered'
  | 'task'
  | 'quote'

const WRAPPERS: readonly { format: Format; marker: string }[] = [
  // Longest first: '**' must be tested before '*', or bold always reads as italic.
  { format: 'bold', marker: '**' },
  { format: 'strikethrough', marker: '~~' },
  { format: 'highlight', marker: '==' },
  { format: 'italic', marker: '*' },
  { format: 'code', marker: '`' },
  { format: 'math', marker: '$' },
]

export function activeFormats(state: EditorState): Set<Format> {
  const active = new Set<Format>()
  const range = state.selection.main
  const line = state.doc.lineAt(range.head)

  // --- block formats, from the line prefix ---
  const heading = /^\s*(#{1,6})\s/.exec(line.text)
  if (heading?.[1] !== undefined) active.add(`heading-${heading[1].length}` as Format)
  if (/^\s*[-*+]\s+\[[ xX]\]\s/.test(line.text)) active.add('task')
  else if (/^\s*[-*+]\s/.test(line.text)) active.add('bullet')
  if (/^\s*\d+\.\s/.test(line.text)) active.add('numbered')
  if (/^\s*>\s/.test(line.text)) active.add('quote')

  // --- inline formats, by looking outward from the cursor ---
  const text = line.text
  const offset = range.head - line.from
  const selected = state.doc.sliceString(range.from, range.to)

  for (const { format, marker } of WRAPPERS) {
    if (active.has(format)) continue

    // A selection that is itself wrapped.
    if (selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
      active.add(format)
      continue
    }
    // Markers immediately outside the selection.
    const before = state.doc.sliceString(Math.max(0, range.from - marker.length), range.from)
    const after = state.doc.sliceString(range.to, Math.min(state.doc.length, range.to + marker.length))
    if (before === marker && after === marker) {
      active.add(format)
      continue
    }
    // A bare cursor inside a pair on this line.
    const openAt = text.lastIndexOf(marker, Math.max(0, offset - 1))
    if (openAt === -1) continue
    const closeAt = text.indexOf(marker, openAt + marker.length)
    if (closeAt !== -1 && offset > openAt && offset <= closeAt + marker.length) active.add(format)
  }

  // '**bold**' contains '*', so bold implies a false italic and code reading.
  if (active.has('bold')) active.delete('italic')

  return active
}
