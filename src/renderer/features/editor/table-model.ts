/**
 * A markdown table as data: what the table editor changes, and what it writes
 * back. Pure - no DOM, no CodeMirror - so every rule here is unit-tested.
 *
 * Markdown stays the source of truth. A table is parsed from its GFM text,
 * changed, and written back as plain GFM with the pipes lined up. Cells keep
 * their text exactly as written - `\|`, `[[a|b]]`, `$|x|$` and `<br>` included
 * - so a cell nobody touched is written back the same.
 */

export type Align = 'left' | 'center' | 'right' | null

export type TableModel = {
  /** Row 0 is the header. Every row has the same number of cells. */
  rows: string[][]
  align: Align[]
}

/** A rectangle of cells, inclusive, in row/column indexes (row 0 = header). */
export type CellRect = { top: number; left: number; bottom: number; right: number }

/**
 * Split a row into its cells as written: escapes kept, pipes inside `[[…]]`,
 * code and maths are not separators. Outer pipes are optional in GFM.
 */
export function splitRawRow(line: string, links = true): string[] {
  const cells: string[] = []
  let current = ''
  let inMath = false
  let inCode = false
  let inLink = false
  const text = line.trim()
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (char === '\\' && i + 1 < text.length) {
      current += char + text[i + 1]
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
  if (inLink) return splitRawRow(line, false)
  cells.push(current)
  if (text.startsWith('|')) cells.shift()
  if (text.endsWith('|') && !text.endsWith('\\|') && cells.length > 0) cells.pop()
  return cells.map((cell) => cell.trim())
}

const DELIMITER_CELL = /^\s*:?-+:?\s*$/

export function parseTableSource(source: string): TableModel | null {
  const lines = source.split('\n').filter((line) => line.trim() !== '')
  if (lines.length < 2) return null
  const delimiter = splitRawRow(lines[1]!)
  if (delimiter.length === 0 || !delimiter.every((cell) => DELIMITER_CELL.test(cell))) return null
  const raw = [lines[0]!, ...lines.slice(2)].map((line) => splitRawRow(line))
  const width = Math.max(delimiter.length, ...raw.map((row) => row.length))
  const rows = raw.map((row) => [...row, ...Array<string>(width - row.length).fill('')])
  const align = Array.from({ length: width }, (_, i): Align => {
    const cell = (delimiter[i] ?? '').trim()
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null
  })
  return { rows, align }
}

/** Columns a string takes in a monospace font: CJK and emoji count two. */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(char) || code >= 0x1f300 ? 2 : 1
  }
  return width
}

const pad = (text: string, width: number, align: Align): string => {
  const gap = Math.max(0, width - displayWidth(text))
  if (align === 'right') return ' '.repeat(gap) + text
  if (align === 'center') return ' '.repeat(Math.floor(gap / 2)) + text + ' '.repeat(Math.ceil(gap / 2))
  return text + ' '.repeat(gap)
}

/** The table as GFM, every pipe in its column. */
export function formatTable(model: TableModel): string {
  const columns = model.align.length
  const widths = Array.from({ length: columns }, (_, c) => Math.max(3, ...model.rows.map((row) => displayWidth(row[c] ?? ''))))
  const line = (row: readonly string[]): string => `| ${widths.map((w, c) => pad(row[c] ?? '', w, model.align[c] ?? null)).join(' | ')} |`
  const rule = widths.map((w, c) => {
    const a = model.align[c] ?? null
    if (a === 'center') return `:${'-'.repeat(w - 2)}:`
    if (a === 'right') return `${'-'.repeat(w - 1)}:`
    if (a === 'left') return `:${'-'.repeat(w - 1)}`
    return '-'.repeat(w)
  })
  return [line(model.rows[0] ?? []), `| ${rule.join(' | ')} |`, ...model.rows.slice(1).map(line)].join('\n')
}

/**
 * Text typed into a cell, made safe for one: a bare `|` outside code, maths
 * and links is escaped, a newline becomes `<br>`. What was already escaped
 * stays as it is.
 */
export function cellFromInput(text: string): string {
  const flat = text.replace(/\r?\n/g, '<br>').trim()
  let out = ''
  let inMath = false
  let inCode = false
  let inLink = false
  for (let i = 0; i < flat.length; i++) {
    const char = flat[i]!
    if (char === '\\' && i + 1 < flat.length) {
      out += char + flat[i + 1]
      i++
      continue
    }
    if (!inMath && !inCode && char === '[' && flat[i + 1] === '[') inLink = true
    if (inLink && char === ']' && flat[i + 1] === ']') inLink = false
    if (char === '`' && !inMath && !inLink) inCode = !inCode
    if (char === '$' && !inCode && !inLink) inMath = !inMath
    out += char === '|' && !inMath && !inCode && !inLink ? '\\|' : char
  }
  return out
}

