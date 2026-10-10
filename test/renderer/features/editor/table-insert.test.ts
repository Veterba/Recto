// @vitest-environment jsdom
import { ChangeSet, EditorState, Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { focusTableCell, insertTableSpec, tableTail } from '../../../../src/renderer/features/editor/table-editor'

const TABLE = [
  '| Column 1 | Column 2 | Column 3 |',
  '| -------- | -------- | -------- |',
  '|          |          |          |',
  '|          |          |          |',
].join('\n')

const insert = (doc: string, at: number): { doc: string; caret: number; focusFrom: number | undefined } => {
  const state = EditorState.create({ doc, selection: { anchor: at } })
  const tr = state.update(insertTableSpec(state, 3, 3))
  const effect = tr.effects.find((e) => e.is(focusTableCell))
  return { doc: tr.state.doc.toString(), caret: tr.state.selection.main.head, focusFrom: effect?.value.from }
}

describe('inserting a table', () => {
  it('at the end of a note: a blank line under it and an empty paragraph after that, for the caret', () => {
    const r = insert('Text.', 5)
    expect(r.doc).toBe(`Text.\n\n${TABLE}\n\n`)
    expect(r.focusFrom).toBe(7)
    expect(r.caret).toBe(r.doc.length)
  })

  it('with only blank lines after it, the note counts as ending there', () => {
    const r = insert('Text.\n\n', 5)
    expect(r.doc).toBe(`Text.\n\n${TABLE}\n\n`)
    expect(r.caret).toBe(r.doc.length)
  })

  it('on an empty line between paragraphs: exactly one blank line each side', () => {
    const r = insert('A\n\n\nB', 2)
    expect(r.doc).toBe(`A\n\n${TABLE}\n\nB`)
    expect(r.doc.slice(r.caret)).toBe('\nB')
  })

  it('in the middle of text: after its line, keeping what follows', () => {
    const r = insert('One\nTwo', 1)
    expect(r.doc).toBe(`One\n\n${TABLE}\n\nTwo`)
  })

  it('asks the new table for its first header cell', () => {
    const state = EditorState.create({ doc: '', selection: { anchor: 0 } })
    const effect = state.update(insertTableSpec(state, 2, 2)).effects.find((e) => e.is(focusTableCell))
    expect(effect?.value).toMatchObject({ from: 0, row: 0, col: 0, edit: true, selectAll: true })
  })
})

describe('the lines under a table', () => {
  const T = '| a |\n| - |\n| 1 |'
  /** The document after the tail, and where the caret goes (shown as ^ when leaving). */
  const after = (doc: string, leaving: boolean): string => {
    const text = Text.of(doc.split('\n'))
    const tail = tableTail(text, T.length, leaving)
    const changes = ChangeSet.of(tail.insert === '' ? [] : [{ from: tail.at, insert: tail.insert }], text.length)
    const next = changes.apply(text).toString()
    if (!leaving) return next
    const caret = changes.mapPos(tail.caret.pos, tail.caret.assoc) + tail.caret.offset
    return `${next.slice(0, caret)}^${next.slice(caret)}`
  }

  it('always keeps one blank line under the table', () => {
    expect(after(T, false)).toBe(`${T}\n`)
    expect(after(`${T}\nText`, false)).toBe(`${T}\n\nText`)
    expect(after(`${T}\n\nText`, false)).toBe(`${T}\n\nText`)
  })

  it('leaving it, the caret lands in a paragraph after that blank line - never right under the table', () => {
    expect(after(T, true)).toBe(`${T}\n\n^`)
    expect(after(`${T}\n`, true)).toBe(`${T}\n\n^`)
    expect(after(`${T}\nText`, true)).toBe(`${T}\n\n^\n\nText`)
    expect(after(`${T}\n\nText`, true)).toBe(`${T}\n\n^\n\nText`)
    expect(after(`${T}\n\n\nText`, true)).toBe(`${T}\n\n^\nText`)
  })
})
