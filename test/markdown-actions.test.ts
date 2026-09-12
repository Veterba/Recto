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

  it('adds a rule on its own line', () => {
    const s = make('text|')
    expect(plain(s, md.insertHorizontalRule(s))).toBe('text\n---\n')
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
