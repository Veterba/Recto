// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  convertHtmlTableAt,
  detailsEnd,
  htmlTableToMarkdown,
  htmlWithText,
  inlineTag,
  isRenderedHtmlBlock,
  sanitizeHtml,
} from '../../../../src/renderer/features/editor/html-blocks'
import { recordFold } from '../../../../src/renderer/features/editor/code-editor'

/** The shape of the tables pasted into "Recto decisions" from another editor. */
const PASTED =
  '<table class="border-collapse w-full" style="min-width: 75px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody>' +
  '<tr><th dir="auto" colspan="1" rowspan="1"><p>Layer</p></th><th dir="auto"><p>Choice</p></th><th dir="auto"><p>Instead of</p></th></tr>' +
  '<tr><td><p>Shell</p></td><td><p><strong>Electron 38</strong> (Node 22)</p></td><td><p>Tauri — halves the binary</p></td></tr>' +
  '<tr><td><p>Language</p></td><td><p><strong>TypeScript strict</strong></p></td><td><p>— the IPC contract is a shared <code>.d.ts</code></p></td></tr>' +
  '<tr><td><p>Slugs (<a data-page-name="14-cabinet-findings" data-wiki-link="true" href="#page:14-cabinet-findings" class="wiki-link">14-cabinet-findings</a> #2)</p></td><td><p>a | b</p><p>second line</p></td><td><p><em>x</em></p></td></tr>' +
  '</tbody></table>'

describe('sanitising HTML in notes', () => {
  it('keeps the simple tags', () => {
    const out = sanitizeHtml('<details open><summary>More</summary>x<br>y<sup>2</sup><sub>i</sub><kbd>⌘</kbd></details>')
    expect(out).toBe('<details open=""><summary>More</summary>x<br>y<sup>2</sup><sub>i</sub><kbd>⌘</kbd></details>')
    expect(sanitizeHtml('<table><tr><td colspan="2">a</td></tr></table>')).toContain('colspan="2"')
  })

  it('drops scripts, handlers, styles, external loads and hrefs', () => {
    const out = sanitizeHtml(
      '<script>alert(1)</script><img src="https://x.test/p.png" onerror="alert(2)"><p style="color:red" onclick="alert(3)">t</p>' +
        '<a href="javascript:alert(4)">j</a><a href="https://x.test">ext</a><iframe src="https://x.test"></iframe><style>*{}</style><link rel="stylesheet" href="https://x.test/a.css">',
    )
    expect(out).toBe('<p>t</p><a>j</a><a>ext</a>')
  })

  it('renders only blocks that start with a simple tag', () => {
    expect(isRenderedHtmlBlock(PASTED)).toBe(true)
    expect(isRenderedHtmlBlock('<details>\n<summary>a</summary>\n</details>')).toBe(true)
    expect(isRenderedHtmlBlock('<script>x</script>')).toBe(false)
    expect(isRenderedHtmlBlock('<iframe src="x"></iframe>')).toBe(false)
  })

  it('takes a <details> with blank lines inside as one block, up to its </details>', () => {
    const after = '\n\nPress <kbd>F</kbd>.\n\n</details>\n\nAfter.'
    expect(detailsEnd('<details open>\n<summary>Keys</summary>', after)).toBe(after.indexOf('</details>') + '</details>'.length)
    expect(detailsEnd('<details><summary>a</summary>b</details>', '')).toBe(0)
    expect(detailsEnd('<table></table>', '')).toBe(0)
    expect(detailsEnd('<details>', 'never closed')).toBe(-1)
    expect(htmlWithText('<details>\n<summary>K</summary>\n\nPress <kbd>F</kbd>.\n\n</details>')).toBe(
      '<details>\n<summary>K</summary>\n<p>Press <kbd>F</kbd>.</p>\n</details>',
    )
  })

  it('recognises the inline tags', () => {
    expect(inlineTag('<br>')).toEqual({ name: 'br', closing: false })
    expect(inlineTag('<br />')).toEqual({ name: 'br', closing: false })
    expect(inlineTag('</SUP>')).toEqual({ name: 'sup', closing: true })
    expect(inlineTag('<span>')).toBeNull()
  })
})

describe('HTML table to markdown', () => {
  it('converts a pasted table: header row, bold, code, wiki links, escaped pipes, paragraphs as <br>', () => {
    expect(htmlTableToMarkdown(PASTED)).toBe(
      [
        '| Layer                              | Choice                    | Instead of                             |',
        '| ---------------------------------- | ------------------------- | -------------------------------------- |',
        '| Shell                              | **Electron 38** (Node 22) | Tauri — halves the binary              |',
        '| Language                           | **TypeScript strict**     | — the IPC contract is a shared `.d.ts` |',
        '| Slugs ([[14-cabinet-findings]] #2) | a \\| b<br>second line     | *x*                                    |',
      ].join('\n'),
    )
  })

  it('fills colspans with empty cells and keeps alignment', () => {
    const md = htmlTableToMarkdown(
      '<table><tr><th align="right">n</th><th align="center">c</th></tr><tr><td colspan="2">wide</td></tr></table>',
    )
    expect(md).toBe(['| n    | c   |', '| ---: | :-: |', '| wide |     |'].join('\n'))
  })

  it('returns null when there is no table', () => {
    expect(htmlTableToMarkdown('<p>no</p>')).toBeNull()
  })

  it('replaces the HTML block under the caret, as one change', () => {
    const doc = `# Note\n\n${PASTED}\n\nAfter.\n`
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.indexOf('<table') + 5 },
      extensions: [markdown({ base: markdownLanguage })],
    })
    ensureSyntaxTree(state, state.doc.length, 5000)
    const spec = convertHtmlTableAt(state)
    expect(spec).not.toBeNull()
    const next = state.update(spec!).state.doc.toString()
    expect(next.startsWith('# Note\n\n| Layer')).toBe(true)
    expect(next.endsWith('|\n\nAfter.\n')).toBe(true)
    expect(next).not.toContain('<table')
  })

  it('does nothing outside an HTML block', () => {
    const state = EditorState.create({ doc: 'Just text.', extensions: [markdown({ base: markdownLanguage })] })
    ensureSyntaxTree(state, state.doc.length, 5000)
    expect(convertHtmlTableAt(state)).toBeNull()
  })
})

describe('JSON Lines folding', () => {
  it('folds a record to {…} on its own line, and leaves short ones alone', () => {
    const line = '{"id": 1, "name": "a long enough record", "tags": ["x"]}'
    expect(recordFold(line)).toEqual({ from: 1, to: line.length - 1 })
    expect(recordFold('{"a": 1}')).toBeNull()
    expect(recordFold('')).toBeNull()
  })
})
