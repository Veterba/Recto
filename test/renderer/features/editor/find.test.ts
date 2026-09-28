import { describe, expect, it } from 'vitest'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'
import { SearchQuery, replaceAll, search, setSearchQuery } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'
import { FIND_BINDINGS, countLabel, countMatches, firstMatchFrom, markerFractions } from '../../../../src/renderer/features/editor/find'
import { CommandRegistry } from '../../../../src/renderer/app/commands'
import { registerEditorCommands } from '../../../../src/renderer/features/editor/editor-commands'
import { normalizeChord } from '../../../../src/renderer/app/hotkeys'

const q = (search: string, spec: Partial<ConstructorParameters<typeof SearchQuery>[0]> = {}): SearchQuery =>
  new SearchQuery({ search, literal: true, ...spec })
const at = (doc: string, anchor = 0, head = anchor): EditorState => EditorState.create({ doc, selection: { anchor, head } })

describe('find: counting matches', () => {
  it('counts every match and knows which one is selected', () => {
    const doc = 'cat, Cat, concat, cat'
    expect(countMatches(at(doc), q('cat'))).toEqual({ total: 4, current: null, capped: false })
    expect(countMatches(at(doc, 18, 21), q('cat'))).toEqual({ total: 4, current: 4, capped: false })
  })

  it('honours match case, whole word and regex', () => {
    const doc = 'cat, Cat, concat, cat'
    expect(countMatches(at(doc), q('cat', { caseSensitive: false })).total).toBe(4)
    expect(countMatches(at(doc), q('Cat', { caseSensitive: true })).total).toBe(1)
    expect(countMatches(at(doc), q('cat', { wholeWord: true })).total).toBe(3)
    expect(countMatches(at(doc), q('cat', { wholeWord: true, caseSensitive: true })).total).toBe(2)
    expect(countMatches(at(doc), q('c[a-z]*t', { regexp: true })).total).toBe(4)
  })

  it('is literal outside regex mode', () => {
    expect(countMatches(at('a.b axb \\n'), q('a.b')).total).toBe(1)
    expect(countMatches(at('line\\none'), q('\\n')).total).toBe(1)
  })

  it('stops counting at the limit', () => {
    expect(countMatches(at('x'.repeat(50)), q('x'), 10)).toEqual({ total: 10, current: null, capped: true })
  })

  it('an empty or broken query matches nothing', () => {
    expect(countMatches(at('abc'), q('')).total).toBe(0)
    expect(countMatches(at('abc'), q('(', { regexp: true })).total).toBe(0)
  })

  it('labels the count as n / N', () => {
    const label = (state: EditorState, query: SearchQuery): string => countLabel(countMatches(state, query), query)
    expect(label(at('a b a'), q(''))).toBe('')
    expect(label(at('a b a'), q('z'))).toBe('0 / 0')
    expect(label(at('a b a'), q('('))).toBe('0 / 0')
    expect(label(at('a b a'), q('(', { regexp: true }))).toBe('Invalid')
    expect(label(at('a b a'), q('a'))).toBe('– / 2')
    expect(label(at('a b a', 4, 5), q('a'))).toBe('2 / 2')
    expect(countLabel({ total: 1000, current: 3, capped: true }, q('a'))).toBe('3 / 1000+')
  })
})

describe('find: live search', () => {
  it('finds the first match from the caret, wrapping to the top', () => {
    const state = at('one two one two')
    expect(firstMatchFrom(state, q('two'), 0)).toEqual({ from: 4, to: 7 })
    expect(firstMatchFrom(state, q('two'), 5)).toEqual({ from: 12, to: 15 })
    expect(firstMatchFrom(state, q('one'), 9)).toEqual({ from: 0, to: 3 })
    expect(firstMatchFrom(state, q('three'), 0)).toBeNull()
  })

  it('keeps the match it is on as the query grows', () => {
    // Typing "t", then "tw": the search starts from the current match.
    const state = at('tea two')
    const first = firstMatchFrom(state, q('t'), 0)!
    expect(first).toEqual({ from: 0, to: 1 })
    expect(firstMatchFrom(state, q('tw'), first.from)).toEqual({ from: 4, to: 6 })
  })
})

describe('find: scrollbar ticks', () => {
  it('places ticks by position in the scrolled content', () => {
    expect(markerFractions([0, 500], 100, 1000, 500)).toEqual([0.1, 0.6])
  })

  it('merges ticks that land on the same pixel row and clamps', () => {
    expect(markerFractions([0, 0.1, 2000], 0, 1000, 100)).toEqual([0, 1])
    expect(markerFractions([10], 0, 0, 100)).toEqual([])
  })
})

describe('find: replace all', () => {
  it('is a single undo step', () => {
    let state = EditorState.create({ doc: 'cat and cat and cat', extensions: [history(), search()] })
    const view = {
      get state() {
        return state
      },
      dispatch: (...specs: TransactionSpec[]) => {
        state = state.update(...specs).state
      },
    } as unknown as EditorView
    view.dispatch({ effects: setSearchQuery.of(q('cat', { replace: 'dog' })) })
    expect(replaceAll(view)).toBe(true)
    expect(state.doc.toString()).toBe('dog and dog and dog')
    undo(view)
    expect(state.doc.toString()).toBe('cat and cat and cat')
  })
})

describe('find: keys', () => {
  it('⌘F and ⌘⌥F are registry commands, scoped to the editor', () => {
    const registry = new CommandRegistry()
    registerEditorCommands(registry, () => {})
    expect(registry.bindingFor('editor:find')).toBe('Mod+F')
    expect(registry.bindingFor('editor:replace')).toBe('Mod+Alt+F')
    expect(registry.get('editor:find')?.scope).toBe('editor')
    expect(registry.get('editor:replace')?.scope).toBe('editor')
    expect(normalizeChord('Mod+Alt+F', true)).toBe('alt+meta+f')
  })

  it('the editor keymap leaves ⌘F, ⌘⌥F, ⌘G, ⇧⌘G and ⇧⌘L to the app', () => {
    const keys = FIND_BINDINGS.map((b) => b.key)
    for (const taken of ['Mod-f', 'Mod-Alt-f', 'Mod-g', 'Shift-Mod-g', 'Mod-Shift-g', 'Mod-Shift-l']) {
      expect(keys).not.toContain(taken)
    }
    const g = FIND_BINDINGS.find((b) => b.key === 'Mod-g')
    expect(g).toBeUndefined()
    expect(keys).toContain('Escape')
    expect(keys).toContain('F3')
  })
})
