import { describe, expect, it } from 'vitest'
import {
  cellFromInput,
  clearCells,
  deleteColumn,
  deleteRow,
  duplicateColumn,
  duplicateRow,
  emptyTable,
  formatTable,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  numericValue,
  parseDelimited,
  parseTableSource,
  pasteCells,
  setAlign,
  setCell,
  sortRows,
  splitRawRow,
  toMarkdown,
  toTsv,
} from '../../../../src/renderer/features/editor/table-model'

const SOURCE = [
  '| Name | Qty | Note |',
  '|:--|--:|:-:|',
  '| Apples | 10 | a \\| b |',
  '| [[Pears|pear]] | 2 | `x|y` and $|v|$ |',
  '| Plums | 100 | line<br>two |',
].join('\n')

describe('reading a table', () => {
  it('keeps every cell as written: escapes, links, code, maths, <br>', () => {
    const model = parseTableSource(SOURCE)!
    expect(model.align).toEqual(['left', 'right', 'center'])
    expect(model.rows[1]).toEqual(['Apples', '10', 'a \\| b'])
    expect(model.rows[2]).toEqual(['[[Pears|pear]]', '2', '`x|y` and $|v|$'])
    expect(model.rows[3]![2]).toBe('line<br>two')
  })

  it('pads short rows and needs a delimiter row', () => {
    expect(parseTableSource('| a | b |\n|---|---|\n| 1 |')!.rows[1]).toEqual(['1', ''])
    expect(parseTableSource('| a | b |\n| 1 | 2 |')).toBeNull()
    expect(splitRawRow('a | b')).toEqual(['a', 'b'])
  })
})

describe('writing a table back', () => {
  it('lines up the pipes and keeps the alignment row', () => {
    expect(formatTable(parseTableSource(SOURCE)!)).toBe(
      [
        '| Name           | Qty |      Note       |',
        '| :------------- | --: | :-------------: |',
        '| Apples         |  10 |     a \\| b      |',
        '| [[Pears|pear]] |   2 | `x|y` and $|v|$ |',
        '| Plums          | 100 |   line<br>two   |',
      ].join('\n'),
    )
  })

  it('round-trips: formatting a formatted table changes nothing', () => {
    const once = formatTable(parseTableSource(SOURCE)!)
    expect(formatTable(parseTableSource(once)!)).toBe(once)
  })

  it('counts wide characters as two columns', () => {
    const table = formatTable(parseTableSource('| 日本 | a |\n|---|---|\n| x | y |')!)
    expect(table.split('\n')[2]).toBe('| x    | y   |')
  })

  it('escapes a typed pipe, but not inside code, maths or a link; a newline becomes <br>', () => {
    expect(cellFromInput('a | b')).toBe('a \\| b')
    expect(cellFromInput('`a|b` $|x|$ [[n|alias]] \\|')).toBe('`a|b` $|x|$ [[n|alias]] \\|')
    expect(cellFromInput('one\ntwo')).toBe('one<br>two')
  })
})

describe('rows and columns', () => {
  const base = parseTableSource('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |')!

  it('inserts, duplicates, deletes and moves rows - never the header', () => {
    expect(insertRow(base, 1).rows).toEqual([
      ['a', 'b'],
      ['', ''],
      ['1', '2'],
      ['3', '4'],
    ])
    expect(insertRow(base, 0).rows[1]).toEqual(['', ''])
    expect(duplicateRow(base, 2).rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
      ['3', '4'],
    ])
    expect(deleteRow(base, 1).rows).toEqual([
      ['a', 'b'],
      ['3', '4'],
    ])
    expect(deleteRow(base, 0).rows).toEqual(base.rows)
    expect(moveRow(base, 2, 1).rows).toEqual([
      ['a', 'b'],
      ['3', '4'],
      ['1', '2'],
    ])
    expect(moveRow(base, 1, 0).rows).toEqual(base.rows)
  })

  it('inserts, duplicates, deletes and moves columns, with their alignment', () => {
    const aligned = setAlign(base, 1, 'right')
    expect(insertColumn(aligned, 1).rows[0]).toEqual(['a', 'Column 3', 'b'])
    expect(insertColumn(aligned, 1).align).toEqual([null, null, 'right'])
    expect(duplicateColumn(aligned, 1).align).toEqual([null, 'right', 'right'])
    expect(deleteColumn(aligned, 0).rows).toEqual([['b'], ['2'], ['4']])
    expect(deleteColumn(deleteColumn(aligned, 0), 0).rows).toEqual([['b'], ['2'], ['4']])
    const moved = moveColumn(aligned, 1, 0)
    expect(moved.rows[0]).toEqual(['b', 'a'])
    expect(moved.align).toEqual(['right', null])
  })

  it('starts a new table with a header and empty rows', () => {
    const t = emptyTable(3, 4)
    expect(t.rows.length).toBe(4)
    expect(t.rows[0]).toEqual(['Column 1', 'Column 2', 'Column 3'])
    expect(formatTable(t).split('\n').length).toBe(5)
  })

  it('sets and clears cells', () => {
    expect(setCell(base, 1, 1, 'x').rows[1]).toEqual(['1', 'x'])
    expect(clearCells(base, { top: 1, left: 0, bottom: 2, right: 0 }).rows).toEqual([
      ['a', 'b'],
      ['', '2'],
      ['', '4'],
    ])
  })
})

