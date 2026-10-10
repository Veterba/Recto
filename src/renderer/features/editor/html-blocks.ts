import DOMPurify from 'dompurify'
import { syntaxTree } from '@codemirror/language'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import { type EditorView, WidgetType } from '@codemirror/view'

/**
 * Raw HTML inside notes: the simple, safe part of it rendered, the rest left
 * as source.
 *
 * Notes pasted from the web or another editor carry HTML tables, `<br>`,
 * `<details>`, `<sup>`. Rendered only through DOMPurify with an allowlist:
 * no scripts, no event handlers, no styles, no images, no hrefs - nothing
 * that runs, and nothing that loads from outside. A link keeps its text.
 */

const ALLOWED_TAGS = [
  ...['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col'],
  ...['br', 'details', 'summary', 'sup', 'sub', 'kbd', 'p', 'div', 'span', 'a', 'blockquote', 'hr'],
  ...['strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark', 'small', 'code', 'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd'],
]
const ALLOWED_ATTR = ['colspan', 'rowspan', 'align', 'open']

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false })
}

/**
 * HTML blocks worth rendering, by their first tag. Anything else - `<script>`,
 * `<style>`, an `<iframe>`, a stray `<span>` line - stays as source, which is
 * also what it was before.
 */
const RENDERED_BLOCK = /^\s*<(table|details|div|p|blockquote|ul|ol|dl|sup|sub|kbd|br)\b/i
export const isRenderedHtmlBlock = (source: string): boolean => RENDERED_BLOCK.test(source)

/**
 * Where a `<details>` block ends, as an offset into `after` (the text after
 * its first HTML block): 0 when the block closes itself or is not a
 * `<details>`, -1 when no `</details>` follows. Exported for the tests.
 */
export function detailsEnd(block: string, after: string): number {
  if (!/^\s*<details\b/i.test(block) || /<\/details\s*>/i.test(block)) return 0
  const close = /<\/details\s*>/i.exec(after)
  return close === null ? -1 : close.index + close[0].length
}

/**
 * The markdown between the tags of a `<details>` as paragraphs, so its lines
 * do not run together. Markdown syntax inside stays as written.
 */
export const htmlWithText = (html: string): string =>
  html
    .split(/\n\s*\n/)
    .map((chunk) => (/^\s*</.test(chunk) ? chunk : `<p>${chunk}</p>`))
    .join('\n')

/** An HTML block, rendered. Pressing it shows its source; a `<summary>` opens and closes as usual. */
export class HtmlBlockWidget extends WidgetType {
  constructor(private readonly html: string) {
    super()
  }

  override eq(other: HtmlBlockWidget): boolean {
    return other.html === this.html
  }

  override toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'cm-html-block'
    // The one innerHTML here, and only ever sanitised.
    dom.innerHTML = sanitizeHtml(this.html)
    // Tables get the look and the sideways scroll of a markdown table.
    for (const table of [...dom.querySelectorAll('table')]) {
      table.classList.add('cm-table')
      const wrap = document.createElement('div')
      wrap.className = 'cm-table-wrap'
      const scroll = document.createElement('div')
      scroll.className = 'cm-table-scroll'
      table.replaceWith(wrap)
      wrap.append(scroll)
      scroll.append(table)
    }
    dom.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement).closest('summary') !== null) return
      event.preventDefault()
      view.dispatch({ selection: { anchor: view.posAtDOM(dom) } })
      view.focus()
    })
    // Opening a <details> changes the widget's height; tell the editor.
    dom.addEventListener('toggle', () => view.requestMeasure(), true)
    return dom
  }

  override ignoreEvent(): boolean {
    return false
  }
}

/** `<br>`, `<sup>x</sup>`, `<sub>x</sub>`, `<kbd>x</kbd>` inside a paragraph, rendered in place. */
export class InlineHtmlWidget extends WidgetType {
  constructor(private readonly html: string) {
    super()
  }
  override eq(other: InlineHtmlWidget): boolean {
    return other.html === this.html
  }
  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-html-inline'
    span.innerHTML = sanitizeHtml(this.html)
    return span
  }
}

/** `<br>`, `<sup>`, `<sub>`, `<kbd>` (open or close) as written inline, or null. */
export function inlineTag(source: string): { name: 'sup' | 'sub' | 'kbd' | 'br'; closing: boolean } | null {
  const match = /^<(\/?)(sup|sub|kbd|br)\s*\/?>$/i.exec(source.trim())
  if (match === null) return null
  return { name: match[2]!.toLowerCase() as 'sup' | 'sub' | 'kbd' | 'br', closing: match[1] === '/' }
}

// --- HTML table → markdown --------------------------------------------------

const escapeCell = (text: string): string => text.replace(/\|/g, '\\|')

