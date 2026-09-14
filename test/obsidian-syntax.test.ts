import { describe, expect, it } from 'vitest'
import { parser as base, GFM } from '@lezer/markdown'
import { obsidianSyntax } from '../src/renderer/editor/obsidian-syntax'

const parser = base.configure([GFM, obsidianSyntax])

/** Every node as `Name:text`, for the nodes a test cares about. */
function nodes(doc: string, names: readonly string[]): string[] {
  const out: string[] = []
  parser.parse(doc).iterate({
    enter: (node) => {
      if (names.includes(node.name)) out.push(`${node.name}:${doc.slice(node.from, node.to)}`)
    },
  })
  return out
}

describe('math blocks', () => {
  it('parses a multi-line $$ block as one node', () => {
    const doc = '$$\n0.25 = \\frac{25}{100}\n$$'
    expect(nodes(doc, ['MathBlock'])).toEqual([`MathBlock:${doc}`])
  })

  /**
   * The bug that made this file necessary: with no idea that `$$` opens a
   * block, the text above a later `---` became a setext H2.
   */
  it('does not let a later --- turn the text and formulas into a heading', () => {
    const doc = ['*Как переводить дроби*', '$$', '0.25 = \\frac{1}{4}', '$$', '$$', '0.5 = \\frac{1}{2}', '$$', '---'].join('\n')
    expect(nodes(doc, ['SetextHeading2'])).toEqual([])
    expect(nodes(doc, ['MathBlock'])).toHaveLength(2)
    expect(nodes(doc, ['HorizontalRule'])).toEqual(['HorizontalRule:---'])
  })

  it('ends a paragraph without a blank line', () => {
    const doc = 'Text right above\n$$\nx\n$$'
    expect(nodes(doc, ['Paragraph'])).toEqual(['Paragraph:Text right above'])
    expect(nodes(doc, ['MathBlock'])).toHaveLength(1)
  })

  it('tolerates trailing spaces after the fences, as Obsidian writes them', () => {
    expect(nodes('$$  \n6x-4=-3x+2  \n$$', ['MathBlock'])).toHaveLength(1)
  })

  it('parses a block inside a list item', () => {
    const doc = '- item\n\n    $$\n    x^2\n    $$'
    expect(nodes(doc, ['MathBlock'])).toHaveLength(1)
  })

  it('runs an unterminated block to the end instead of breaking the rest', () => {
    expect(nodes('$$\nstill typing', ['MathBlock'])).toEqual(['MathBlock:$$\nstill typing'])
  })
})

describe('inline math', () => {
  it('parses $…$', () => {
    expect(nodes('a $\\frac{a}{b}$ b', ['InlineMath'])).toEqual(['InlineMath:$\\frac{a}{b}$'])
  })

  /** One line, three display formulas - common in Obsidian notes. */
  it('parses several $$…$$ on one line as separate formulas, not a block', () => {
    const doc = '$$3x=12$$ $$x=4$$ $$y=1$$'
    expect(nodes(doc, ['InlineMath'])).toEqual(['InlineMath:$$3x=12$$', 'InlineMath:$$x=4$$', 'InlineMath:$$y=1$$'])
    expect(nodes(doc, ['MathBlock'])).toEqual([])
  })

  it('does not take underscores and stars inside a formula for emphasis', () => {
    const doc = '$x_1 * y_2 * z_3$'
    expect(nodes(doc, ['Emphasis', 'StrongEmphasis'])).toEqual([])
    expect(nodes(doc, ['InlineMath'])).toEqual([`InlineMath:${doc}`])
  })

  it('leaves prices alone', () => {
    expect(nodes('costs $5 and $10 today', ['InlineMath'])).toEqual([])
  })

  it('does not open on an escaped dollar', () => {
    expect(nodes('a \\$x$ b', ['InlineMath'])).toEqual([])
  })

  it('parses math inside a table cell', () => {
    const doc = '| Form | Eq |\n| --- | --- |\n| Slope | $y=mx+b$ |'
    expect(nodes(doc, ['InlineMath'])).toEqual(['InlineMath:$y=mx+b$'])
    expect(nodes(doc, ['Table']).length).toBe(1)
  })

  it('parses math inside a blockquote with a list', () => {
    expect(nodes('> - $a$ → b', ['InlineMath'])).toEqual(['InlineMath:$a$'])
  })
})

describe('comments', () => {
  it('parses an inline %% comment %%', () => {
    expect(nodes('text %%hidden%% more', ['Comment'])).toEqual(['Comment:%%hidden%%'])
  })

  it('parses a multi-line comment block', () => {
    expect(nodes('%%\nsecret\nstuff\n%%', ['CommentBlock'])).toEqual(['CommentBlock:%%\nsecret\nstuff\n%%'])
  })
})

describe('footnotes', () => {
  it('parses a reference', () => {
    expect(nodes('A claim.[^1]', ['FootnoteRef'])).toEqual(['FootnoteRef:[^1]'])
  })

  it('is not a link', () => {
    expect(nodes('A claim.[^note]', ['Link'])).toEqual([])
  })
})
