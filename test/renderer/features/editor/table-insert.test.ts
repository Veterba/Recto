// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { focusTableCell, insertTableSpec } from '../../../../src/renderer/features/editor/table-editor'

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
  it('after a line of text: one blank line before, a line to come back to after', () => {
    const r = insert('Text.', 5)
    expect(r.doc).toBe(`Text.\n\n${TABLE}\n`)
    expect(r.focusFrom).toBe(7)
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
