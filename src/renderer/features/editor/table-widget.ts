/**
 * Markdown tables, parsed and drawn as a table while the cursor is elsewhere.
 */

import { ViewPlugin, WidgetType, type EditorView } from '@codemirror/view'
import { renderInline, revealOnPress } from './rich-widgets'

/**
 * Split one table row into cells.
 *
 * A pipe inside `$…$` or backticks is part of the cell - `$|x|$` is an
 * absolute value, not two columns - and `\|` is an escaped pipe. So is a pipe
 * inside `[[…]]`: `[[path|alias]]` is one link, written with `\|` or without.
 * Outer pipes are optional in GFM and dropped.
 */
export function splitRow(line: string, links = true): string[] {
  const cells: string[] = []
  let current = ''
  let inMath = false
  let inCode = false
  let inLink = false
  const text = line.trim()
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (char === '\\' && text[i + 1] === '|') {
      current += '|'
      i++
      continue
    }
    if (links && !inMath && !inCode && char === '[' && text[i + 1] === '[') inLink = true
    if (inLink && char === ']' && text[i + 1] === ']') inLink = false
    if (char === '`' && !inMath && !inLink) inCode = !inCode
    if (char === '$' && !inCode && !inLink) inMath = !inMath
    if (char === '|' && !inMath && !inCode && !inLink) {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  // A `[[` that never closes is not a link: split the row as if it weren't there.
  if (inLink) return splitRow(line, false)
  cells.push(current)
  if (text.startsWith('|')) cells.shift()
  if (text.endsWith('|') && !text.endsWith('\\|')) cells.pop()
  return cells.map((cell) => cell.trim())
}

type ParsedTable = {
  head: string[]
  align: ('left' | 'center' | 'right' | null)[]
  rows: string[][]
}

export function parseTable(text: string): ParsedTable | null {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  if (lines.length < 2) return null
  const head = splitRow(lines[0]!)
  const align = splitRow(lines[1]!).map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null
  })
  const rows = lines.slice(2).map((line) => splitRow(line))
  return { head, align, rows }
}