/** One cell's content as inline markdown, on one line. */
function inlineMarkdown(node: Node): string {
  if (node.nodeType === 3) return escapeCell((node.textContent ?? '').replace(/\s+/g, ' '))
  if (node.nodeType !== 1) return ''
  const el = node as Element
  const inner = (): string => [...el.childNodes].map(inlineMarkdown).join('')
  const wrap = (mark: string): string => {
    const text = inner()
    return text.trim() === '' ? text : `${mark}${text.trim()}${mark}`
  }
  switch (el.tagName.toLowerCase()) {
    case 'strong':
    case 'b':
      return wrap('**')
    case 'em':
    case 'i':
      return wrap('*')
    case 's':
    case 'del':
      return wrap('~~')
    case 'code':
      return `\`${escapeCell((el.textContent ?? '').replace(/\s+/g, ' '))}\``
    case 'br':
      return '<br>'
    case 'sup':
    case 'sub':
    case 'kbd':
      return `<${el.tagName.toLowerCase()}>${inner()}</${el.tagName.toLowerCase()}>`
    case 'a': {
      const text = inner().trim()
      const page = el.getAttribute('data-page-name')
      if (page !== null && page !== '') return text === '' || text === page ? `[[${page}]]` : `[[${page}\\|${text}]]`
      const href = el.getAttribute('href') ?? ''
      return /^https?:\/\//i.test(href) ? `[${text}](${href})` : text
    }
    case 'p':
    case 'div':
    case 'li': {
      // Paragraphs and items inside a cell become lines of it.
      const text = inner().trim()
      return text === '' ? '' : `\u0000${text}\u0000`
    }
    default:
      return inner()
  }
}

function cellMarkdown(cell: Element): string {
  return inlineMarkdown(cell)
    .split('\u0000')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join('<br>')
}

function alignmentOf(cell: Element | undefined): 'left' | 'center' | 'right' | null {
  const raw = (cell?.getAttribute('align') ?? /text-align:\s*(\w+)/i.exec(cell?.getAttribute('style') ?? '')?.[1] ?? '').toLowerCase()
  return raw === 'left' || raw === 'center' || raw === 'right' ? raw : null
}

/**
 * An HTML table as a GFM table: the first row is the header, colspans become
 * empty cells, rowspans are not repeated, pipes are escaped, `<p>`s and
 * `<br>`s inside a cell become `<br>`. Null when there is no table.
 */
export function htmlTableToMarkdown(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table')
  if (table === null) return null
  const rows = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table)
  if (rows.length === 0) return null

  const grid = rows.map((tr) => {
    const out: string[] = []
    for (const cell of [...tr.children].filter((c) => c.tagName === 'TH' || c.tagName === 'TD')) {
      out.push(cellMarkdown(cell))
      const span = Number(cell.getAttribute('colspan') ?? '1')
      for (let i = 1; i < span && i < 50; i++) out.push('')
    }
    return out
  })
  const columns = Math.max(...grid.map((row) => row.length))
  if (columns === 0) return null
  for (const row of grid) while (row.length < columns) row.push('')

  const headerCells = [...rows[0]!.children]
  const align = Array.from({ length: columns }, (_, i) => alignmentOf(headerCells[i]))
  const widths = Array.from({ length: columns }, (_, i) => Math.max(3, ...grid.map((row) => row[i]!.length)))
  const line = (cells: readonly string[]): string => `| ${cells.map((c, i) => c.padEnd(widths[i]!)).join(' | ')} |`
  const rule = widths.map((w, i) => {
    const a = align[i]
    if (a === 'center') return `:${'-'.repeat(w - 2)}:`
    if (a === 'right') return `${'-'.repeat(w - 1)}:`
    if (a === 'left') return `:${'-'.repeat(w - 1)}`
    return '-'.repeat(w)
  })
  return [line(grid[0]!), `| ${rule.join(' | ')} |`, ...grid.slice(1).map(line)].join('\n')
}

/** The "Convert HTML table to Markdown" action: the HTML block under the caret, replaced. */
export function convertHtmlTableAt(state: EditorState): TransactionSpec | null {
  const pos = state.selection.main.head
  let node = syntaxTree(state).resolveInner(pos, -1)
  while (node.parent !== null && node.name !== 'HTMLBlock') node = node.parent
  if (node.name !== 'HTMLBlock') {
    node = syntaxTree(state).resolveInner(pos, 1)
    while (node.parent !== null && node.name !== 'HTMLBlock') node = node.parent
  }
  if (node.name !== 'HTMLBlock') return null
  const markdown = htmlTableToMarkdown(state.sliceDoc(node.from, node.to))
  if (markdown === null) return null
  return {
    changes: { from: node.from, to: node.to, insert: markdown },
    selection: { anchor: node.from },
    userEvent: 'input.convert',
    scrollIntoView: true,
  }
}
