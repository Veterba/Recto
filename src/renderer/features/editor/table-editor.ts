import { isolateHistory, redo, undo } from '@codemirror/commands'
import {
  ChangeSet,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
  type Text,
  type TransactionSpec,
} from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { EditorView, showTooltip, ViewPlugin, WidgetType, type Tooltip } from '@codemirror/view'
import { createElement } from 'react'
import { openLayer } from '../../ui/menu-host'
import { commands } from '../../app/commands'
import { TableMenu, type IconAction, type MenuEntry } from './components/TableMenu'
import { pressOrDrag } from '../../ui/press-or-drag'
import { attachTip, type TipPlacement } from '../../ui/Tip'
import { renderInline } from './rich-widgets'
import { livePreviewEnabled } from './live-preview-state'
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

/** Six dots: something to take hold of. Sideways for a column. */
const GRIP_DOTS =
  '<svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true">' +
  '<circle cx="2" cy="2" r="1.3"/><circle cx="6" cy="2" r="1.3"/><circle cx="2" cy="7" r="1.3"/>' +
  '<circle cx="6" cy="7" r="1.3"/><circle cx="2" cy="12" r="1.3"/><circle cx="6" cy="12" r="1.3"/></svg>'

/** What a table menu is about. */
type Target = { kind: 'row' | 'col' | 'table'; index: number }

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

/** The table commands (editor-commands.ts): what each does, by its registry id. */
export type TableAction = 'row-up' | 'row-down' | 'column-left' | 'column-right' | 'add-row-below'
export const TABLE_COMMANDS: Readonly<Record<string, TableAction>> = {
  'table:move-row-up': 'row-up',
  'table:move-row-down': 'row-down',
  'table:move-column-left': 'column-left',
  'table:move-column-right': 'column-right',
  'table:add-row-below': 'add-row-below',
}

/** A menu entry's shortcut: the command's binding in force, or none. */
const shortcutOf = (id: string): { shortcut?: string } => {
  const label = commands.label(id)
  return label === null ? {} : { shortcut: label }
}

/** Run a table command on the table that has focus. False when no table has. */
export function runTableAction(action: TableAction): boolean {
  const wrap = document.activeElement?.closest<HTMLElement>('.cm-tbl')
  const controller = wrap === null || wrap === undefined ? undefined : controllers.get(wrap)
  return controller?.act(action) ?? false
}

/** Is a cell of a table being edited or selected? Where the table commands apply. */
export const inTable = (): boolean => {
  const wrap = document.activeElement?.closest<HTMLElement>('.cm-tbl')
  return wrap !== null && wrap !== undefined && controllers.has(wrap)
}

