import { describe, expect, it } from 'vitest'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { foldRangeAt } from '../src/renderer/editor/structure'
import { obsidianSyntax } from '../src/renderer/editor/obsidian-syntax'

const state = (doc: string): EditorState => {
  const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [obsidianSyntax] })] })
  ensureSyntaxTree(s, s.doc.length, 5000)
  return s
}

/** The text a fold at this line would hide. */
const hidden = (doc: string, line: number): string | null => {
  const s = state(doc)
  const range = foldRangeAt(s, line)
  return range === null ? null : s.doc.sliceString(range.from, range.to)
}

describe('foldRangeAt', () => {
  it('folds a heading down to the next heading of the same level', () => {
    const doc = '# A\ntext\n## A.1\nmore\n\n# B\nend'
    expect(hidden(doc, 1)).toBe('\ntext\n## A.1\nmore')
  })

  it('folds a sub-heading only to the next heading at its level or above', () => {
    const doc = '# A\n## A.1\none\n## A.2\ntwo\n# B'
    expect(hidden(doc, 2)).toBe('\none')
  })

  it('folds the last section to the end of the note, without trailing blank lines', () => {
    expect(hidden('# A\nbody\n\n\n', 1)).toBe('\nbody')
  })

  it('has nothing to fold under an empty heading', () => {
    expect(hidden('# A\n# B\n', 1)).toBeNull()
    expect(hidden('# A\n\n# B\n', 1)).toBeNull()
  })

  it('folds a list item with nested items', () => {
    const doc = '- one\n  - one.a\n  - one.b\n- two'
    expect(hidden(doc, 1)).toBe('\n  - one.a\n  - one.b')
    expect(hidden(doc, 2)).toBeNull()
    expect(hidden(doc, 4)).toBeNull()
  })

  it('folds a nested item that has its own children', () => {
    const doc = '- one\n  - one.a\n    - deep\n  - one.b'
    expect(hidden(doc, 2)).toBe('\n    - deep')
  })

  it('does not treat a # inside a code block as a heading', () => {
    const doc = '```bash\n# comment\necho\n```'
    expect(hidden(doc, 2)).toBeNull()
  })

  it('ignores plain paragraphs', () => {
    expect(hidden('para\nmore\n', 1)).toBeNull()
  })
})