const clone = (model: TableModel): TableModel => ({ rows: model.rows.map((row) => [...row]), align: [...model.align] })
const width = (model: TableModel): number => model.align.length

export function emptyTable(columns: number, rows: number): TableModel {
  const head = Array.from({ length: columns }, (_, c) => `Column ${c + 1}`)
  return {
    rows: [head, ...Array.from({ length: Math.max(0, rows - 1) }, () => Array<string>(columns).fill(''))],
    align: Array<Align>(columns).fill(null),
  }
}

export function setCell(model: TableModel, row: number, column: number, text: string): TableModel {
  const next = clone(model)
  if (next.rows[row] !== undefined && column < width(next)) next.rows[row]![column] = text
  return next
}

/** A new empty row at `at` (0..rows). Never above the header. */
export function insertRow(model: TableModel, at: number): TableModel {
  const next = clone(model)
  next.rows.splice(Math.max(1, Math.min(at, next.rows.length)), 0, Array<string>(width(next)).fill(''))
  return next
}

export function duplicateRow(model: TableModel, row: number): TableModel {
  const next = clone(model)
  if (row < 1 || row >= next.rows.length) return next
  next.rows.splice(row + 1, 0, [...next.rows[row]!])
  return next
}

/** Removes a body row. The header stays: a table without one is not a table. */
export function deleteRow(model: TableModel, row: number): TableModel {
  const next = clone(model)
  if (row < 1 || row >= next.rows.length) return next
  next.rows.splice(row, 1)
  return next
}

/** Moves a body row to a new body position. */
export function moveRow(model: TableModel, from: number, to: number): TableModel {
  const next = clone(model)
  if (from < 1 || from >= next.rows.length) return next
  const target = Math.max(1, Math.min(to, next.rows.length - 1))
  const [row] = next.rows.splice(from, 1)
  next.rows.splice(target, 0, row!)
  return next
}

export function insertColumn(model: TableModel, at: number): TableModel {
  const next = clone(model)
  const index = Math.max(0, Math.min(at, width(next)))
  next.rows.forEach((row, r) => row.splice(index, 0, r === 0 ? `Column ${width(model) + 1}` : ''))
  next.align.splice(index, 0, null)
  return next
}

export function duplicateColumn(model: TableModel, column: number): TableModel {
  const next = clone(model)
  if (column < 0 || column >= width(next)) return next
  next.rows.forEach((row) => row.splice(column + 1, 0, row[column]!))
  next.align.splice(column + 1, 0, next.align[column]!)
  return next
}

/** Removes a column; the last one stays. */
export function deleteColumn(model: TableModel, column: number): TableModel {
  const next = clone(model)
  if (width(next) <= 1 || column < 0 || column >= width(next)) return next
  next.rows.forEach((row) => row.splice(column, 1))
  next.align.splice(column, 1)
  return next
}

export function moveColumn(model: TableModel, from: number, to: number): TableModel {
  const next = clone(model)
  if (from < 0 || from >= width(next)) return next
  const target = Math.max(0, Math.min(to, width(next) - 1))
  next.rows.forEach((row) => row.splice(target, 0, row.splice(from, 1)[0]!))
  next.align.splice(target, 0, next.align.splice(from, 1)[0]!)
  return next
}

export function setAlign(model: TableModel, column: number, align: Align): TableModel {
  const next = clone(model)
  if (column >= 0 && column < width(next)) next.align[column] = align
  return next
}