describe('sorting', () => {
  const t = parseTableSource('| item | n |\n|---|---|\n| b | 10 |\n| a | 9 |\n| c |  |\n| d | 100 |\n| e | 1,200 |')!

  it('sorts numbers as numbers, empty last, header on top', () => {
    expect(sortRows(t, 1, 'asc').rows.map((r) => r[0])).toEqual(['item', 'a', 'b', 'd', 'e', 'c'])
    expect(sortRows(t, 1, 'desc').rows.map((r) => r[0])).toEqual(['item', 'e', 'd', 'b', 'a', 'c'])
  })

  it('sorts text A to Z with numbers inside it in order', () => {
    const files = parseTableSource('| f |\n|---|\n| note 10 |\n| Note 2 |\n| apple |')!
    expect(sortRows(files, 0, 'asc').rows.map((r) => r[0])).toEqual(['f', 'apple', 'Note 2', 'note 10'])
  })

  it('reads numbers with signs, separators, currency and percent', () => {
    expect(numericValue('1,200')).toBe(1200)
    expect(numericValue('-3.5')).toBe(-3.5)
    expect(numericValue('12 %')).toBe(12)
    expect(numericValue('€40')).toBe(40)
    expect(numericValue('**7**')).toBe(7)
    expect(numericValue('v2')).toBeNull()
    expect(numericValue('2026-10-10')).toBeNull()
  })
})

describe('TSV and CSV', () => {
  it('reads TSV, and CSV with quotes', () => {
    expect(parseDelimited('a\tb\n1\t2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseDelimited('name,note\n"Smith, J","said ""hi"""\n')).toEqual([
      ['name', 'note'],
      ['Smith, J', 'said "hi"'],
    ])
  })

  it('does not take prose for a CSV', () => {
    expect(parseDelimited('Hello, world.\nAnother line, with a comma, or two.')).toBeNull()
    expect(parseDelimited('just text')).toBeNull()
  })

  it('writes TSV and a markdown table from cells', () => {
    const cells = [
      ['a', 'b \\| c'],
      ['1', 'x<br>y'],
    ]
    expect(toTsv(cells)).toBe('a\tb | c\n1\tx y')
    expect(toMarkdown(cells)).toBe('| a   | b \\| c |\n| --- | ------ |\n| 1   | x<br>y |')
  })

  it('pastes cells from a cell on, growing the table', () => {
    const t = parseTableSource('| a | b |\n|---|---|\n| 1 | 2 |')!
    const pasted = pasteCells(t, 1, 1, [
      ['x', 'y'],
      ['z', 'w|v'],
    ])
    expect(pasted.rows).toEqual([
      ['a', 'b', 'Column 3'],
      ['1', 'x', 'y'],
      ['', 'z', 'w\\|v'],
    ])
  })
})

describe('a big table', () => {
  it('formats 200 × 10 quickly', () => {
    const rows = Array.from({ length: 201 }, (_, r) => Array.from({ length: 10 }, (_, c) => (r === 0 ? `col ${c}` : `${r * c}`)))
    const source = formatTable({ rows, align: Array(10).fill(null) })
    const start = performance.now()
    for (let i = 0; i < 20; i++) formatTable(setCell(parseTableSource(source)!, 100, 5, `v${i}`))
    expect((performance.now() - start) / 20).toBeLessThan(20)
  })
})
