/**
 * Indenting list items with their children, and carrying indentation onto a
 * new line.
 */

import type { EditorState, TransactionSpec, ChangeSpec } from '@codemirror/state'
import { selectedLines } from './markdown-actions'

/**
 * Tab and Shift-Tab inside a list: move the item one level, with its children.
 *
 * CodeMirror's own `indentWithTab` adds an indent unit measured by the
 * language's indentation rules, which on a list line came out as six spaces -
 * and six spaces under a two-column item is not a nested item at all, it is an
 * indented code block. So Tab appeared to do nothing: no deeper bullet, no
 * guide, just a paragraph quietly turning into code.
 *
 * A level here is the previous sibling's content column - exactly the
 * indentation markdown requires for a child of it - and the whole item moves,
 * its own children included. Without a previous sibling there is nothing to
 * nest under, so nothing happens and Tab falls through to its usual meaning.
 */
const LIST_LINE = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)/

type ListLine = { number: number; indent: number; content: number }

/** The list item on this line, as columns, or null if the line is not one. */
function listLineAt(state: EditorState, number: number): ListLine | null {
  if (number < 1 || number > state.doc.lines) return null
  const text = state.doc.line(number).text
  const match = LIST_LINE.exec(text)
  if (match === null) return null
  const indent = (match[1] ?? '').length
  return { number, indent, content: indent + (match[2] ?? '').length + (match[3] ?? '').length }
}

/** Leading whitespace of a line, in characters. */
const indentOf = (text: string): number => (/^[ \t]*/.exec(text)?.[0] ?? '').length

/** The last line belonging to an item: its own, plus everything under it. */
function itemEnd(state: EditorState, item: ListLine): number {
  let last = item.number
  for (let n = item.number + 1; n <= state.doc.lines; n++) {
    const text = state.doc.line(n).text
    if (text.trim() === '') continue
    if (indentOf(text) <= item.indent) break
    last = n
  }
  return last
}

/** The item this one would become a child of, or null if it cannot move. */
function previousSibling(state: EditorState, item: ListLine): ListLine | null {
  for (let n = item.number - 1; n >= 1; n--) {
    const text = state.doc.line(n).text
    if (text.trim() === '') continue
    const indent = indentOf(text)
    if (indent > item.indent) continue
    if (indent < item.indent) return null
    return listLineAt(state, n)
  }
  return null
}

/** The item that encloses this one, for outdenting back out of it. */
function enclosing(state: EditorState, item: ListLine): ListLine | null {
  for (let n = item.number - 1; n >= 1; n--) {
    const text = state.doc.line(n).text
    if (text.trim() === '' || indentOf(text) >= item.indent) continue
    return listLineAt(state, n)
  }
  return null
}

/** One step of plain indentation, for lines that are not list items. */
const INDENT_UNIT = '  '

export function indentListItems(state: EditorState, direction: 1 | -1): TransactionSpec | null {
  const changes: ChangeSpec[] = []
  const done = new Set<number>()

  for (const line of selectedLines(state)) {
    const item = listLineAt(state, line.number)
    if (item === null) {
      /**
       * Not a list item: two spaces, and two spaces back.
       *
       * CodeMirror's own Tab asks the language how far this line should be
       * indented, and markdown's answer next to a list was SIX spaces - which
       * is not an indent at all, it is the start of a code block. Type `- ` on
       * such a line afterwards and the bullet never appears. A plain unit is
       * both predictable and the thing a list item needs.
       */
      if (done.has(line.number)) continue
      done.add(line.number)
      if (direction === 1) changes.push({ from: line.from, insert: INDENT_UNIT })
      else {
        const lead = indentOf(line.text)
        if (lead > 0) changes.push({ from: line.from, to: line.from + Math.min(INDENT_UNIT.length, lead) })
      }
      continue
    }
    if (done.has(item.number)) continue

    let shift: number
    if (direction === 1) {
      /**
       * A level is the previous sibling's content column - what markdown needs
       * for a child of it. With no sibling to nest under (the first item of a
       * list) the item's own marker width stands in: the file gains an indent
       * markdown will not read as nesting, but Tab visibly doing nothing is
       * worse than an indent only this editor draws.
       */
      const sibling = previousSibling(state, item)
      shift = sibling === null ? item.content - item.indent : sibling.content - item.indent
      if (shift <= 0) continue
    } else {
      if (item.indent === 0) continue
      const parent = enclosing(state, item)
      shift = -(parent === null ? item.indent : item.indent - parent.indent)
      if (shift === 0) continue
    }

    const last = itemEnd(state, item)
    for (let n = item.number; n <= last; n++) {
      done.add(n)
      const target = state.doc.line(n)
      if (target.text.trim() === '') continue
      if (shift > 0) changes.push({ from: target.from, insert: ' '.repeat(shift) })
      else changes.push({ from: target.from, to: target.from + Math.min(-shift, indentOf(target.text)) })
    }
  }

  if (changes.length === 0) return null
  /**
   * Map the selection forward THROUGH the indent, not back in front of it.
   *
   * A cursor sitting at the very start of an empty line is exactly where the
   * spaces get inserted, and the default mapping leaves it on the near side of
   * them: the line looked indented and the next thing typed appeared before the
   * indent, undoing it. `1` puts the cursor after anything inserted at its own
   * position.
   */
  const set = state.changes(changes)
  return {
    changes: set,
    selection: state.selection.map(set, 1),
    userEvent: direction === 1 ? 'input.indent' : 'delete.dedent',
  }
}

/**
 * A newline from an indented blank line, leaving that line's indent alone.
 *
 * CodeMirror's own newline treats a whitespace-only line as something to
 * reindent, so it takes the indentation off the line you leave and gives it to
 * the new one - the indent, and the guide drawn from it, travelled down the
 * page with the cursor instead of staying where it was put.
 *
 * `carry` is the difference between the two keys, and on a blank indented line
 * they are opposites. ⇧Enter repeats the indent: the line keeps it, the new one
 * gets it too, and the guides stack into a column you keep writing in. Enter
 * takes one level back off, WITHOUT going anywhere - `||` becomes `|` under the
 * same cursor - so the key that made the indent too deep is also the key that
 * walks it back. Once there is no indent left, Enter is an ordinary newline
 * again and this returns null.
 *
 * Only blank lines: a line with words on it, or a list item, belongs to the
 * markdown keymap, which has to continue bullets and numbering.
 */
export function newlineFromIndent(state: EditorState, carry: boolean): TransactionSpec | null {
  const range = state.selection.main
  if (!range.empty) return null
  const line = state.doc.lineAt(range.head)
  if (line.text.trim() !== '' || line.text.length === 0) return null
  if (!carry) {
    const back = Math.min(INDENT_UNIT.length, line.text.length)
    return {
      changes: { from: line.to - back, to: line.to },
      selection: { anchor: line.to - back },
      scrollIntoView: true,
      userEvent: 'delete.dedent',
    }
  }
  return {
    changes: { from: line.to, insert: `\n${line.text}` },
    selection: { anchor: line.to + 1 + line.text.length },
    scrollIntoView: true,
    userEvent: 'input',
  }
}
