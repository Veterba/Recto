import { describe, expect, it } from 'vitest'
import { calloutGroup, mathSource, parseTable, splitRow, stripContainers } from '../src/renderer/editor/rich-widgets'

describe('splitRow', () => {
  it('splits on pipes and drops the outer ones', () => {
    expect(splitRow('| a | b | c |')).toEqual(['a', 'b', 'c'])
  })

  it('works without outer pipes, as GFM allows', () => {
    expect(splitRow('a | b')).toEqual(['a', 'b'])
  })

  /** `$|x|$` is an absolute value, not two columns. */
  it('keeps pipes inside maths and code in the cell', () => {
    expect(splitRow('| $|x|$ | `a|b` |')).toEqual(['$|x|$', '`a|b`'])
  })

  it('reads an escaped pipe as a pipe', () => {
    expect(splitRow('| a \\| b | c |')).toEqual(['a | b', 'c'])
  })
})

describe('parseTable', () => {
  it('reads head, alignment and rows from the table in the copied note', () => {
    const table = parseTable(
      [
        '| Форма | Запись | Что видно сразу |',
        '| --- | :---: | ---: |',
        '| Slope-intercept | $y=mx+b$ | наклон m |',
        '| Point-slope | $y-y_1=m(x-x_1)$ | точка $(x_1,y_1)$ |',
      ].join('\n'),
    )
    expect(table?.head).toEqual(['Форма', 'Запись', 'Что видно сразу'])
    expect(table?.align).toEqual([null, 'center', 'right'])
    expect(table?.rows[1]).toEqual(['Point-slope', '$y-y_1=m(x-x_1)$', 'точка $(x_1,y_1)$'])
  })

  it('refuses something that is not a table', () => {
    expect(parseTable('| just one line |')).toBe(null)
  })
})

describe('mathSource', () => {
  it('strips the fences and the trailing spaces Obsidian leaves', () => {
    expect(mathSource('$$  \n6x-4=-3x+2  \n$$')).toBe('6x-4=-3x+2')
  })

  /** A formula inside a quote carries `> ` on every line; KaTeX would choke on it. */
  it('strips quote markers from a block inside a blockquote', () => {
    expect(mathSource('> $$\n> x^2\n> $$')).toBe('x^2')
  })

  it('strips list indentation', () => {
    expect(mathSource('    $$\n    \\frac{a}{b}\n    $$')).toBe('\\frac{a}{b}')
  })

  it('handles an unterminated block', () => {
    expect(mathSource('$$\nx+1')).toBe('x+1')
  })
})

describe('stripContainers', () => {
  it('removes a common indent but keeps relative indentation', () => {
    expect(stripContainers('  a\n    b')).toBe('a\n  b')
  })
})

describe('calloutGroup', () => {
  it('maps aliases to their colour group, case-insensitively', () => {
    expect(calloutGroup('TLDR')).toBe('abstract')
    expect(calloutGroup('caution')).toBe('warning')
    expect(calloutGroup('bug')).toBe('danger')
  })

  it('treats an unknown type as a note, as Obsidian does', () => {
    expect(calloutGroup('whatever')).toBe('note')
  })
})
