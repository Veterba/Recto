// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { describe, expect, it } from 'vitest'
import {
  HIGHLIGHT_COLOURS,
  highlightCompletion,
  highlightsIn,
  setHighlightColour,
  toggleHighlight,
} from '../../../../src/renderer/features/editor/highlights'
import { renderInline } from '../../../../src/renderer/features/editor/rich-widgets'

/** A state from text, `|` for the caret and `|…|` for a selection. */
function make(input: string): EditorState {
  const marks: number[] = []
  let doc = ''
  for (const char of input) {
    if (char === '|') marks.push(doc.length)
    else doc += char
  }
  return EditorState.create({
    doc,
    selection: marks.length >= 2 ? EditorSelection.single(marks[0]!, marks[1]!) : EditorSelection.cursor(marks[0] ?? 0),
  })
}
const after = (state: EditorState, spec: ReturnType<typeof setHighlightColour>): string => state.update(spec).state.doc.toString()

describe('highlight colours, as Obsidian writes them', () => {
  it('reads each colour, and plain ==text== as the default', () => {
    const line = '==plain== ==🔴red== ==🟠o== ==🟡y== ==🟢g== ==🔵b== ==🟣p=='
    const found = highlightsIn(line)
    expect(found.map((h) => h.colour)).toEqual([null, 'red', 'orange', 'yellow', 'green', 'blue', 'purple'])
    // The text is the part after the emoji.
    expect(found.map((h) => line.slice(h.textFrom, h.textTo))).toEqual(['plain', 'red', 'o', 'y', 'g', 'b', 'p'])
  })

  it('an emoji that is not one of the six is text; an emoji alone is a default highlight of it', () => {
    expect(highlightsIn('==😀 happy==')[0]!.colour).toBe(null)
    const only = highlightsIn('==🔴==')[0]!
    expect(only.colour).toBe(null)
    expect('==🔴=='.slice(only.textFrom, only.textTo)).toBe('🔴')
  })

  it('round trip: highlighting in each colour writes exactly ==<emoji>text==, byte for byte', () => {
    for (const c of HIGHLIGHT_COLOURS) {
      const s = make('a |word| b')
      const out = after(s, setHighlightColour(s, c.id))
      expect(out).toBe(`a ==${c.emoji}word== b`)
      expect(Buffer.from(out, 'utf8').equals(Buffer.from(`a ==${c.emoji}word== b`, 'utf8'))).toBe(true)
      // And read back as that colour.
      expect(highlightsIn(out)[0]!.colour).toBe(c.id)
    }
  })

  it('changing a colour rewrites only the emoji', () => {
    const s = make('Note ==🔴ca|rd== end')
    expect(after(s, setHighlightColour(s, 'blue'))).toBe('Note ==🔵card== end')
    expect(after(s, setHighlightColour(s, null))).toBe('Note ==card== end')
    const plain = make('==ca|rd==')
    expect(after(plain, setHighlightColour(plain, 'green'))).toBe('==🟢card==')
  })

  it('the toggle takes a highlight away whatever its colour, and adds a default one elsewhere', () => {
    const coloured = make('x ==🟣so|me== y')
    expect(after(coloured, toggleHighlight(coloured))).toBe('x some y')
    const none = make('x |some| y')
    expect(after(none, toggleHighlight(none))).toBe('x ==some== y')
  })

  it('typing == to open a highlight offers the six colours; a closing == does not', () => {
    const at = (doc: string): ReturnType<typeof highlightCompletion> => {
      const state = EditorState.create({ doc })
      return highlightCompletion(new CompletionContext(state, doc.length, false))
    }
    expect(at('Read ==')?.options.map((o) => o.apply)).toEqual(HIGHLIGHT_COLOURS.map((c) => c.emoji))
    expect(at('Read ==this==')).toBe(null)
    expect(at('a ===')).toBe(null)
  })

  it('a table cell or a reading window shows the colour without the emoji', () => {
    const el = document.createElement('div')
    renderInline('a ==🟢go== b', el)
    const mark = el.querySelector('mark')!
    expect(mark.className).toBe('cm-highlight cm-highlight--green')
    expect(mark.textContent).toBe('go')
  })
})
