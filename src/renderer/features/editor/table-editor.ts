import { isolateHistory, redo, undo } from '@codemirror/commands'
import { ChangeSet, StateEffect, StateField, type EditorState, type Extension, type Text, type TransactionSpec } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { EditorView, showTooltip, WidgetType, type Tooltip } from '@codemirror/view'
import type { MenuItem } from '../../ui/ContextMenu'
import { openMenu } from '../../ui/menu-host'
import { pressOrDrag } from '../../ui/press-or-drag'
import { renderInline } from './rich-widgets'
import {
  type Align,
  type CellRect,
  cellFromInput,
  cellsIn,
  clearCells,
  deleteColumn,
  deleteRow,
  duplicateColumn,
  duplicateRow,
  emptyTable,
  formatTable,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  parseDelimited,
  parseTableSource,
  pasteCells,
  setAlign,
  setCell,
  sortRows,
  tableFromCells,
  type TableModel,
  toMarkdown,
  toTsv,
} from './table-model'
import { cellKind, keepWhole, numericColumn } from './table-widget'

/**
 * Tables you edit like a spreadsheet, in Live Preview.
 *
 * The markdown stays the truth. Every action - a cell typed into, a row
 * moved, a column sorted - reads the table's text, changes the model
 * (table-model.ts) and writes the whole table back as tidy GFM in ONE
 * transaction, isolated in the history: one action, one undo step.
 *
 * Writing the text rebuilds the widget, so where the keyboard was is handed
 * across the rebuild: the action leaves a "pending focus" for its view, and
 * the new widget at the same position picks it up.
 */

type Cell = { row: number; col: number }

type Pending = {
  /** Where the table starts in the new document. */
  from: number
  row: number
  col: number
  /** Edit the cell (caret in it), or only select it. */
  edit: boolean
  selectAll?: boolean
  range?: CellRect
  scrollLeft?: number
}

const pendingFocus = new WeakMap<EditorView, Pending>()

/** Put the keyboard in a table cell once the table at `from` is drawn. */
export const focusTableCell = StateEffect.define<Pending>()

const pendingListener = EditorView.updateListener.of((update) => {
  for (const tr of update.transactions)
    for (const effect of tr.effects) if (effect.is(focusTableCell)) pendingFocus.set(update.view, effect.value)
})

/** A cell's text as shown: escaped pipes as pipes, `<br>` as a line break. */
function drawCell(el: HTMLElement, raw: string): void {
  raw
    .replace(/\\\|/g, '|')
    .split(/<br\s*\/?>/i)
    .forEach((part, i) => {
      if (i > 0) el.append(document.createElement('br'))
      renderInline(part, el)
    })
}

const editText = (raw: string): string => raw.replace(/<br\s*\/?>/gi, '\n')

const rectOf = (a: Cell, b: Cell): CellRect => ({
  top: Math.min(a.row, b.row),
  bottom: Math.max(a.row, b.row),
  left: Math.min(a.col, b.col),
  right: Math.max(a.col, b.col),
})

/**
 * Is the caret at the start / end of an editable cell? A cell whose whole text
 * is selected - as it is when Tab or Enter lands in it - counts as both, so
 * the arrows keep moving between cells, as in a spreadsheet.
 */
function caretAt(el: HTMLElement, edge: 'start' | 'end'): boolean {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return false
  if (!selection.isCollapsed) return selection.toString() === el.innerText
  const range = document.createRange()
  range.selectNodeContents(el)
  const caret = selection.getRangeAt(0)
  if (edge === 'start') range.setEnd(caret.startContainer, caret.startOffset)
  else range.setStart(caret.endContainer, caret.endOffset)
  return range.toString() === ''
}

/** Is there a line break between the caret and the cell's start / end? */
function moreLines(el: HTMLElement, edge: 'start' | 'end'): boolean {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return false
  const range = document.createRange()
  range.selectNodeContents(el)
  const caret = selection.getRangeAt(0)
  if (edge === 'start') range.setEnd(caret.startContainer, caret.startOffset)
  else range.setStart(caret.endContainer, caret.endOffset)
  return range.toString().includes('\n')
}

function placeCaret(el: HTMLElement, where: 'start' | 'end' | 'all' | { x: number; y: number }): void {
  const selection = window.getSelection()
  if (selection === null) return
  const range = document.createRange()
  if (typeof where === 'object') {
    const at = document.caretRangeFromPoint(where.x, where.y)
    if (at !== null && el.contains(at.startContainer)) {
      selection.removeAllRanges()
      selection.addRange(at)
      return
    }
    where = 'end'
  }
  range.selectNodeContents(el)
  if (where !== 'all') range.collapse(where === 'start')
  selection.removeAllRanges()
  selection.addRange(range)
}

class TableController {
  readonly wrap: HTMLDivElement
  private readonly scroll: HTMLDivElement
  private readonly model: TableModel
  private cells: HTMLElement[][] = []
  private editing: { cell: Cell; el: HTMLElement; original: string } | null = null
  private range: { anchor: Cell; head: Cell } | null = null
  private destroyed = false