class TableController {
  readonly wrap: HTMLDivElement
  private readonly scroll: HTMLDivElement
  /** The row handles, beside the scroll box rather than in it: see layoutGutter. */
  private readonly gutter: HTMLDivElement
  private table: HTMLTableElement | null = null
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
    // The visible box: the table scrolling in its own scroll box, the add-column
    // strip on its right edge and the add-row bar under it. The two stay put
    // while the table scrolls - they belong to the box, not to the content.
    const frame = document.createElement('div')
    frame.className = 'cm-tbl-frame'
    this.scroll = document.createElement('div')
    this.scroll.className = 'cm-table-scroll'
    const columns = this.model.align.length
    const rows = this.model.rows.length
    const addCol = this.button('cm-tbl-add cm-tbl-add-col', 'Add a column', 'right', (base) =>
      this.apply(insertColumn(base, columns), { row: 0, col: columns, edit: true, selectAll: true }),
    )
    const addRow = this.button('cm-tbl-add cm-tbl-add-row', 'Add a row', 'bottom', (base) =>
      this.apply(insertRow(base, rows), { row: rows, col: 0, edit: true }),
    )
    this.gutter = document.createElement('div')
    this.gutter.className = 'cm-tbl-gutter'
    // The table's own handle, at its top-left corner: the table menu.
    const corner = document.createElement('button')
    corner.type = 'button'
    corner.className = 'cm-tbl-corner'
    corner.setAttribute('aria-label', 'Table')
    attachTip(corner, 'Table', 'top')
    corner.addEventListener('click', (event) => {
      if (event.detail === 0) this.onCorner(corner)
    })
    frame.append(corner, this.gutter, this.scroll, addCol, addRow)
    this.wrap.append(frame)
    this.render()
    this.listen()
    requestAnimationFrame(() => {
      this.layoutGutter()
      this.restore()
    })
    // Rows change height as the pane is resized or a cell wraps differently.
    this.resize = new ResizeObserver(() => this.layoutGutter())
    if (this.table !== null) this.resize.observe(this.table)
  }

  private readonly resize: ResizeObserver

  destroy(): void {
    this.destroyed = true
    this.resize.disconnect()
  }

  /**
   * The row handles sit in their own gutter left of the scroll box, each level
   * with its row. Inside the scroll box they made it 16px wider than the table
   * - its scrollbar started left of the table's edge - and they scrolled away
   * with the cells. Rows do not move vertically when the table scrolls
   * sideways, so placing them once per layout is enough.
   */
  private layoutGutter(): void {
    if (this.table === null) return
    const top = this.gutter.getBoundingClientRect().top
    const grips = [...this.gutter.children] as HTMLElement[]
    this.cells.forEach((row, r) => {
      const grip = grips[r]
      const cell = row[0]
      if (grip === undefined || cell === undefined) return
      const rect = cell.getBoundingClientRect()
      grip.style.top = `${rect.top - top}px`
      grip.style.height = `${rect.height}px`
    })
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
    for (let c = 0; c < columns; c++) {
      const th = document.createElement('th')
      th.className = 'cm-tbl-colh'
      th.append(this.grip('col', c))
      handles.append(th)
    }
    thead.append(handles)

    const tbody = document.createElement('tbody')
    this.cells = rows.map((row, r) => {
      const tr = document.createElement('tr')
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
    table.append(thead, tbody)
    this.scroll.replaceChildren(table)
    this.table = table
    this.gutter.replaceChildren(
      ...rows.map((_, r) => {
        const slot = document.createElement('div')
        slot.className = 'cm-tbl-rowh'
        slot.dataset['row'] = String(r)
        slot.append(this.grip('row', r))
        return slot
      }),
    )
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
    grip.draggable = false
    grip.innerHTML = GRIP_DOTS
    return grip
  }

  /** One "+" control: focusable, a tooltip in the app's layer, the cell being edited written first. */
  private button(className: string, label: string, placement: TipPlacement, run: (base: TableModel) => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = className
    button.setAttribute('aria-label', label)
    button.textContent = className.includes('add-row') ? '+ Add row' : '+'
    if (!className.includes('add-row')) attachTip(button, label, placement)
    // mousedown, so the cell being edited is still there to be read; Enter and
    // Space arrive as a click.
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      run(this.commitEditQuietly())
    })
    button.addEventListener('click', (event) => {
      if (event.detail === 0) run(this.commitEditQuietly())
    })
    return button
  }

  /** Show the handles of the row and column under the pointer - only those. */
  private hot(cell: Cell | null): void {
    for (const el of this.wrap.querySelectorAll('.is-hot')) el.classList.remove('is-hot')
    if (cell === null) return
    this.gutter.querySelector(`[data-row="${cell.row}"]`)?.classList.add('is-hot')
    this.wrap.querySelectorAll('.cm-tbl-colh')[cell.col]?.classList.add('is-hot')
  }

  /** Show the add-row bar near the last row, the add-column strip near the last column. */
  private near(cell: Cell | null): void {
    this.wrap.classList.toggle('is-near-last-row', cell !== null && cell.row === this.model.rows.length - 1)
    this.wrap.classList.toggle('is-near-last-col', cell !== null && cell.col === this.model.align.length - 1)
  }

  private cellAt(target: EventTarget | null): Cell | null {
    const el = (target as HTMLElement | null)?.closest?.('[data-col][data-row]') as HTMLElement | null
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
    // A table always keeps a blank line under it. Leaving it changes nothing
    // else: the caret goes to the line after it, and the first key typed
    // there gets its own blank line (firstKeyAfterTable).
    const tail = tableTail(doc, to)
    const changes = ChangeSet.of(
      [...(insert === this.source ? [] : [{ from, to, insert }]), ...(tail.insert === '' ? [] : [{ from: tail.at, insert: tail.insert }])],
      doc.length,
    )
    let selection: number | undefined
    if (leave === 'below') {
      // The line after the table - or, when that is the blank line and an
      // empty paragraph follows it (Recto leaves one after a new table), that
      // paragraph. Anywhere else the first key is moved past a blank line.
      const end = changes.mapPos(to, 1)
      const after = changes.apply(doc)
      selection = end
      if (end < after.length) {
        const next = after.lineAt(end + 1)
        const paragraph = next.number < after.lines ? after.line(next.number + 1) : null
        selection = next.text.trim() === '' && paragraph !== null && paragraph.text.trim() === '' ? paragraph.from : next.from
      }
    }
    if (leave === 'above') selection = from > 0 ? from - 1 : undefined
    if (focus !== null) pendingFocus.set(this.view, { ...focus, from, scrollLeft: this.scroll.scrollLeft })
    if (changes.empty && selection === undefined) {
      pendingFocus.delete(this.view)
      if (focus !== null) this.focusCell(focus)
      return
    }
    // Leaving a table that ends the note, unchanged, only adds the line break
    // the caret needs after it: that is not an edit to undo.
    const onlyTail = insert === this.source && leave !== undefined
    this.view.dispatch({
      changes,
      ...(selection === undefined ? {} : { selection: { anchor: selection } }),
      annotations: onlyTail ? Transaction.addToHistory.of(false) : isolateHistory.of('full'),
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
    this.near(cell)
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
    // The pointer over the last row or column (or over the control itself)
    // shows its "+"; so does editing a cell there.
    wrap.addEventListener('mouseover', (event) => {
      const target = event.target as HTMLElement
      if (target.closest('.cm-tbl-add') !== null) return
      const cell = this.cellAt(target)
      this.near(cell ?? this.editing?.cell ?? null)
      if (!this.wrap.classList.contains('is-dragging')) this.hot(cell)
    })
    // A native drag (of the text around, say) would swallow the pointer and
    // leave a handle drag hanging: none starts in a table.
    wrap.addEventListener('dragstart', (event) => event.preventDefault())
    wrap.addEventListener('mouseleave', () => {
      this.near(this.editing?.cell ?? null)
      if (!this.wrap.classList.contains('is-dragging')) this.hot(null)
    })
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
    const corner = target.closest('.cm-tbl-corner') as HTMLElement | null
    if (corner !== null) {
      event.preventDefault()
      this.onCorner(corner)
      return
    }
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

    // A header opens its column's menu, as in the reference design; a double
    // click (or Enter on a selected header) edits it.
    if (cell.row === 0 && !event.shiftKey && event.detail === 1) {
      const base = this.commitEditQuietly()
      const head = this.cells[0]![cell.col]!.getBoundingClientRect()
      this.openTableMenu(this.columnEntries(base, cell.col), { x: head.left, y: head.bottom + 6 }, { kind: 'col', index: cell.col }, base)
      return
    }
    if (cell.row === 0 && event.detail >= 2) {
      this.startEdit(cell, 'end')
      return
    }

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

  /** A table command, on the cell being edited or the head of the selection. */
  act(action: TableAction): boolean {
    const at = this.editing?.cell ?? this.range?.head
    if (at === undefined) return false
    const base = this.edited() ?? this.model
    const editing = this.editing !== null
    const lastRow = base.rows.length - 1
    const lastCol = base.align.length - 1
    if (action === 'row-up' && at.row > 1) this.apply(moveRow(base, at.row, at.row - 1), { row: at.row - 1, col: at.col, edit: editing })
    else if (action === 'row-down' && at.row > 0 && at.row < lastRow)
      this.apply(moveRow(base, at.row, at.row + 1), { row: at.row + 1, col: at.col, edit: editing })
    else if (action === 'column-left' && at.col > 0)
      this.apply(moveColumn(base, at.col, at.col - 1), { row: at.row, col: at.col - 1, edit: editing })
    else if (action === 'column-right' && at.col < lastCol)
      this.apply(moveColumn(base, at.col, at.col + 1), { row: at.row, col: at.col + 1, edit: editing })
    // Below the header too: a new first row.
    else if (action === 'add-row-below') this.apply(insertRow(base, at.row + 1), { row: at.row + 1, col: at.col, edit: true })
    return true
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

    // The table commands - ⌥↑ ⌥↓ move the row, ⌥← ⌥→ the column (the cell
    // goes along), ⌘↵ adds a row below - by whatever they are bound to now.
    // Through the registry, like every other command: runTableAction finds this table.
    for (const id of Object.keys(TABLE_COMMANDS)) {
      if (!commands.matches(id, event)) continue
      handled()
      void commands.run(id)
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
        const target: Target = { kind, index }
        const entries = kind === 'row' ? this.rowEntries(base, index) : this.columnEntries(base, index)
        // Under the row, so the selected row stays in view; under the handle for a column.
        const row = kind === 'row' ? this.cells[index]?.[0]?.getBoundingClientRect() : undefined
        this.openTableMenu(
          entries,
          row !== undefined ? { x: rect.right + 6, y: row.bottom + 4 } : { x: rect.left, y: rect.bottom + 6 },
          target,
          base,
        )
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

  /** The table menu, from the handle at the table's top-left corner. */
  private onCorner(button: HTMLElement): void {
    const base = this.commitEditQuietly()
    const rect = button.getBoundingClientRect()
    this.openTableMenu(this.tableEntries(base), { x: rect.left, y: rect.bottom + 6 }, { kind: 'table', index: 0 }, base)
  }

  /** A right-click on a cell: three ways in - its row, its column, the table. */
  private onContextMenu(event: MouseEvent): void {
    const cell = this.cellAt(event.target)
    if (cell === null) return
    event.preventDefault()
    event.stopPropagation()
    const base = this.commitEditQuietly()
    const row: Target = { kind: 'row', index: cell.row }
    const col: Target = { kind: 'col', index: cell.col }
    const table: Target = { kind: 'table', index: 0 }
    this.openTableMenu(
      [
        { kind: 'submenu', icon: 'rows-3', label: 'Row', entries: this.rowEntries(base, cell.row), idle: () => this.showMark(row) },
        {
          kind: 'submenu',
          icon: 'columns-3',
          label: 'Column',
          entries: this.columnEntries(base, cell.col),
          idle: () => this.showMark(col),
        },
        { kind: 'submenu', icon: 'table', label: 'Table', entries: this.tableEntries(base), idle: () => this.showMark(table) },
      ],
      { x: event.clientX, y: event.clientY },
      null,
      base,
    )
  }

  /**
   * `base` is the table with the cell being edited written in: an action in
   * the menu writes both in one step; a menu closed without one still writes
   * the edit, so typing is never lost to a menu.
   */
  private openTableMenu(
    entries: readonly MenuEntry[],
    at: { x: number; y: number },
    target: Target | null,
    base: TableModel,
    keyboard = false,
  ): void {
    this.showMark(target)
    openLayer(
      (close) => createElement(TableMenu, { entries, at, keyboard, onClose: close, idle: () => this.showMark(target) }),
      () => {
        this.showMark(null)
        if (base !== this.model && !this.destroyed && this.wrap.isConnected) this.apply(base, null)
      },
    )
  }

  private rowEntries(base: TableModel, row: number): MenuEntry[] {
    const body = row > 0
    const last = base.rows.length - 1
    const target: Target = { kind: 'row', index: row }
    const go = (next: TableModel, at: number): void => this.apply(next, { row: at, col: 0, edit: false })
    return [
      {
        kind: 'icons',
        items: [
          {
            icon: 'between-horizontal-start',
            label: 'Insert row above',
            disabled: !body,
            preview: () => this.showMark(target, 'before'),
            run: () => go(insertRow(base, row), row),
          },
          {
            icon: 'between-horizontal-end',
            label: 'Insert row below',
            preview: () => this.showMark(target, 'after'),
            run: () => go(insertRow(base, row + 1), row + 1),
          },
          {
            icon: 'copy',
            label: 'Duplicate row',
            disabled: !body,
            preview: () => this.showMark(target, 'after'),
            run: () => go(duplicateRow(base, row), row + 1),
          },
        ],
      },
      {
        kind: 'item',
        icon: 'arrow-up',
        label: 'Move row up',
        ...shortcutOf('table:move-row-up'),
        disabled: row <= 1,
        run: () => go(moveRow(base, row, row - 1), row - 1),
      },
      {
        kind: 'item',
        icon: 'arrow-down',
        label: 'Move row down',
        ...shortcutOf('table:move-row-down'),
        disabled: !body || row >= last,
        run: () => go(moveRow(base, row, row + 1), row + 1),
      },
      { kind: 'separator' },
      {
        kind: 'item',
        icon: 'trash',
        label: 'Delete row',
        danger: true,
        disabled: !body,
        preview: () => this.showMark(target, 'delete'),
        run: () => go(deleteRow(base, row), Math.min(row, last - 1)),
      },
    ]
  }

  private columnEntries(base: TableModel, col: number): MenuEntry[] {
    const last = base.align.length - 1
    const target: Target = { kind: 'col', index: col }
    const go = (next: TableModel, at: number): void => this.apply(next, { row: 0, col: at, edit: false })
    const align = (icon: string, label: string, value: Align): IconAction & { active: boolean } => ({
      icon,
      label,
      active: base.align[col] === value,
      // The active one again goes back to the default.
      run: () => go(setAlign(base, col, base.align[col] === value ? null : value), col),
      preview: () => this.showMark(target),
    })
    return [
      {
        kind: 'icons',
        items: [
          {
            icon: 'between-vertical-start',
            label: 'Insert column left',
            preview: () => this.showMark(target, 'before'),
            run: () => go(insertColumn(base, col), col),
          },
          {
            icon: 'between-vertical-end',
            label: 'Insert column right',
            preview: () => this.showMark(target, 'after'),
            run: () => go(insertColumn(base, col + 1), col + 1),
          },
          {
            icon: 'copy',
            label: 'Duplicate column',
            preview: () => this.showMark(target, 'after'),
            run: () => go(duplicateColumn(base, col), col + 1),
          },
        ],
      },
      {
        kind: 'segmented',
        label: 'Align',
        options: [
          align('text-align-start', 'Align left', 'left'),
          align('text-align-center', 'Align centre', 'center'),
          align('text-align-end', 'Align right', 'right'),
        ],
      },
      {
        kind: 'segmented',
        label: 'Sort',
        options: [
          {
            icon: 'arrow-down-a-z',
            label: 'Sort A → Z',
            active: false,
            run: () => go(sortRows(base, col, 'asc'), col),
            preview: () => this.showMark(target),
          },
          {
            icon: 'arrow-down-z-a',
            label: 'Sort Z → A',
            active: false,
            run: () => go(sortRows(base, col, 'desc'), col),
            preview: () => this.showMark(target),
          },
        ],
      },
      {
        kind: 'item',
        icon: 'arrow-left',
        label: 'Move column left',
        ...shortcutOf('table:move-column-left'),
        disabled: col === 0,
        run: () => go(moveColumn(base, col, col - 1), col - 1),
      },
      {
        kind: 'item',
        icon: 'arrow-right',
        label: 'Move column right',
        ...shortcutOf('table:move-column-right'),
        disabled: col >= last,
        run: () => go(moveColumn(base, col, col + 1), col + 1),
      },
      { kind: 'separator' },
      {
        kind: 'item',
        icon: 'trash',
        label: 'Delete column',
        danger: true,
        disabled: last === 0,
        preview: () => this.showMark(target, 'delete'),
        run: () => go(deleteColumn(base, col), Math.min(col, last - 1)),
      },
    ]
  }

  private tableEntries(base: TableModel): MenuEntry[] {
    const target: Target = { kind: 'table', index: 0 }
    const copy = (text: string): void => void navigator.clipboard.writeText(text)
    return [
      { kind: 'item', icon: 'clipboard-copy', label: 'Copy as Markdown', run: () => copy(toMarkdown(base.rows)) },
      { kind: 'item', icon: 'sheet', label: 'Copy as TSV', run: () => copy(toTsv(base.rows)) },
      { kind: 'item', icon: 'code', label: 'Edit as markdown', run: () => this.editAsMarkdown() },
      { kind: 'separator' },
      {
        kind: 'item',
        icon: 'trash',
        label: 'Delete table',
        danger: true,
        preview: () => this.showMark(target, 'delete'),
        run: () => this.deleteTable(),
      },
    ]
  }

  /**
   * What a menu is about, drawn on the table: a soft tint and an accent
   * outline on the row, column or table; red for a delete being hovered; a
   * line where an insert would land. Drawn in the scroll box, over the cells.
   */
  private showMark(target: Target | null, mode: 'target' | 'delete' | 'before' | 'after' = 'target'): void {
    this.scroll.querySelectorAll('.cm-tbl-mark').forEach((el) => el.remove())
    if (target === null || this.destroyed || this.cells.length === 0) return
    const head = this.cells[0]!
    const lastRow = this.cells[this.cells.length - 1]!
    const box = (el: HTMLElement): { left: number; top: number; right: number; bottom: number } => ({
      left: el.offsetLeft,
      top: el.offsetTop,
      right: el.offsetLeft + el.offsetWidth,
      bottom: el.offsetTop + el.offsetHeight,
    })
    let area: { left: number; top: number; right: number; bottom: number }
    if (target.kind === 'row') {
      const row = this.cells[target.index]
      if (row === undefined) return
      area = { left: box(row[0]!).left, top: box(row[0]!).top, right: box(row[row.length - 1]!).right, bottom: box(row[0]!).bottom }
    } else if (target.kind === 'col') {
      const h = head[target.index]
      if (h === undefined) return
      area = { left: box(h).left, top: box(h).top, right: box(h).right, bottom: box(lastRow[target.index]!).bottom }
    } else {
      area = { left: box(head[0]!).left, top: box(head[0]!).top, right: box(head[head.length - 1]!).right, bottom: box(lastRow[0]!).bottom }
    }
    const mark = document.createElement('div')
    mark.className = `cm-tbl-mark is-${mode} is-${target.kind}`
    const along = target.kind === 'col' ? 'x' : 'y'
    if (mode === 'before' || mode === 'after') {
      const at = along === 'y' ? (mode === 'before' ? area.top : area.bottom) : mode === 'before' ? area.left : area.right
      Object.assign(
        mark.style,
        along === 'y'
          ? { left: `${area.left}px`, width: `${area.right - area.left}px`, top: `${at - 1}px`, height: '3px' }
          : { top: `${area.top}px`, height: `${area.bottom - area.top}px`, left: `${at - 1}px`, width: '3px' },
      )
      mark.classList.add(`is-line-${along}`)
    } else {
      Object.assign(mark.style, {
        left: `${area.left}px`,
        top: `${area.top}px`,
        width: `${area.right - area.left}px`,
        height: `${area.bottom - area.top}px`,
      })
    }
    this.scroll.append(mark)
  }

  /** Show this table's markdown, caret at its start, until the caret leaves it. */
  private editAsMarkdown(): void {
    const from = this.from()
    this.view.dispatch({ effects: editAsMarkdown.of(from), selection: { anchor: from }, scrollIntoView: true })
    this.view.focus()
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
    this.hot(null)
    const grip = this.wrap.querySelector(`.cm-tbl-grip--${kind}[data-index="${index}"]`)
    grip?.classList.add('is-dragged')
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
    const end = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', end)
      marker.remove()
      grip?.classList.remove('is-dragged')
      this.wrap.classList.remove('is-dragging')
    }
    const up = (): void => {
      end()
      // Dropping after itself moves it to where it already is.
      const to = target > index ? target - 1 : target
      if (to === index) return
      if (kind === 'row') this.apply(moveRow(base, index, to), { row: to, col: 0, edit: false })
      else this.apply(moveColumn(base, index, to), { row: 0, col: to, edit: false })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', end)
  }
}

/**
 * What goes under a table that ends at `end`, when Recto writes the table:
 * one blank line, so the next line is never a row of it. In GFM a line right
 * under a table is one more row (Obsidian reads it the same way); Recto
 * keeps the gap rather than read the file differently. Exported for the tests.
 */
export function tableTail(doc: Text, end: number): { at: number; insert: string } {
  const last = doc.lineAt(end).number
  if (last === doc.lines) return { at: end, insert: '\n' }
  return { at: end, insert: doc.line(last + 1).text.trim() === '' ? '' : '\n' }
}

/** Focus the table itself, for keys over a rectangle of cells. */
function focusTable(el: HTMLElement): void {
  el.focus({ preventScroll: true })
}

/** Each table on screen, by its outer element: how a widget, or a command, finds its controller. */
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
            const tail = tableTail(view.state.doc, chip.to)
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

// --- the table as markdown, and the lines around it ---------------------------

/** "Edit as markdown": this table (by where it starts) is shown as source until the caret leaves it. */
export const editAsMarkdown = StateEffect.define<number>()

export const rawTables = StateField.define<readonly number[]>({
  create: () => [],
  update(value, tr) {
    let next = value.map((pos) => tr.changes.mapPos(pos))
    for (const effect of tr.effects) if (effect.is(editAsMarkdown)) next = [...next, effect.value]
    if (next.length === 0) return value.length === 0 ? value : next
    // Leaving the table ends it: the caret is the only reason to show source.
    const head = tr.state.selection.main.head
    return next.filter((pos) => {
      const table = tableAt(tr.state, pos)
      return table !== null && head >= table.from && head <= table.to
    })
  },
})

/** The GFM table starting at or containing `pos`, if any. */
function tableAt(state: EditorState, pos: number): { from: number; to: number } | null {
  let node = syntaxTree(state).resolveInner(Math.min(pos + 1, state.doc.length), -1)
  while (node.parent !== null && node.name !== 'Table') node = node.parent
  return node.name === 'Table' ? { from: node.from, to: node.to } : null
}

/**
 * The first key typed next to a table.
 *
 * On the line right under a table it would become a row; right above the
 * header it would run into the table; and with the caret on a table's own
 * line - the end of a note that ends with one - it would land in a cell. So
 * the text goes where it means to: after a blank line under the table, or
 * before a blank line above it, in the SAME transaction - undoing the key
 * takes the blank line with it. Lines already glued to a table are rows of
 * it and are left alone; only new typing is moved. Live Preview only: in
 * Source mode, and in a table opened with "Edit as markdown", you type
 * markdown.
 */
const firstKeyAfterTable = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('input') || tr.isUserEvent('input.table')) return tr
  const state = tr.startState
  if (!(state.field(livePreviewEnabled, false) ?? false)) return tr
  let single: { from: number; to: number; text: string } | null = null
  let count = 0
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    count++
    single = { from: fromA, to: toA, text: inserted.toString() }
  })
  if (count !== 1 || single === null) return tr
  const { from, to, text } = single as { from: number; to: number; text: string }
  if (from !== to || text.trim() === '') return tr
  const doc = state.doc
  const line = doc.lineAt(from)
  const raw = state.field(rawTables, false) ?? []
  const editable = (t: { from: number } | null): boolean => t !== null && !raw.includes(t.from)
  const spec = (at: number, insert: string, caret: number): TransactionSpec => ({
    changes: { from: at, insert },
    selection: { anchor: caret },
    userEvent: 'input.type',
    scrollIntoView: true,
  })

  // At a table's very edge - the only place in a table the caret can be in
  // Live Preview, where the table is one block: its end (a note that ends with
  // it) goes after it past a blank line, its start goes before it. Decided by
  // where the caret was, not where the key landed: with nothing after a drawn
  // block, the browser types at the block's start.
  const head = state.selection.main
  const edge = head.empty ? tableAt(state, head.head) : null
  if (editable(edge) && head.head === edge!.to && from >= edge!.from && from <= edge!.to) {
    const insert = `\n\n${text}`
    return spec(edge!.to, insert, edge!.to + insert.length)
  }
  if (editable(edge) && head.head === edge!.from && from === edge!.from) return spec(from, `${text}\n\n`, from + text.length)
  if (line.text.trim() !== '') return tr
  // Text on the other side gets its own blank line too, or the new line would
  // join its paragraph.
  const textBelow = line.number < doc.lines && doc.line(line.number + 1).text.trim() !== ''
  const textAbove = line.number > 1 && doc.line(line.number - 1).text.trim() !== ''
  // Right under the last row.
  if (line.number > 1) {
    const above = doc.line(line.number - 1)
    const table = tableAt(state, above.to - 1)
    if (editable(table) && doc.lineAt(table!.to).number === above.number) {
      const insert = `\n${text}${textBelow ? '\n' : ''}`
      return spec(from, insert, from + 1 + text.length)
    }
  }
  // Right above the header.
  if (line.number < doc.lines) {
    const below = doc.line(line.number + 1)
    const table = tableAt(state, below.from)
    if (editable(table) && table!.from === below.from) {
      const lead = textAbove ? '\n' : ''
      return spec(from, `${lead}${text}\n`, from + lead.length + text.length)
    }
  }
  return tr
})

