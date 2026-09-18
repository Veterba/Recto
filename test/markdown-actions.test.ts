import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import * as md from '../src/renderer/editor/markdown-actions'

/** Build a state from text, using | for a cursor and |...| for a selection. */
function make(input: string): EditorState {
  const marks: number[] = []
  let doc = ''
  for (const char of input) {
    if (char === '|') marks.push(doc.length)
    else doc += char
  }
  const selection =
    marks.length >= 2
      ? EditorSelection.single(marks[0]!, marks[1]!)
      : EditorSelection.cursor(marks[0] ?? 0)
  return EditorState.create({ doc, selection })
}

/** Apply a transform and render the result with | marking the selection. */
function apply(state: EditorState, spec: ReturnType<typeof md.toggleBold> | null): string {
  if (!spec) return state.doc.toString()
  const next = state.update(spec).state
  const range = next.selection.main
  const text = next.doc.toString()
  if (range.empty) return text.slice(0, range.head) + '|' + text.slice(range.head)
  return text.slice(0, range.from) + '|' + text.slice(range.from, range.to) + '|' + text.slice(range.to)
}

const plain = (state: EditorState, spec: Parameters<typeof apply>[1]): string =>
  spec ? state.update(spec).state.doc.toString() : state.doc.toString()

describe('headings', () => {
  it('adds a heading prefix to the cursor line', () => {
    const s = make('he|llo')
    expect(plain(s, md.toggleHeading(s, 2))).toBe('## hello')
  })

  it('replaces an existing heading of a different level', () => {
    const s = make('## he|llo')
    expect(plain(s, md.toggleHeading(s, 1))).toBe('# hello')
  })

  it('toggles off when the level already matches', () => {
    const s = make('### he|llo')
    expect(plain(s, md.toggleHeading(s, 3))).toBe('hello')
  })

  it('applies to every line of a multi-line selection', () => {
    const s = make('|one\ntwo\nthree|')
    expect(plain(s, md.toggleHeading(s, 1))).toBe('# one\n# two\n# three')
  })

  it('only toggles off when EVERY selected line already has the prefix', () => {
    const s = make('|# one\ntwo|')
    expect(plain(s, md.toggleHeading(s, 1))).toBe('# one\n# two')
  })

  it('preserves indentation', () => {
    const s = make('    he|llo')
    expect(plain(s, md.toggleHeading(s, 2))).toBe('    ## hello')
  })

  it('replaces a bullet prefix rather than stacking on it', () => {
    const s = make('- he|llo')
    expect(plain(s, md.toggleHeading(s, 2))).toBe('## hello')
  })
})

describe('checklists', () => {
  it('cycles plain -> unchecked -> checked -> plain', () => {
    let s = make('buy mi|lk')
    const one = plain(s, md.toggleChecklist(s))
    expect(one).toBe('- [ ] buy milk')

    s = EditorState.create({ doc: one, selection: EditorSelection.cursor(8) })
    const two = plain(s, md.toggleChecklist(s))
    expect(two).toBe('- [x] buy milk')

    s = EditorState.create({ doc: two, selection: EditorSelection.cursor(8) })
    expect(plain(s, md.toggleChecklist(s))).toBe('buy milk')
  })

  it('converts a bullet into a checklist item', () => {
    const s = make('- buy mi|lk')
    expect(plain(s, md.toggleChecklist(s))).toBe('- [ ] buy milk')
  })

  it('makes a mixed selection uniformly unchecked', () => {
    const s = make('|- [x] done\nplain|')
    expect(plain(s, md.toggleChecklist(s))).toBe('- [ ] done\n- [ ] plain')
  })
})

describe('lists', () => {
  it('numbers each line of a selection', () => {
    const s = make('|a\nb\nc|')
    expect(plain(s, md.toggleNumberedList(s))).toBe('1. a\n2. b\n3. c')
  })

  it('toggles a numbered list off', () => {
    const s = make('|1. a\n2. b|')
    expect(plain(s, md.toggleNumberedList(s))).toBe('a\nb')
  })

  it('bullets and quotes toggle both ways', () => {
    const bulleted = make('he|llo')
    expect(plain(bulleted, md.toggleBulletList(bulleted))).toBe('- hello')
    const quoted = make('> he|llo')
    expect(plain(quoted, md.toggleQuote(quoted))).toBe('hello')
  })
})

