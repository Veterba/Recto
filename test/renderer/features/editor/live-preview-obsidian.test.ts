// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { ensureSyntaxTree } from '@codemirror/language'
import { livePreview } from '../../../../src/renderer/features/editor/live-preview'
import { noSetextHeadings, obsidianSyntax } from '../../../../src/renderer/features/editor/obsidian-syntax'

/** Live Preview draws tasks and maths the way Obsidian does. */

function view(doc: string): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const state = EditorState.create({
    doc,
    // The caret on the last, empty line: every other line is drawn, not shown as source.
    selection: { anchor: doc.length },
    extensions: [markdown({ base: markdownLanguage, extensions: [obsidianSyntax, noSetextHeadings] }), livePreview(() => new Set())],
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  const v = new EditorView({ state, parent })
  // Redraw once the tree is complete, as the editor does when parsing finishes.
  v.dispatch({ selection: { anchor: doc.length } })
  return v
}

const line = (v: EditorView, n: number): HTMLElement => v.contentDOM.querySelectorAll<HTMLElement>('.cm-line')[n]!

describe('Live Preview, as Obsidian draws it', () => {
  it('a task shows only its checkbox; a plain item keeps its bullet', () => {
    const v = view('- [ ] open task\n- [x] done task\n- plain item\n')
    expect(line(v, 0).querySelector('.cm-task-checkbox')).not.toBeNull()
    expect(line(v, 0).querySelector('.cm-bullet')).toBeNull()
    expect(line(v, 1).querySelector('.cm-bullet')).toBeNull()
    expect(line(v, 2).querySelector('.cm-bullet')).not.toBeNull()
    v.destroy()
  })

  it('code is shown as written: no checkbox, link or embed in a fence, no link or maths in inline code', () => {
    const v = view('```md\n- [ ] not a task\n[[not a link]] ![[nor an embed]]\n```\nInline `[[x]]` and `$y$` here.\nA real [[Link]].\n')
    const text = v.contentDOM
    expect(text.querySelectorAll('.cm-task-checkbox')).toHaveLength(0)
    // The one link drawn is the real one, outside the code.
    expect([...text.querySelectorAll('.cm-wikilink')].map((l) => l.textContent)).toEqual(['Link'])
    expect(text.querySelector('.cm-embed')).toBeNull()
    expect(line(v, 4).querySelector('.cm-math')).toBeNull()
    v.destroy()
  })

  it('`$$…$$` alone on its line is a centred formula; inside a sentence it stays in the line', () => {
    const v = view('$$e^{i\\pi} + 1 = 0$$\nSo $$a^2$$ holds.\n')
    expect(line(v, 0).querySelector('.cm-math-block')).not.toBeNull()
    expect(line(v, 1).querySelector('.cm-math-block')).toBeNull()
    expect(line(v, 1).querySelector('.cm-math-display')).not.toBeNull()
    v.destroy()
  })
})
