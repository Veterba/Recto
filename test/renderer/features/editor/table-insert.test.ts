// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { ChangeSet, EditorState, Text } from '@codemirror/state'
import { livePreviewEnabled } from '../../../../src/renderer/features/editor/live-preview-state'
import { describe, expect, it } from 'vitest'
import { focusTableCell, insertTableSpec, tableEditing, tableTail } from '../../../../src/renderer/features/editor/table-editor'

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

describe('the line under a table', () => {
  const T = '| a   |\n| --- |\n| 1   |'

  it('every table Recto writes keeps one blank line under it', () => {
    const tail = (doc: string): string => {
      const text = Text.of(doc.split('\n'))
      const t = tableTail(text, T.length)
      return ChangeSet.of(t.insert === '' ? [] : [{ from: t.at, insert: t.insert }], text.length)
        .apply(text)
        .toString()
    }
    expect(tail(T)).toBe(`${T}\n`)
    expect(tail(`${T}\n# Next`)).toBe(`${T}\n\n# Next`)
    expect(tail(`${T}\n\nText`)).toBe(`${T}\n\nText`)
  })

  /** Type `key` with the caret at `at` (Live Preview on) and return the note, the caret shown as ^. */
  const typed = (doc: string, at: number, key = 'abc'): string => {
    const state = EditorState.create({
      doc,
      selection: { anchor: at },
      extensions: [markdown({ base: markdownLanguage }), livePreviewEnabled, tableEditing()],
    })
    ensureSyntaxTree(state, state.doc.length, 5000)
    const tr = state.update({ changes: { from: at, insert: key }, selection: { anchor: at + key.length }, userEvent: 'input.type' })
    const out = tr.state.doc.toString()
    const caret = tr.state.selection.main.head
    return `${out.slice(0, caret)}^${out.slice(caret)}`
  }

  it('the first key on the empty line right under a table starts a paragraph after a blank line', () => {
    expect(typed(`${T}\n`, T.length + 1)).toBe(`${T}\n\nabc^`)
    // A paragraph below keeps its own blank line: the new text doesn't join it.
    expect(typed(`${T}\n\nMore.`, T.length + 1)).toBe(`${T}\n\nabc^\n\nMore.`)
  })

  it('with the caret on the last line of a note that ends with a table, it goes after the table', () => {
    expect(typed(T, T.length)).toBe(`${T}\n\nabc^`)
  })

  it('right above the header, it ends before a blank line', () => {
    expect(typed(`Intro\n\n${T}`, 6)).toBe(`Intro\n\nabc^\n\n${T}`)
    expect(typed(T, 0)).toBe(`abc^\n\n${T}`)
  })

  it('anywhere else it is just typing', () => {
    expect(typed(`${T}\n\nText`, T.length + 2)).toBe(`${T}\n\nabc^Text`)
    expect(typed('Plain', 5)).toBe('Plainabc^')
  })

  it('a line already glued to a table is a row and is left alone', () => {
    const glued = `${T}\n| 2   |`
    expect(typed(glued, glued.length - 1, 'x')).toBe(`${glued.slice(0, -1)}x^|`)
  })

  it('in Source mode nothing moves', () => {
    const state = EditorState.create({
      doc: `${T}\n`,
      selection: { anchor: T.length + 1 },
      extensions: [markdown({ base: markdownLanguage }), livePreviewEnabled.init(() => false), tableEditing()],
    })
    ensureSyntaxTree(state, state.doc.length, 5000)
    const tr = state.update({ changes: { from: T.length + 1, insert: 'abc' }, userEvent: 'input.type' })
    expect(tr.state.doc.toString()).toBe(`${T}\nabc`)
  })
})