describe('inline wrapping', () => {
  it('wraps a selection and keeps it selected', () => {
    const s = make('say |hello| there')
    expect(apply(s, md.toggleBold(s))).toBe('say **|hello|** there')
  })

  it('unwraps when the markers are inside the selection', () => {
    const s = make('say |**hello**| there')
    expect(apply(s, md.toggleBold(s))).toBe('say |hello| there')
  })

  it('unwraps when the markers sit just outside the selection', () => {
    const s = make('say **|hello|** there')
    expect(apply(s, md.toggleBold(s))).toBe('say |hello| there')
  })

  it('puts the cursor between the markers on an empty selection', () => {
    const s = make('say |there')
    expect(apply(s, md.toggleBold(s))).toBe('say **|**there')
  })

  it('handles italic, code, strike and highlight', () => {
    const cases: [string, (s: EditorState) => ReturnType<typeof md.toggleBold>, string][] = [
      ['|x|', md.toggleItalic, '*|x|*'],
      ['|x|', md.toggleInlineCode, '`|x|`'],
      ['|x|', md.toggleStrikethrough, '~~|x|~~'],
      ['|x|', md.toggleHighlight, '==|x|=='],
    ]
    for (const [input, fn, expected] of cases) {
      const s = make(input)
      expect(apply(s, fn(s))).toBe(expected)
    }
  })

  it('does not mistake bold for italic when unwrapping', () => {
    // '**x**' starts and ends with '*', so a naive unwrap would strip one star
    // off each side and leave '*x*'.
    const s = make('|**x**|')
    expect(apply(s, md.toggleItalic(s))).toBe('|*x*|')
  })
})

describe('insertions', () => {
  it('wraps a selection in a link and leaves the cursor in the url', () => {
    const s = make('see |docs| here')
    expect(apply(s, md.insertLink(s))).toBe('see [docs](|) here')
  })

  it('inserts a wikilink with the cursor inside the brackets', () => {
    const s = make('see |')
    expect(apply(s, md.insertWikiLink(s))).toBe('see [[|]]')
  })

  it('keeps selected text as the wikilink target', () => {
    const s = make('|note|')
    expect(plain(s, md.insertWikiLink(s))).toBe('[[note]]')
  })

  it('fences a selection', () => {
    const s = make('|const x = 1|')
    expect(plain(s, md.insertCodeBlock(s))).toBe('```\nconst x = 1\n```\n')
  })

  it('adds a rule on its own line, with the blank the syntax requires', () => {
    // This test used to assert 'text\n---\n', which is a setext H2, not a rule.
    // It was encoding the bug, not catching it.
    const s = make('text|')
    expect(plain(s, md.insertHorizontalRule(s))).toBe('text\n\n---\n')
  })
})

describe('moving lines', () => {
  it('moves a line up', () => {
    const s = make('a\nb|\nc')
    expect(plain(s, md.moveLines(s, -1))).toBe('b\na\nc')
  })

  it('moves a line down', () => {
    const s = make('a|\nb\nc')
    expect(plain(s, md.moveLines(s, 1))).toBe('b\na\nc')
  })

  it('refuses to move past the ends instead of mangling the doc', () => {
    const top = make('a|\nb')
    expect(md.moveLines(top, -1)).toBeNull()
    const bottom = make('a\nb|')
    expect(md.moveLines(bottom, 1)).toBeNull()
  })

  it('moves a multi-line selection as a block', () => {
    const s = make('a\n|b\nc|\nd')
    expect(plain(s, md.moveLines(s, 1))).toBe('a\nd\nb\nc')
  })
})

describe('active formats at the cursor', () => {
  const formats = (input: string): string[] => [...md.activeFormats(make(input))].sort()

  it('reports the heading level of the cursor line', () => {
    expect(formats('## he|ading')).toEqual(['heading-2'])
    expect(formats('###### de|ep')).toEqual(['heading-6'])
    expect(formats('plain |line')).toEqual([])
  })

  it('reports block formats', () => {
    expect(formats('- item|')).toEqual(['bullet'])
    expect(formats('1. item|')).toEqual(['numbered'])
    expect(formats('> quote|')).toEqual(['quote'])
  })

  it('reports a task, not a bullet, for a checklist line', () => {
    // A task line starts with '- ', so a naive check reports both.
    expect(formats('- [ ] item|')).toEqual(['task'])
    expect(formats('- [x] item|')).toEqual(['task'])
  })

  it('reports bold for a wrapped selection', () => {
    expect(formats('say |**hi**| there')).toEqual(['bold'])
    expect(formats('say **|hi|** there')).toEqual(['bold'])
  })

  it('reports bold for a bare cursor inside the markers', () => {
    expect(formats('say **h|i** there')).toEqual(['bold'])
  })

  it('does not report italic inside bold', () => {
    // '**bold**' starts and ends with '*', so the italic check must not fire.
    expect(formats('**b|old**')).toEqual(['bold'])
  })

  it('reports italic, code, strike and highlight', () => {
    expect(formats('*i|t*')).toEqual(['italic'])
    expect(formats('`co|de`')).toEqual(['code'])
    expect(formats('~~go|ne~~')).toEqual(['strikethrough'])
    expect(formats('==li|t==')).toEqual(['highlight'])
  })

  it('combines a block and an inline format', () => {
    expect(formats('## a **b|old** heading')).toEqual(['bold', 'heading-2'])
  })

  it('reports nothing outside any markers', () => {
    expect(formats('**bold** then pl|ain')).toEqual([])
  })

  it('agrees with the toggles: toggling off clears the active format', () => {
    const state = make('say |**hi**| there')
    expect(md.activeFormats(state).has('bold')).toBe(true)
    const next = state.update(md.toggleBold(state)).state
    expect(md.activeFormats(next).has('bold')).toBe(false)
  })
})