  constructor(
    private readonly view: EditorView,
    private readonly source: string,
  ) {
    this.model = parseTableSource(source) ?? emptyTable(1, 1)
    this.wrap = document.createElement('div')
    this.wrap.className = 'cm-table-wrap cm-tbl'
    this.wrap.tabIndex = -1
    this.scroll = document.createElement('div')
    this.scroll.className = 'cm-table-scroll'
    this.wrap.append(this.scroll)
    this.render()
    this.listen()
    requestAnimationFrame(() => this.restore())
  }

  destroy(): void {
    this.destroyed = true
  }

  // --- drawing -------------------------------------------------------------

  private render(): void {
    const { rows, align } = this.model
    const columns = align.length
    const numeric = Array.from({ length: columns }, (_, c) => numericColumn(rows.slice(1), c))
    const table = document.createElement('table')
    table.className = 'cm-table cm-tbl-table'

    const thead = document.createElement('thead')
    const handles = document.createElement('tr')
    handles.className = 'cm-tbl-colhandles'
    handles.append(document.createElement('th'))
    for (let c = 0; c < columns; c++) {
      const th = document.createElement('th')
      th.className = 'cm-tbl-colh'
      th.append(this.grip('col', c))
      handles.append(th)
    }
    const addCol = document.createElement('th')
    addCol.className = 'cm-tbl-addc'
    addCol.append(
      this.button('cm-tbl-add cm-tbl-add-col', 'Add a column', () =>
        this.apply(insertColumn(this.model, columns), { row: 0, col: columns, edit: true, selectAll: true }),
      ),
    )
    handles.append(addCol)
    thead.append(handles)

    const tbody = document.createElement('tbody')
    this.cells = rows.map((row, r) => {
      const tr = document.createElement('tr')
      const handle = document.createElement(r === 0 ? 'th' : 'td')
      handle.className = 'cm-tbl-rowh'
      handle.append(this.grip('row', r))
      tr.append(handle)
      const els = row.map((raw, c) => {
        const el = document.createElement(r === 0 ? 'th' : 'td')
        const alignment = align[c] ?? (numeric[c] === true ? 'right' : null)
        if (alignment !== null) el.style.textAlign = alignment
        const kind = cellKind(raw)
        el.className = `cm-cell-${kind}${numeric[c] === true ? ' cm-cell-number' : ''}`
        el.dataset['row'] = String(r)
        el.dataset['col'] = String(c)
        drawCell(el, raw)
        if (kind === 'text') keepWhole(el)
        tr.append(el)
        return el
      })
      ;(r === 0 ? thead : tbody).append(tr)
      return els
    })
    const addRow = document.createElement('tr')
    addRow.className = 'cm-tbl-addr'
    const addCell = document.createElement('td')
    addCell.colSpan = columns + 1
    addCell.append(
      this.button('cm-tbl-add cm-tbl-add-row', 'Add a row', () =>
        this.apply(insertRow(this.model, rows.length), { row: rows.length, col: 0, edit: true }),
      ),
    )
    addRow.append(document.createElement('td'), addCell)
    tbody.append(addRow)

    table.append(thead, tbody)
    this.scroll.replaceChildren(table)
  }

  private grip(kind: 'row' | 'col', index: number): HTMLButtonElement {
    const grip = document.createElement('button')
    grip.className = `cm-tbl-grip cm-tbl-grip--${kind}`
    grip.type = 'button'
    grip.tabIndex = -1
    grip.setAttribute('aria-label', kind === 'row' ? `Row ${index + 1}` : `Column ${index + 1}`)
    grip.title = 'Click for options, drag to move'
    grip.dataset['kind'] = kind
    grip.dataset['index'] = String(index)
    return grip
  }