/**
 * A click below the end of a note that ends with a table goes to the end of
 * the note, after the table. Left to CodeMirror, a click past the last drawn
 * block lands before that block - above the table - and the text typed next
 * goes there. Caught on the scroller, in the capture phase: clicks in the
 * space under the text never reach the content element.
 */
const clickPastEnd = ViewPlugin.define((view) => {
  const onDown = (event: MouseEvent): void => {
    if (event.button !== 0 || event.shiftKey || !(view.state.field(livePreviewEnabled, false) ?? false)) return
    const end = view.state.doc.length
    const table = tableAt(view.state, end)
    if (table === null || table.to !== end || (view.state.field(rawTables, false) ?? []).includes(table.from)) return
    if (event.clientY <= view.documentTop + view.lineBlockAt(end).bottom) return
    event.preventDefault()
    event.stopPropagation()
    // The browser cannot hold a caret after a drawn block that ends the note,
    // so the note gets the line break it was missing - not an undo step; the
    // blank line and the text come with the first key (firstKeyAfterTable).
    view.dispatch({
      changes: { from: end, insert: '\n' },
      selection: { anchor: end + 1 },
      annotations: Transaction.addToHistory.of(false),
      userEvent: 'select.pointer',
    })
    view.focus()
  }
  view.scrollDOM.addEventListener('mousedown', onDown, true)
  return { destroy: () => view.scrollDOM.removeEventListener('mousedown', onDown, true) }
})

/** Everything the editor needs for editable tables. */
export const tableEditing = (): Extension => [pendingListener, chipField, chipOnPaste, rawTables, firstKeyAfterTable, clickPastEnd]