/** A cell read as a number, if it is one: `1,200`, `-3.5`, `12 %`, `€40`. Null otherwise. */
export function numericValue(cell: string): number | null {
  let text = cell
    .replace(/[*_`]/g, '')
    .trim()
    .replace(/\u2212/g, '-')
  const negative = text.startsWith('-')
  if (negative || text.startsWith('+')) text = text.slice(1)
  text = text
    .replace(/^[$€£¥]/, '')
    .replace(/\s*[%$€£¥]$/, '')
    .replace(/[\s,_]/g, '')
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return null
  return (negative ? -1 : 1) * Number(text)
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Body rows sorted by one column: numbers as numbers when the column is all
 * numbers, text otherwise; empty cells always last. The header stays on top,
 * and equal rows keep their order.
 */
export function sortRows(model: TableModel, column: number, direction: 'asc' | 'desc'): TableModel {
  const next = clone(model)
  const body = next.rows.slice(1)
  const values = body.map((row) => row[column] ?? '')
  const numeric = values.filter((v) => v.trim() !== '').every((v) => numericValue(v) !== null)
  const sign = direction === 'asc' ? 1 : -1
  const sorted = body
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const x = (a.row[column] ?? '').trim()
      const y = (b.row[column] ?? '').trim()
      if (x === '' || y === '') return x === y ? a.index - b.index : x === '' ? 1 : -1
      const order = numeric ? numericValue(x)! - numericValue(y)! : collator.compare(x, y)
      return order === 0 ? a.index - b.index : sign * order
    })
  next.rows = [next.rows[0]!, ...sorted.map((entry) => entry.row)]
  return next
}

export function clearCells(model: TableModel, rect: CellRect): TableModel {
  const next = clone(model)
  for (let r = rect.top; r <= rect.bottom; r++)
    for (let c = rect.left; c <= rect.right; c++) if (next.rows[r]?.[c] !== undefined) next.rows[r]![c] = ''
  return next
}

/** Cells of a rectangle, as written. */
export function cellsIn(model: TableModel, rect: CellRect): string[][] {
  return model.rows.slice(rect.top, rect.bottom + 1).map((row) => row.slice(rect.left, rect.right + 1))
}

/** Markup that has no business in a spreadsheet: `<br>` becomes a space, `\|` a pipe. */
const plainCell = (cell: string): string => cell.replace(/<br\s*\/?>/gi, ' ').replace(/\\\|/g, '|')

/** Tab-separated, one row a line - what spreadsheets paste. */
export function toTsv(cells: readonly (readonly string[])[]): string {
  return cells.map((row) => row.map((cell) => plainCell(cell).replace(/\t/g, ' ')).join('\t')).join('\n')
}

/** Cells as a markdown table of their own; the first row is its header. */
export function toMarkdown(cells: readonly (readonly string[])[]): string {
  const columns = Math.max(1, ...cells.map((row) => row.length))
  const rows = cells.map((row) => [...row, ...Array<string>(columns - row.length).fill('')])
  return formatTable({ rows, align: Array<Align>(columns).fill(null) })
}

/**
 * Text from a spreadsheet or a CSV file as cells, or null when it is not one:
 * tabs win over commas; CSV follows RFC 4180 quoting. Needs two cells at
 * least, and rows of one consistent width (a ragged last row is padded).
 */
export function parseDelimited(text: string): string[][] | null {
  const trimmed = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (trimmed === '') return null
  const separator = trimmed.includes('\t') ? '\t' : trimmed.includes(',') ? ',' : null
  if (separator === null) return null
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]!
    if (quoted) {
      if (char === '"' && trimmed[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') quoted = false
      else cell += char
      continue
    }
    if (char === '"' && cell === '') quoted = true
    else if (char === separator) {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  row.push(cell)
  rows.push(row)
  const widths = new Set(rows.map((r) => r.length))
  const columns = Math.max(...rows.map((r) => r.length))
  if (columns < 2 && rows.length < 2) return null
  // Prose with a comma in it is not a CSV: every row must agree on the width.
  if (separator === ',' && (widths.size > 1 || columns < 2)) return null
  return rows.map((r) => [...r.map((c) => c.trim()), ...Array<string>(columns - r.length).fill('')])
}

/** Paste a grid of plain values into the table from a cell on, growing it as needed. */
export function pasteCells(model: TableModel, row: number, column: number, cells: readonly (readonly string[])[]): TableModel {
  let next = clone(model)
  const needColumns = column + Math.max(...cells.map((r) => r.length)) - width(next)
  for (let i = 0; i < needColumns; i++) next = insertColumn(next, width(next))
  const needRows = row + cells.length - next.rows.length
  for (let i = 0; i < needRows; i++) next = insertRow(next, next.rows.length)
  cells.forEach((values, r) => values.forEach((value, c) => (next.rows[row + r]![column + c] = cellFromInput(value))))
  return next
}

/** A markdown table from plain values; the first row is the header. */
export function tableFromCells(cells: readonly (readonly string[])[]): TableModel {
  const columns = Math.max(...cells.map((r) => r.length))
  return {
    rows: cells.map((r) => [...r.map(cellFromInput), ...Array<string>(columns - r.length).fill('')]),
    align: Array<Align>(columns).fill(null),
  }
}