  private button(className: string, label: string, run: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.tabIndex = -1
    button.className = className
    button.title = label
    button.setAttribute('aria-label', label)
    button.textContent = '+'
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.commitEdit()
      run()
    })
    return button
  }

  private cellAt(target: EventTarget | null): Cell | null {
    const el = (target as HTMLElement | null)?.closest?.('[data-row]') as HTMLElement | null
    if (el === null || !this.wrap.contains(el)) return null
    return { row: Number(el.dataset['row']), col: Number(el.dataset['col']) }
  }

  private paintRange(): void {
    for (const row of this.cells) for (const el of row) el.classList.remove('is-sel', 'is-head')
    if (this.range === null) return
    const rect = rectOf(this.range.anchor, this.range.head)
    for (let r = rect.top; r <= rect.bottom; r++) for (let c = rect.left; c <= rect.right; c++) this.cells[r]?.[c]?.classList.add('is-sel')
    this.cells[this.range.head.row]?.[this.range.head.col]?.classList.add('is-head')
  }

  // --- writing -------------------------------------------------------------

  private from(): number {
    return this.view.posAtDOM(this.wrap)
  }

  /**
   * Write `next` back as one undo step, and hand the keyboard to `focus` in
   * the table that replaces this one. `leave` moves the editor's caret out of
   * the table instead.
   */
  private apply(next: TableModel, focus: Omit<Pending, 'from'> | null, leave?: 'above' | 'below'): void {
    // Whatever happens next, the cell being typed into is done: it is drawn
    // again, and if the text changed the whole table is replaced anyway.
    this.stopEdit()
    if (this.destroyed || !this.wrap.isConnected) return
    const from = this.from()
    const insert = formatTable(next)
    const doc = this.view.state.doc
    const to = from + this.source.length
    // A table always keeps a blank line under it; leaving it downwards also
    // gets a paragraph line after that, for the caret (see tableTail).
    const tail = tableTail(doc, to, leave === 'below')
    const changes = ChangeSet.of(
      [...(insert === this.source ? [] : [{ from, to, insert }]), ...(tail.insert === '' ? [] : [{ from: tail.at, insert: tail.insert }])],
      doc.length,
    )
    let selection: number | undefined
    if (leave === 'below') selection = changes.mapPos(tail.caret.pos, tail.caret.assoc) + tail.caret.offset
    if (leave === 'above') selection = from > 0 ? from - 1 : undefined
    if (focus !== null) pendingFocus.set(this.view, { ...focus, from, scrollLeft: this.scroll.scrollLeft })
    if (changes.empty && selection === undefined) {
      pendingFocus.delete(this.view)
      if (focus !== null) this.focusCell(focus)
      return
    }
    this.view.dispatch({
      changes,
      ...(selection === undefined ? {} : { selection: { anchor: selection } }),
      annotations: isolateHistory.of('full'),
      userEvent: 'input.table',
      scrollIntoView: leave !== undefined,
    })
    if (leave !== undefined && selection !== undefined) this.view.focus()
  }

  /** The model with the cell being edited written in, or null if nothing changed. */
  private edited(): TableModel | null {
    if (this.editing === null) return null
    const text = cellFromInput(this.editing.el.innerText.replace(/\n$/, ''))
    if (text === this.editing.original) return null
    return setCell(this.model, this.editing.cell.row, this.editing.cell.col, text)
  }

  /** Finish editing the current cell. Returns the model to build on. */
  private commitEdit(): TableModel {
    const next = this.edited()
    if (next === null) this.stopEdit()
    else this.apply(next, null)
    return next ?? this.model
  }

  /** Move to another cell, writing the current one first - one undo step if it changed. */
  private moveTo(cell: Cell, edit: boolean, where: 'start' | 'end' | 'all' = 'all', model?: TableModel): void {
    const next = model ?? this.edited() ?? this.model
    this.apply(next, { row: cell.row, col: cell.col, edit, selectAll: where === 'all' })
  }

  private leave(direction: 'above' | 'below'): void {
    const next = this.edited() ?? this.model
    this.apply(next, null, direction)
  }

  // --- focus ---------------------------------------------------------------

  private restore(): void {
    if (this.destroyed || !this.wrap.isConnected) return
    const pending = pendingFocus.get(this.view)
    if (pending === undefined || pending.from !== this.from()) return
    pendingFocus.delete(this.view)
    if (pending.scrollLeft !== undefined) this.scroll.scrollLeft = pending.scrollLeft
    this.focusCell(pending)
  }

  private focusCell(target: Omit<Pending, 'from'>): void {
    const row = Math.max(0, Math.min(target.row, this.model.rows.length - 1))
    const col = Math.max(0, Math.min(target.col, this.model.align.length - 1))
    if (target.edit) {
      this.startEdit({ row, col }, target.selectAll === true ? 'all' : 'end')
      return
    }
    this.range =
      target.range === undefined
        ? { anchor: { row, col }, head: { row, col } }
        : {
            anchor: { row: target.range.top, col: target.range.left },
            head: { row: target.range.bottom, col: target.range.right },
          }
    this.paintRange()
    this.wrap.focus({ preventScroll: true })
    this.cells[row]?.[col]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  private startEdit(cell: Cell, where: 'start' | 'end' | 'all' | { x: number; y: number }): void {
    const el = this.cells[cell.row]?.[cell.col]
    if (el === undefined) return
    this.stopEdit()
    this.range = null
    this.paintRange()
    const original = this.model.rows[cell.row]![cell.col]!
    el.textContent = editText(original)
    el.contentEditable = 'plaintext-only'
    el.classList.add('is-editing')
    el.spellcheck = true
    this.editing = { cell, el, original }
    el.focus({ preventScroll: true })
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    placeCaret(el, where)
  }

  /** Leave a cell that was not changed: draw it again as it was, no write. */
  private stopEdit(): void {
    if (this.editing === null) return
    const { el, cell } = this.editing
    this.editing = null
    el.contentEditable = 'false'
    el.classList.remove('is-editing')
    el.replaceChildren()
    drawCell(el, this.model.rows[cell.row]![cell.col]!)
  }

  // --- events --------------------------------------------------------------

  private listen(): void {
    const wrap = this.wrap
    wrap.addEventListener('mousedown', (event) => this.onMouseDown(event))
    wrap.addEventListener('contextmenu', (event) => this.onContextMenu(event))
    wrap.addEventListener('keydown', (event) => this.onKeyDown(event))
    wrap.addEventListener('focusout', (event) => {
      const next = event.relatedTarget as Node | null
      if (next !== null && wrap.contains(next)) return
      // The editor taking this table out of the page is not the user leaving it.
      if (this.destroyed || !wrap.isConnected) return
      // Leaving for the menu this table opened is not leaving.
      if (next instanceof HTMLElement && next.closest('.menu') !== null) return
      if (this.editing !== null) this.commitEdit()
      else if (this.range !== null) {
        this.range = null
        this.paintRange()
      }
    })
    wrap.addEventListener('copy', (event) => this.onCopy(event, false))
    wrap.addEventListener('cut', (event) => this.onCopy(event, true))
    wrap.addEventListener('paste', (event) => this.onPaste(event))
  }

  private onMouseDown(event: MouseEvent): void {
    const target = event.target as HTMLElement
    const grip = target.closest('.cm-tbl-grip') as HTMLElement | null
    if (grip !== null) {
      event.preventDefault()
      this.onGrip(grip, event)
      return
    }
    if (event.button !== 0) return
    const cell = this.cellAt(target)
    if (cell === null) return
    // Inside the cell being edited the browser places the caret.
    if (this.editing !== null && this.editing.el.contains(target)) return
    // A link in a cell nobody is editing is followed, as in the rest of the note.
    if (target.closest('.cm-wikilink, .cm-mdlink') !== null && !event.shiftKey) return
    event.preventDefault()

    if (event.shiftKey) {
      const anchor = this.range?.anchor ?? this.editing?.cell ?? cell
      const next = this.edited()
      if (next !== null) {
        this.editing = null
        this.apply(next, { row: cell.row, col: cell.col, edit: false, range: rectOf(anchor, cell) })
        return
      }
      this.stopEdit()
      this.range = { anchor, head: cell }
      this.paintRange()
      focusTable(this.wrap)
      return
    }

    const changed = this.edited()
    if (changed !== null) {
      this.editing = null
      this.apply(changed, { row: cell.row, col: cell.col, edit: true })
      return
    }
    this.stopEdit()

    // Press and drag across cells: a rectangle. Press and release: edit.
    const start = { x: event.clientX, y: event.clientY }
    let dragged = false
    const move = (e: MouseEvent): void => {
      const over = this.cellAt(document.elementFromPoint(e.clientX, e.clientY))
      if (over === null || (!dragged && over.row === cell.row && over.col === cell.col)) return
      dragged = true
      this.range = { anchor: cell, head: over }
      this.paintRange()
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      if (dragged) focusTable(this.wrap)
      else this.startEdit(cell, start)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  private onKeyDown(event: KeyboardEvent): void {
    const mod = event.metaKey || event.ctrlKey
    const handled = (): void => {
      event.preventDefault()
      event.stopPropagation()
    }

    // Undo and redo are the editor's, one table action per step.
    if (mod && event.key.toLowerCase() === 'z') {
      const unchanged = this.editing === null || this.edited() === null
      if (!unchanged) return // the browser undoes typing inside the cell
      handled()
      const at = this.editing?.cell ?? this.range?.head ?? { row: 0, col: 0 }
      pendingFocus.set(this.view, { from: this.from(), row: at.row, col: at.col, edit: this.editing !== null })
      this.stopEdit()
      if (event.shiftKey) redo(this.view)
      else undo(this.view)
      return
    }

    // Select all means the cell. Left to the browser, it selects the whole
    // note around it - the outer editable wins - and the next key replaces it.
    if (mod && event.key.toLowerCase() === 'a') {
      handled()
      if (this.editing !== null) placeCaret(this.editing.el, 'all')
      else {
        const last = { row: this.model.rows.length - 1, col: this.model.align.length - 1 }
        this.range = { anchor: { row: 0, col: 0 }, head: last }
        this.paintRange()
      }
      return
    }

    if (this.editing !== null) this.onEditingKey(event, handled)
    else if (this.range !== null) this.onRangeKey(event, handled, mod)
  }

  private onEditingKey(event: KeyboardEvent, handled: () => void): void {
    const { cell, el } = this.editing!
    const { rows, align } = this.model
    const lastRow = rows.length - 1
    const lastCol = align.length - 1
    switch (event.key) {
      case 'Tab': {
        handled()
        if (event.shiftKey) {
          if (cell.col > 0) this.moveTo({ row: cell.row, col: cell.col - 1 }, true)
          else if (cell.row > 0) this.moveTo({ row: cell.row - 1, col: lastCol }, true)
          return
        }
        if (cell.col < lastCol) this.moveTo({ row: cell.row, col: cell.col + 1 }, true)
        else if (cell.row < lastRow) this.moveTo({ row: cell.row + 1, col: 0 }, true)
        else this.moveTo({ row: cell.row + 1, col: 0 }, true, 'all', insertRow(this.edited() ?? this.model, rows.length))
        return
      }
      case 'Enter': {
        if (event.shiftKey) return // a line break in the cell, written as <br>
        handled()
        if (cell.row < lastRow) this.moveTo({ row: cell.row + 1, col: cell.col }, true)
        else this.moveTo({ row: cell.row + 1, col: cell.col }, true, 'all', insertRow(this.edited() ?? this.model, rows.length))
        return
      }
      case 'Escape':
        handled()
        this.leave('below')
        return
      case 'ArrowLeft':
      case 'ArrowRight': {
        const back = event.key === 'ArrowLeft'
        if (event.shiftKey) {
          if (!caretAt(el, back ? 'start' : 'end')) return
          handled()
          this.extendFromEdit({ row: cell.row, col: Math.max(0, Math.min(lastCol, cell.col + (back ? -1 : 1))) })
          return
        }
        if (!caretAt(el, back ? 'start' : 'end')) return
        handled()
        if (back && cell.col > 0) this.moveTo({ row: cell.row, col: cell.col - 1 }, true, 'end')
        else if (!back && cell.col < lastCol) this.moveTo({ row: cell.row, col: cell.col + 1 }, true, 'start')
        return
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        const up = event.key === 'ArrowUp'
        if (moreLines(el, up ? 'start' : 'end')) return
        handled()
        if (event.shiftKey) {
          this.extendFromEdit({ row: Math.max(0, Math.min(lastRow, cell.row + (up ? -1 : 1))), col: cell.col })
          return
        }
        if (up && cell.row === 0) this.leave('above')
        else if (!up && cell.row === lastRow) this.leave('below')
        else this.moveTo({ row: cell.row + (up ? -1 : 1), col: cell.col }, true, 'end')
        return
      }
    }
  }

  /** Shift+arrow at the edge of a cell: from editing to a rectangle. */
  private extendFromEdit(head: Cell): void {
    const anchor = this.editing!.cell
    const next = this.edited()
    if (next !== null) {
      this.editing = null
      this.apply(next, { row: head.row, col: head.col, edit: false, range: rectOf(anchor, head) })
      return
    }
    this.stopEdit()
    this.range = { anchor, head }
    this.paintRange()
    focusTable(this.wrap)
  }

  private onRangeKey(event: KeyboardEvent, handled: () => void, mod: boolean): void {
    const range = this.range!
    const lastRow = this.model.rows.length - 1
    const lastCol = this.model.align.length - 1
    const step: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    const delta = step[event.key]
    if (delta !== undefined) {
      handled()
      const head = {
        row: Math.max(0, Math.min(lastRow, range.head.row + delta[0])),
        col: Math.max(0, Math.min(lastCol, range.head.col + delta[1])),
      }
      if (event.shiftKey) {
        this.range = { anchor: range.anchor, head }
        this.paintRange()
      } else this.startEdit(head, 'end')
      return
    }
    if (event.key === 'Escape') {
      handled()
      this.leave('below')
      return
    }
    if (event.key === 'Enter' || event.key === 'F2') {
      handled()
      this.startEdit(range.head, 'end')
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      handled()
      const rect = rectOf(range.anchor, range.head)
      this.apply(clearCells(this.model, rect), { row: range.head.row, col: range.head.col, edit: false, range: rect })
      return
    }
    if (event.key === 'Tab') {
      handled()
      this.startEdit(range.head, 'all')
      return
    }
    // Typing over a selected cell replaces it, as in a spreadsheet.
    if (!mod && !event.altKey && event.key.length === 1) {
      handled()
      this.startEdit(range.head, 'all')
      document.execCommand('insertText', false, event.key)
    }
  }

  private onCopy(event: ClipboardEvent, cut: boolean): void {
    if (this.range === null || event.clipboardData === null) return
    event.preventDefault()
    event.stopPropagation()
    const rect = rectOf(this.range.anchor, this.range.head)
    const cells = cellsIn(this.model, rect)
    event.clipboardData.setData('text/plain', toTsv(cells))
    event.clipboardData.setData('text/markdown', toMarkdown(cells))
    if (cut) this.apply(clearCells(this.model, rect), { row: rect.top, col: rect.left, edit: false, range: rect })
  }

  private onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text/plain') ?? ''
    const grid = parseDelimited(text)
    const at = this.editing?.cell ?? (this.range === null ? null : rectOf(this.range.anchor, this.range.head))
    if (at === null) return
    const row = 'row' in at ? at.row : at.top
    const col = 'col' in at ? at.col : at.left
    if (grid === null) {
      // One value into a selected cell replaces it; while editing, the browser pastes.
      if (this.editing !== null || text === '') return
      event.preventDefault()
      this.apply(setCell(this.model, row, col, cellFromInput(text)), { row, col, edit: false })
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const base = this.edited() ?? this.model
    this.editing = null
    const next = pasteCells(base, row, col, grid)
    this.apply(next, {
      row,
      col,
      edit: false,
      range: { top: row, left: col, bottom: row + grid.length - 1, right: col + Math.max(...grid.map((r) => r.length)) - 1 },
    })
  }

  // --- menus and dragging --------------------------------------------------

  private onGrip(grip: HTMLElement, event: MouseEvent): void {
    const kind = grip.dataset['kind'] as 'row' | 'col'
    const index = Number(grip.dataset['index'])
    const base = this.commitEditQuietly()
    pressOrDrag(event, {
      onClick: () => {
        const rect = grip.getBoundingClientRect()
        openMenu(kind === 'row' ? this.rowItems(base, index) : this.columnItems(base, index), { x: rect.right + 4, y: rect.top })
      },
      onDrag: (x, y) => this.drag(base, kind, index, x, y),
    })
  }

  /** The edited model without writing it yet - a grip action writes both in one step. */
  private commitEditQuietly(): TableModel {
    const next = this.edited() ?? this.model
    this.stopEdit()
    return next
  }

  private onContextMenu(event: MouseEvent): void {
    const cell = this.cellAt(event.target)
    if (cell === null) return
    event.preventDefault()
    event.stopPropagation()
    const base = this.commitEditQuietly()
    const rect = this.range === null ? null : rectOf(this.range.anchor, this.range.head)
    const cells = rect === null ? base.rows : cellsIn(base, rect)
    const copy = (text: string): void => void navigator.clipboard.writeText(text)
    openMenu(
      [
        { kind: 'heading', label: 'Row' },
        ...this.rowItems(base, cell.row),
        { kind: 'heading', label: 'Column' },
        ...this.columnItems(base, cell.col),
        { kind: 'separator' },
        {
          kind: 'item',
          label: rect === null ? 'Copy table as TSV' : 'Copy cells as TSV',
          icon: 'clipboard-copy',
          run: () => copy(toTsv(cells)),
        },
        {
          kind: 'item',
          label: rect === null ? 'Copy table as Markdown' : 'Copy cells as Markdown',
          icon: 'clipboard-copy',
          run: () => copy(toMarkdown(cells)),
        },
        { kind: 'separator' },
        { kind: 'item', label: 'Delete table', icon: 'trash', danger: true, run: () => this.deleteTable() },
      ],
      { x: event.clientX, y: event.clientY },
    )
  }

  private rowItems(base: TableModel, row: number): MenuItem[] {
    const body = row > 0
    const last = base.rows.length - 1
    const go = (next: TableModel, at: number): void => this.apply(next, { row: at, col: 0, edit: false })
    return [
      { kind: 'item', label: 'Insert row above', icon: 'arrow-up', disabled: !body, run: () => go(insertRow(base, row), row) },
      { kind: 'item', label: 'Insert row below', icon: 'arrow-down', run: () => go(insertRow(base, row + 1), row + 1) },
      { kind: 'item', label: 'Duplicate row', icon: 'copy', disabled: !body, run: () => go(duplicateRow(base, row), row + 1) },
      { kind: 'item', label: 'Move row up', disabled: row <= 1, run: () => go(moveRow(base, row, row - 1), row - 1) },
      { kind: 'item', label: 'Move row down', disabled: !body || row >= last, run: () => go(moveRow(base, row, row + 1), row + 1) },
      {
        kind: 'item',
        label: 'Delete row',
        icon: 'trash',
        danger: true,
        disabled: !body,
        run: () => go(deleteRow(base, row), Math.min(row, last - 1)),
      },
    ]
  }

  private columnItems(base: TableModel, col: number): MenuItem[] {
    const last = base.align.length - 1
    const go = (next: TableModel, at: number): void => this.apply(next, { row: 0, col: at, edit: false })
    const alignItem = (label: string, value: Align): MenuItem => ({
      kind: 'item',
      label,
      ...(base.align[col] === value ? { icon: 'check' } : {}),
      run: () => go(setAlign(base, col, value), col),
    })
    return [
      { kind: 'item', label: 'Insert column left', icon: 'arrow-left', run: () => go(insertColumn(base, col), col) },
      { kind: 'item', label: 'Insert column right', icon: 'arrow-right', run: () => go(insertColumn(base, col + 1), col + 1) },
      { kind: 'item', label: 'Duplicate column', icon: 'copy', run: () => go(duplicateColumn(base, col), col + 1) },
      { kind: 'item', label: 'Move column left', disabled: col === 0, run: () => go(moveColumn(base, col, col - 1), col - 1) },
      { kind: 'item', label: 'Move column right', disabled: col >= last, run: () => go(moveColumn(base, col, col + 1), col + 1) },
      alignItem('Align left', 'left'),
      alignItem('Align centre', 'center'),
      alignItem('Align right', 'right'),
      alignItem('Default alignment', null),
      { kind: 'item', label: 'Sort A → Z', run: () => go(sortRows(base, col, 'asc'), col) },
      { kind: 'item', label: 'Sort Z → A', run: () => go(sortRows(base, col, 'desc'), col) },
      {
        kind: 'item',
        label: 'Delete column',
        icon: 'trash',
        danger: true,
        disabled: last === 0,
        run: () => go(deleteColumn(base, col), Math.min(col, last - 1)),
      },
    ]
  }

  private deleteTable(): void {
    const from = this.from()
    const doc = this.view.state.doc
    const to = Math.min(doc.length, from + this.source.length + 1)
    this.view.dispatch({
      changes: { from, to },
      selection: { anchor: from },
      annotations: isolateHistory.of('full'),
      userEvent: 'delete.table',
    })
    this.view.focus()
  }

  /** Drag a row or column by its grip: a line shows where it lands. */
  private drag(base: TableModel, kind: 'row' | 'col', index: number, x: number, y: number): void {
    const marker = document.createElement('div')
    marker.className = `cm-tbl-drop cm-tbl-drop--${kind}`
    this.wrap.append(marker)
    this.wrap.classList.add('is-dragging')
    let target = index
    const wrapRect = (): DOMRect => this.wrap.getBoundingClientRect()
    const place = (px: number, py: number): void => {
      if (kind === 'row') {
        const rows = this.cells.slice(1).map((r) => r[0]!.getBoundingClientRect())
        let at = rows.findIndex((rect) => py < rect.top + rect.height / 2)
        if (at === -1) at = rows.length
        target = at + 1
        const edge = at < rows.length ? rows[at]!.top : rows[rows.length - 1]!.bottom
        const first = this.cells[0]![0]!.getBoundingClientRect()
        const last = this.cells[0]![this.cells[0]!.length - 1]!.getBoundingClientRect()
        Object.assign(marker.style, {
          top: `${edge - wrapRect().top - 1}px`,
          left: `${first.left - wrapRect().left}px`,
          width: `${last.right - first.left}px`,
        })
      } else {
        const cols = this.cells[0]!.map((el) => el.getBoundingClientRect())
        let at = cols.findIndex((rect) => px < rect.left + rect.width / 2)
        if (at === -1) at = cols.length
        target = at
        const edge = at < cols.length ? cols[at]!.left : cols[cols.length - 1]!.right
        const top = cols[0]!.top
        const bottom = this.cells[this.cells.length - 1]![0]!.getBoundingClientRect().bottom
        Object.assign(marker.style, {
          left: `${edge - wrapRect().left - 1}px`,
          top: `${top - wrapRect().top}px`,
          height: `${bottom - top}px`,
        })
      }
    }
    place(x, y)
    const move = (event: PointerEvent): void => place(event.clientX, event.clientY)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      marker.remove()
      this.wrap.classList.remove('is-dragging')
      // Dropping after itself moves it to where it already is.
      const to = target > index ? target - 1 : target
      if (to === index) return
      if (kind === 'row') this.apply(moveRow(base, index, to), { row: to, col: 0, edit: false })
      else this.apply(moveColumn(base, index, to), { row: 0, col: to, edit: false })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
}

/**
 * What goes under a table that ends at `end`.
 *
 * In GFM a line right under a table is one more row of it (Obsidian reads it
 * the same way), so the editor must never leave you there. Always: one blank
 * line under the table. Leaving it (`leaving`): also a paragraph line after
 * that blank line - an empty one, made if needed - and the caret goes there.
 * `caret` is a position in the old document to map through the changes, plus
 * an offset into what was inserted there. Exported for the tests.
 */
export function tableTail(
  doc: Text,
  end: number,
  leaving: boolean,
): { at: number; insert: string; caret: { pos: number; assoc: -1 | 1; offset: number } } {
  const blank = (n: number): boolean => doc.line(n).text.trim() === ''
  const last = doc.lineAt(end).number
  // The table is the end of the note.
  if (last === doc.lines) {
    const insert = leaving ? '\n\n' : '\n'
    return { at: end, insert, caret: { pos: end, assoc: 1, offset: 0 } }
  }
  // Text right under it: push it down.
  if (!blank(last + 1)) {
    return { at: end, insert: leaving ? '\n\n\n' : '\n', caret: { pos: end, assoc: -1, offset: 2 } }
  }
  const under = doc.line(last + 1)
  if (!leaving) return { at: end, insert: '', caret: { pos: under.from, assoc: 1, offset: 0 } }
  if (last + 1 === doc.lines) return { at: under.to, insert: '\n', caret: { pos: under.to, assoc: 1, offset: 0 } }
  const next = doc.line(last + 2)
  if (blank(last + 2)) return { at: next.from, insert: '', caret: { pos: next.from, assoc: 1, offset: 0 } }
  return { at: next.from, insert: '\n\n', caret: { pos: next.from, assoc: -1, offset: 0 } }
}

/** Focus the table itself, for keys over a rectangle of cells. */
function focusTable(el: HTMLElement): void {
  el.focus({ preventScroll: true })
}

const controllers = new WeakMap<HTMLElement, TableController>()

/** A table in Live Preview you can edit in place. Read-only views keep `TableWidget`. */
export class EditableTableWidget extends WidgetType {
  constructor(readonly source: string) {
    super()
  }

  override eq(other: EditableTableWidget): boolean {
    return other.source === this.source
  }

  override toDOM(view: EditorView): HTMLElement {
    const controller = new TableController(view, this.source)
    controllers.set(controller.wrap, controller)
    return controller.wrap
  }

  override destroy(dom: HTMLElement): void {
    controllers.get(dom)?.destroy()
  }

  /** The table handles its own events - except a press on a link nobody is editing, which the editor follows. */
  override ignoreEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null
    if (event.type === 'mousedown' && target?.closest?.('.cm-wikilink, .cm-mdlink') != null && target.closest('.is-editing') === null)
      return false
    return true
  }
}

// --- inserting a table -------------------------------------------------------

/**
 * A new table at the caret: a blank line above it unless there is one, a line
 * below it to come back to, and the keyboard in its first header cell.
 */
export function insertTableSpec(state: EditorState, columns: number, rows: number): TransactionSpec {
  const doc = state.doc
  const line = doc.lineAt(state.selection.main.head)
  const empty = line.text.trim() === ''
  const previousBlank = line.number === 1 || doc.line(line.number - 1).text.trim() === ''
  // On an empty line the table takes its place; otherwise it goes after the line.
  const before = empty ? (previousBlank ? '' : '\n') : '\n\n'
  const table = formatTable(emptyTable(columns, rows))
  // Exactly one blank line between the table and what follows. At the end of
  // the note - nothing but blank lines after it - the blank line and an empty
  // paragraph after that, to come back to.
  const start = empty ? line.from : line.to
  const atEnd = doc.sliceString(line.to).trim() === ''
  const nextBlank = !atEnd && doc.line(line.number + 1).text.trim() === ''
  const after = atEnd ? '\n\n' : nextBlank ? '' : '\n'
  const from = start + before.length
  const insert = `${before}${table}${after}`
  return {
    changes: { from: start, to: atEnd ? doc.length : line.to, insert },
    selection: { anchor: atEnd ? start + insert.length : from + table.length + 1 },
    effects: focusTableCell.of({ from, row: 0, col: 0, edit: true, selectAll: true }),
    annotations: isolateHistory.of('full'),
    userEvent: 'input.table',
    scrollIntoView: true,
  }
}

// --- pasting a table from outside ----------------------------------------------

type Chip = { from: number; to: number; cells: string[][] }
const setChip = StateEffect.define<Chip | null>()

/** Rows and columns pasted as text: offer "Paste as table" beside them until the next edit. */
const chipField = StateField.define<Chip | null>({
  create: () => null,
  update(chip, tr) {
    for (const effect of tr.effects) if (effect.is(setChip)) return effect.value
    if (chip === null) return null
    if (tr.docChanged || tr.selection !== undefined) return null
    return chip
  },
  provide: (field) =>
    showTooltip.compute([field], (state): Tooltip | null => {
      const chip = state.field(field)
      if (chip === null) return null
      return {
        pos: chip.to,
        above: false,
        create: (view) => {
          const dom = document.createElement('div')
          dom.className = 'cm-tbl-chip glass-surface'
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'cm-tbl-chip__btn'
          button.textContent = 'Paste as table'
          button.addEventListener('mousedown', (event) => {
            event.preventDefault()
            const table = formatTable(tableFromCells(chip.cells))
            const tail = tableTail(view.state.doc, chip.to, false)
            view.dispatch({
              changes: [
                { from: chip.from, to: chip.to, insert: table },
                ...(tail.insert === '' ? [] : [{ from: tail.at, insert: tail.insert }]),
              ],
              effects: setChip.of(null),
              annotations: isolateHistory.of('full'),
              userEvent: 'input.table',
            })
          })
          const close = document.createElement('button')
          close.type = 'button'
          close.className = 'cm-tbl-chip__close'
          close.setAttribute('aria-label', 'Dismiss')
          close.textContent = '×'
          close.addEventListener('mousedown', (event) => {
            event.preventDefault()
            view.dispatch({ effects: setChip.of(null) })
          })
          dom.append(button, close)
          return { dom }
        },
      }
    }),
})

const chipOnPaste = EditorView.updateListener.of((update) => {
  for (const tr of update.transactions) {
    if (!tr.isUserEvent('input.paste')) continue
    let pasted: { from: number; to: number; text: string } | null = null
    tr.changes.iterChanges((_fromA, _toA, fromB, toB, inserted) => {
      pasted = { from: fromB, to: toB, text: inserted.toString() }
    })
    if (pasted === null) continue
    const { from, to, text } = pasted as { from: number; to: number; text: string }
    const cells = parseDelimited(text)
    if (cells === null || cells.length < 2 || cells[0]!.length < 2) continue
    // Not inside a table: there the table's own paste fills cells.
    queueMicrotask(() => update.view.dispatch({ effects: setChip.of({ from, to: to - (text.endsWith('\n') ? 1 : 0), cells }) }))
  }
})

/**
 * A click on the blank line right under a table would put the caret where
 * the next keystroke becomes a table row. It goes to the paragraph after
 * that blank line instead, made if needed.
 */
const clickBelowTable = EditorView.updateListener.of((update) => {
  if (!update.transactions.some((tr) => tr.isUserEvent('select.pointer'))) return
  const { state } = update
  const sel = state.selection.main
  if (!sel.empty) return
  const line = state.doc.lineAt(sel.head)
  if (line.number === 1 || line.text.trim() !== '') return
  const above = state.doc.line(line.number - 1)
  let node = syntaxTree(state).resolveInner(above.to, -1)
  while (node.parent !== null && node.name !== 'Table') node = node.parent
  if (node.name !== 'Table' || state.doc.lineAt(node.to).number !== above.number) return
  const tail = tableTail(state.doc, above.to, true)
  const changes = ChangeSet.of(tail.insert === '' ? [] : [{ from: tail.at, insert: tail.insert }], state.doc.length)
  const anchor = changes.mapPos(tail.caret.pos, tail.caret.assoc) + tail.caret.offset
  queueMicrotask(() => update.view.dispatch({ changes, selection: { anchor }, userEvent: 'select.table' }))
})

/** Everything the editor needs for editable tables. */
export const tableEditing = (): Extension => [pendingListener, chipField, chipOnPaste, clickBelowTable]
