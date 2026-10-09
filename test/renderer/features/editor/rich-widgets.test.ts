import { describe, expect, it } from 'vitest'
import { mathSource, stripContainers } from '../../../../src/renderer/features/editor/rich-widgets'
import { calloutGroup } from '../../../../src/renderer/features/editor/callout-widget'
import { cellKind, numericColumn, parseTable, splitRow, visibleText } from '../../../../src/renderer/features/editor/table-widget'

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

describe('pipes inside wikilinks', () => {
  it('never split a cell, escaped or not', () => {
    expect(splitRow('| [[Recto log/2026-10-03 — v0.43.0|v0.43.0]] | 87% |')).toEqual(['[[Recto log/2026-10-03 — v0.43.0|v0.43.0]]', '87%'])
    expect(splitRow('| [[a/b\\|report]] | x |')).toEqual(['[[a/b|report]]', 'x'])
    expect(splitRow('| [[x]] | y | [[p|q]] |')).toEqual(['[[x]]', 'y', '[[p|q]]'])
  })

  it('a stray [[ without its ]] is no link: the row splits as usual', () => {
    expect(splitRow('| a [[b | c |')).toEqual(['a [[b', 'c'])
  })
})

describe('how cells wrap', () => {
  it('never wraps short values: dates, numbers, shares, durations, model names', () => {
    for (const v of ['2026-10-03 13:29', '33/38 (87%)', '10.2 s', '7.3 tokens/s', 'qwen3.5:9b', '—', '96%'])
      expect(cellKind(v), v).toBe('nowrap')
  })

  it('wraps text at spaces, and lets a long path break as a last resort', () => {
    expect(cellKind('Stage 3 start: the baseline again with daily notes')).toBe('text')
    expect(cellKind('[[Programming/Projects/Recto app/Evals Qwen/qwen3.5-9b/report|report]]')).toBe('nowrap')
    expect(cellKind('docs/evals/2026-10-03-12-19-baseline-v2/report.md')).toBe('long')
  })

  it('reads links by their label', () => {
    expect(visibleText('[[a/b|report]] and [site](https://x.y) **bold**')).toBe('report and site bold')
  })

  it('finds numeric columns', () => {
    const rows = [
      ['a', '87%'],
      ['b', '10.2 s'],
      ['c', '—'],
    ]
    expect(numericColumn(rows, 1)).toBe(true)
    expect(numericColumn(rows, 0)).toBe(false)
    expect(numericColumn([['2026-10-03 19:49'], ['2026-10-03 18:44']], 0)).toBe(false)
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
