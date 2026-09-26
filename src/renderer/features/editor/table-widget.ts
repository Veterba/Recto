/**
 * Markdown tables, parsed and drawn as a table while the cursor is elsewhere.
 */

import { WidgetType, type EditorView } from '@codemirror/view'
import { renderInline, revealOnPress } from './rich-widgets'

/**
 * Split one table row into cells.
 *
 * A pipe inside `$…$` or backticks is part of the cell - `$|x|$` is an
 * absolute value, not two columns - and `\|` is an escaped pipe. Outer pipes
 * are optional in GFM and dropped.
 */
export function splitRow(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inMath = false
  let inCode = false
  const text = line.trim()
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (char === '\\' && text[i + 1] === '|') {
      current += '|'
      i++
      continue
    }
    if (char === '`' && !inMath) inCode = !inCode
    if (char === '$' && !inCode) inMath = !inMath
    if (char === '|' && !inMath && !inCode) {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
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
  const rows = lines.slice(2).map(splitRow)
  return { head, align, rows }
}

export class TableWidget extends WidgetType {
  constructor(private readonly source: string) {
    super()
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-table-wrap'
    const parsed = parseTable(this.source)
    if (parsed === null) {
      wrap.textContent = this.source
      return wrap
    }
    const table = document.createElement('table')
    table.className = 'cm-table'
    const width = Math.max(parsed.head.length, ...parsed.rows.map((row) => row.length))

    const cell = (tag: 'th' | 'td', text: string, column: number): HTMLElement => {
      const el = document.createElement(tag)
      const alignment = parsed.align[column]
      if (alignment !== null && alignment !== undefined) el.style.textAlign = alignment
      renderInline(text, el)
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
    wrap.append(table)
    revealOnPress(wrap, view)
    return wrap
  }

  override ignoreEvent(): boolean {
    return true
  }
}
