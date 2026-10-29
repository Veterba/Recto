// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { blockHiding } from '../../../../src/renderer/features/editor/block-hiding'
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
})