describe('horizontal rule', () => {
  it('leaves a blank line above, so the paragraph does not become a heading', () => {
    // `---` directly under text is a setext H2 in CommonMark. Writing it with
    // no gap is why the divider button appeared to do nothing.
    const s = make('some text|')
    expect(plain(s, md.insertHorizontalRule(s))).toBe('some text\n\n---\n')
  })

  it('does not add a gap when the cursor is already on a blank line', () => {
    const s = make('text\n|')
    expect(plain(s, md.insertHorizontalRule(s))).toBe('text\n\n---\n')
  })

  it('separates the rule from the text that follows it', () => {
    const s = make('above|\nbelow')
    expect(plain(s, md.insertHorizontalRule(s))).toBe('above\n\n---\n\nbelow')
  })
})

describe('Tab inside a list', () => {
  it('nests an item under the item above it', () => {
    const s = make('- alpha\n- bet|a\n- gamma')
    expect(plain(s, md.indentListItems(s, 1))).toBe('- alpha\n  - beta\n- gamma')
  })

  it('indents by the sibling\'s content column, not a fixed unit', () => {
    // "1. " is three columns, so its child needs three - two would not nest.
    const s = make('1. alpha\n1. bet|a')
    expect(plain(s, md.indentListItems(s, 1))).toBe('1. alpha\n   1. beta')
  })

  it('still indents the first item, which has nothing to nest under', () => {
    const s = make('- alp|ha\n- beta')
    expect(plain(s, md.indentListItems(s, 1))).toBe('  - alpha\n- beta')
  })

  it('carries the item\'s own children with it', () => {
    const s = make('- alpha\n- bet|a\n  - child\n    text')
    expect(plain(s, md.indentListItems(s, 1))).toBe('- alpha\n  - beta\n    - child\n      text')
  })

  it('outdents back out of its parent', () => {
    const s = make('- alpha\n  - bet|a')
    expect(plain(s, md.indentListItems(s, -1))).toBe('- alpha\n- beta')
  })

  it('does not outdent an item that is already at the margin', () => {
    const s = make('- alp|ha')
    expect(md.indentListItems(s, -1)).toBeNull()
  })

  it('gives a plain line one unit, not the language\'s six spaces', () => {
    const s = make('just a para|graph')
    expect(plain(s, md.indentListItems(s, 1))).toBe('  just a paragraph')
  })

  it('takes a unit back off a plain line', () => {
    const s = make('    inden|ted')
    expect(plain(s, md.indentListItems(s, -1))).toBe('  indented')
  })

  it('has nothing to take off a line at the margin', () => {
    const s = make('at the mar|gin')
    expect(md.indentListItems(s, -1)).toBeNull()
  })

  it('moves every selected item once', () => {
    const s = make('- alpha\n- |beta\n- gamma|')
    expect(plain(s, md.indentListItems(s, 1))).toBe('- alpha\n  - beta\n  - gamma')
  })
})

describe('A newline from an indented blank line', () => {
  it('repeats the indent on ⇧Enter', () => {
    const s = make('- alpha\n    |')
    expect(plain(s, md.newlineFromIndent(s, true))).toBe('- alpha\n    \n    ')
  })

  it('takes one level back on Enter, staying on the line', () => {
    const s = make('- alpha\n    |')
    expect(apply(s, md.newlineFromIndent(s, false))).toBe('- alpha\n  |')
  })

  it('takes the last level back too', () => {
    const s = make('  |')
    expect(apply(s, md.newlineFromIndent(s, false))).toBe('|')
  })

  it('leaves Enter alone once there is no indent left', () => {
    const s = make('|')
    expect(md.newlineFromIndent(s, false)).toBeNull()
  })

  it('puts the cursor at the end of the new indent', () => {
    const s = make('  |')
    expect(apply(s, md.newlineFromIndent(s, true))).toBe('  \n  |')
  })

  it('leaves a line with words on it to the markdown keymap', () => {
    const s = make('  some words|')
    expect(md.newlineFromIndent(s, true)).toBeNull()
  })

  it('leaves an empty list item alone, so bullets still continue', () => {
    const s = make('- |')
    expect(md.newlineFromIndent(s, true)).toBeNull()
  })

  it('does nothing on a line with no indent at all', () => {
    const s = make('|')
    expect(md.newlineFromIndent(s, false)).toBeNull()
  })
})
