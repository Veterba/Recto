// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createEditor } from '../../../../src/renderer/features/editor/codemirror'
import { createCodeEditor } from '../../../../src/renderer/features/editor/code-editor'

/** CodeMirror keeps `\n` inside; a CRLF note opened and closed untouched must come back byte for byte. */

const CRLF = '---\r\ntags: [a]\r\n---\r\n# Plan\r\n\r\nText.\r\n'
const destroy: (() => void)[] = []
afterEach(() => {
  for (const d of destroy.splice(0)) d()
})

describe('editors and line endings', () => {
  it('the note editor hands a CRLF note back CRLF, typed into or not', () => {
    const changes: string[] = []
    const handle = createEditor(document.createElement('div'), {
      doc: CRLF,
      onChange: (v) => changes.push(v),
      onSave: () => undefined,
      onOpenLink: () => undefined,
    })
    destroy.push(() => handle.destroy())
    expect(handle.getValue()).toBe(CRLF)
    handle.setValue(CRLF.replace('Text.', 'More text.'))
    expect(handle.getValue()).toBe(CRLF.replace('Text.', 'More text.'))
    expect(changes.at(-1)).toBe(CRLF.replace('Text.', 'More text.'))
  })

  it('the code editor does the same', () => {
    const handle = createCodeEditor(document.createElement('div'), {
      doc: 'a\r\nb\r\n',
      path: 'x.txt',
      readOnly: false,
      onChange: () => undefined,
    })
    destroy.push(() => handle.destroy())
    expect(handle.getValue()).toBe('a\r\nb\r\n')
  })
})