/** The text a cell shows: links by their label, markup dropped. For measuring, not for drawing. */
export function visibleText(cell: string): string {
  return cell
    .replace(/\[\[([^\]|]*\|)?([^\]]+)\]\]/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_=~`$]/g, '')
    .trim()
}

/** A value that reads as one thing - a number, a date, a share, a duration, a score, a version. */
const SHORT_VALUE = /^[-+−]?[\d.,:/()%\s-]*\d[\d.,:/()%\s-]*(\s?(s|ms|min|h|d|%|pt|gb|mb|kb|tok\/s|tokens\/s|x|×))?$/i
/** A token this long (a path, a URL) may break anywhere, as a last resort. */
const LONG_TOKEN = 32
/** Text this short ("vault copy", "TTFT p50") stays on one line. */
const SHORT_TEXT = 14
/** Inside wrapping text, a date, a time or a version is kept whole: "2026-10-03" never breaks at its hyphens. */
const WHOLE = /\S*\d[\S]*[-–:/.]\S*/g

/** Wrap the dates, times and versions in a cell's text so the line breaks around them, never inside. */
function keepWhole(el: HTMLElement): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) nodes.push(n as Text)
  for (const node of nodes) {
    const text = node.data
    if (!WHOLE.test(text)) continue
    WHOLE.lastIndex = 0
    const parts = document.createDocumentFragment()
    let last = 0
    for (const m of text.matchAll(WHOLE)) {
      const at = m.index ?? 0
      if (at > last) parts.append(text.slice(last, at))
      const span = document.createElement('span')
      span.className = 'cm-cell-whole'
      span.textContent = m[0]
      parts.append(span)
      last = at + m[0].length
    }
    if (last < text.length) parts.append(text.slice(last))
    node.replaceWith(parts)
  }
}

export type CellKind = 'nowrap' | 'long' | 'text'

/**
 * How a cell wraps: short values (dates, numbers, shares, durations, one-word
 * names like "qwen3.5:9b") never; a cell with an unbroken token longer than a
 * path's worth breaks anywhere, but only once its column is at its widest;
 * everything else wraps at spaces only.
 */
export function cellKind(cell: string): CellKind {
  const text = visibleText(cell)
  if (text.split(/\s+/).some((w) => w.length > LONG_TOKEN)) return 'long'
  if ((SHORT_VALUE.test(text) && text.length <= 28) || (!/\s/.test(text) && text.length <= LONG_TOKEN) || text.length <= SHORT_TEXT)
    return 'nowrap'
  return 'text'
}

/** A column of numbers: most of its filled body cells read as a number. */
export function numericColumn(rows: readonly (readonly string[])[], column: number): boolean {
  const values = rows.map((r) => visibleText(r[column] ?? '')).filter((v) => v !== '' && v !== '—' && v !== '-')
  if (values.length === 0) return false
  // Dates and times are short values, not quantities: they stay left.
  return values.filter((v) => SHORT_VALUE.test(v) && !/^\d{4}-\d{2}-\d{2}|^\d{1,2}:\d{2}/.test(v)).length / values.length >= 0.6
}

export class TableWidget extends WidgetType {
  constructor(private readonly source: string) {
    super()
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source
  }

  /**
   * Laid out wider than the text column when its content asks for it: the
   * scroll box grows up to the pane, centred on the column, and only past
   * that does the table scroll sideways inside it, its edges fading where
   * there is more. The page itself never scrolls sideways.
   */
  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-table-wrap'
    const parsed = parseTable(this.source)
    if (parsed === null) {
      wrap.textContent = this.source
      return wrap
    }
    const scroll = document.createElement('div')
    scroll.className = 'cm-table-scroll'
    const table = document.createElement('table')
    table.className = 'cm-table'
    const width = Math.max(parsed.head.length, ...parsed.rows.map((row) => row.length))
    const numeric = Array.from({ length: width }, (_, c) => numericColumn(parsed.rows, c))

    const cell = (tag: 'th' | 'td', text: string, column: number): HTMLElement => {
      const el = document.createElement(tag)
      const alignment = parsed.align[column] ?? (numeric[column] === true ? 'right' : null)
      if (alignment !== null) el.style.textAlign = alignment
      const kind = cellKind(text)
      el.className = `cm-cell-${kind}${numeric[column] === true ? ' cm-cell-number' : ''}`
      renderInline(text, el)
      if (kind === 'text') keepWhole(el)
      return el
    }

    const thead = document.createElement('thead')
    const headRow = document.createElement('tr')
    for (let c = 0; c < width; c++) headRow.append(cell('th', parsed.head[c] ?? '', c))
    thead.append(headRow)
    table.append(thead)

    const tbody = document.createElement('tbody')
    for (const row of parsed.rows) {
      const tr = document.createElement('tr')
      for (let c = 0; c < width; c++) tr.append(cell('td', row[c] ?? '', c))
      tbody.append(tr)
    }
    table.append(tbody)
    scroll.append(table)
    wrap.append(scroll)

    // Fade an edge only where there is more table beyond it.
    const edges = (): void => {
      const max = scroll.scrollWidth - scroll.clientWidth
      scroll.classList.toggle('is-more-left', scroll.scrollLeft > 1)
      scroll.classList.toggle('is-more-right', max - scroll.scrollLeft > 1)
    }
    scroll.addEventListener('scroll', edges, { passive: true })
    new ResizeObserver(edges).observe(scroll)
    revealOnPress(wrap, view)
    return wrap
  }

  /** Links in a cell are followed by the editor's own link handling; any other press shows the source. */
  override ignoreEvent(event: Event): boolean {
    return (event.target as HTMLElement | null)?.closest?.('.cm-wikilink, .cm-mdlink') == null
  }
}

/**
 * How wide a table may grow: the pane's text area (the scroller without its
 * side padding), as `--cm-pane-width` on the editor, kept up to date as the
 * pane is resized, split or focused.
 */
export const tablePaneWidth = ViewPlugin.fromClass(
  class {
    private readonly observer: ResizeObserver

    constructor(private readonly view: EditorView) {
      this.observer = new ResizeObserver(() => this.measure())
      this.observer.observe(view.scrollDOM)
      this.measure()
    }

    measure(): void {
      const scroller = this.view.scrollDOM
      const style = getComputedStyle(scroller)
      const width = scroller.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      if (width > 0) this.view.dom.style.setProperty('--cm-pane-width', `${Math.floor(width)}px`)
    }

    destroy(): void {
      this.observer.disconnect()
    }
  },
)
