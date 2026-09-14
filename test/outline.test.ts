import { describe, expect, it } from 'vitest'
import { currentSection, outlineOf } from '../src/renderer/core/outline'

describe('outlineOf', () => {
  it('lists headings with level and line', () => {
    expect(outlineOf('# One\ntext\n## Two\n### Three')).toEqual([
      { level: 1, text: 'One', line: 1 },
      { level: 2, text: 'Two', line: 3 },
      { level: 3, text: 'Three', line: 4 },
    ])
  })

  it('skips frontmatter, code fences and maths blocks', () => {
    const doc = ['---', 'title: x', '# not', '---', '```', '# code', '```', '$$', '# maths', '$$', '## Real'].join('\n')
    expect(outlineOf(doc)).toEqual([{ level: 2, text: 'Real', line: 11 }])
  })

  it('shows what a reader sees, not the markup', () => {
    expect(outlineOf('# **Bold** and [[Note|alias]] `code` [link](x)')[0]?.text).toBe('Bold and alias code link')
  })

  it('needs a space after the hashes, like the editor does', () => {
    expect(outlineOf('#tag\n####### seven')).toEqual([])
  })

  it('drops closing hashes', () => {
    expect(outlineOf('## Title ##')[0]?.text).toBe('Title')
  })
})

describe('currentSection', () => {
  const items = outlineOf('# A\n\n## B\n\n# C')
  it('finds the heading above the caret', () => {
    expect(currentSection(items, 1)).toBe(0)
    expect(currentSection(items, 4)).toBe(1)
    expect(currentSection(items, 99)).toBe(2)
  })
  it('is -1 above the first heading', () => {
    expect(currentSection(outlineOf('intro\n# A'), 1)).toBe(-1)
  })
})
