// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { blockHiding, propertiesSlot } from '../../../../src/renderer/features/editor/block-hiding'
import { livePreviewEnabled, setLivePreview } from '../../../../src/renderer/features/editor/live-preview-state'

/** Which lines Live Preview hides as blocks, and that switching it off shows them again at once. */

const DOC = ['```js', 'let a = 1', '```', '', '```not a fence``` but a sentence', '', 'End.'].join('\n')

function hidden(state: EditorState): string[] {
  const out: string[] = []
  state.field(blockHiding).between(0, state.doc.length, (from, to) => {
    out.push(state.doc.sliceString(from, to))
  })
  return out
}

const open = (): EditorState => {
  const state = EditorState.create({
    doc: DOC,
    selection: { anchor: DOC.length },
    extensions: [markdown(), livePreviewEnabled, blockHiding],
  })
  // A first transaction computes the field, as opening a note does.
  return state.update({ selection: { anchor: DOC.length } }).state
}

describe('block hiding', () => {
  it('hides the fence lines of a code block, and not a sentence that starts with backticks', () => {
    expect(hidden(open())).toEqual(['```js', '```'])
  })

  it('shows everything again as soon as Live Preview is switched off', () => {
    const state = open().update({ effects: setLivePreview.of(false) }).state
    expect(hidden(state)).toEqual([])
  })

  it('draws the properties in place of the frontmatter, and gives the raw YAML back when the cursor goes in', () => {
    const doc = '---\nstatus: active\n---\nBody.'
    const slot = document.createElement('div')
    const at = (anchor: number): EditorState =>
      EditorState.create({
        doc,
        selection: { anchor },
        extensions: [markdown(), livePreviewEnabled, propertiesSlot.of(slot), blockHiding],
      }).update({
        selection: { anchor },
      }).state
    const widgets: (HTMLElement | null)[] = []
    at(doc.length)
      .field(blockHiding)
      .between(0, doc.length, (_from, _to, deco) => {
        widgets.push((deco.spec as { widget?: { slot: HTMLElement } }).widget?.slot ?? null)
      })
    expect(widgets).toEqual([slot])
    expect(hidden(at(5))).toEqual([])
  })

  it('offers "Add property" above the first line of a note with none, but not in a read-only view', () => {
    const doc = 'Body.'
    const slot = document.createElement('div')
    const empties = (readOnly: boolean): boolean[] => {
      const state = EditorState.create({
        doc,
        extensions: [markdown(), livePreviewEnabled, propertiesSlot.of(slot), EditorView.editable.of(!readOnly), blockHiding],
      }).update({ selection: { anchor: 0 } }).state
      const out: boolean[] = []
      state.field(blockHiding).between(0, doc.length, (_from, _to, deco) => {
        out.push((deco.spec as { widget?: { empty: boolean } }).widget?.empty ?? false)
      })
      return out
    }
    expect(empties(false)).toEqual([true])
    expect(empties(true)).toEqual([])
  })
})
