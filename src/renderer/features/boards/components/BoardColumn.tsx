import { useState } from 'react'
import { ContextMenu, useContextMenu, type MenuItem } from '../../../ui/ContextMenu'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { COLUMN_COLORS, type Column, type ColumnColor } from '../boards'
import { spanLabel, type CardView } from '../board-view'
import { BoardCard } from './BoardCard'

type Props = {
  /** Null for the "Unknown status" column: no menu, no new cards, nothing dropped into it. */
  column: Column | null
  /** The cards to draw, filtered and sorted. */
  cards: CardView[]
  /** Every card in the column, filters aside: what the count and the WIP limit are about. */
  total: number
  today: string
  selected: string | null
  dragging: string | null
  /** The slot a drag would land in here, or null when the drag is elsewhere. */
  dropIndex: number | null
  renaming: boolean
  setRenaming: (on: boolean) => void
  onDragStart: (path: string) => void
  onDragEnd: () => void
  onDragOver: (index: number) => void
  onDrop: (path: string, index: number) => void
  onOpenCard: (path: string) => void
  onCardMenu: (event: React.MouseEvent, card: CardView) => void
  /** The header's "+": open the new-card popover inside this column. */
  onNewCard: (anchor: DOMRect) => void
  onEdit: (next: Column) => void
  onDelete: () => void
}

const COLOR_LABEL: Record<ColumnColor, string> = {
  gray: 'Gray',
  blue: 'Blue',
  green: 'Green',
  yellow: 'Yellow',
  orange: 'Orange',
  red: 'Red',
  purple: 'Purple',
}

/** A column: a glass panel the full height of the board, its cards scrolling inside it. */
export function BoardColumn(props: Props): React.ReactElement {
  const { column, cards, total, dropIndex } = props
  const [form, setForm] = useState<'wip' | 'dates' | null>(null)
  const menu = useContextMenu<null>()
  const known = column !== null
  const name = column?.name ?? 'Unknown status'
  const full = column?.wip !== undefined && total >= column.wip

  const menuItems = (col: Column): MenuItem[] => [
    { kind: 'item', label: 'Rename', icon: 'pencil', run: () => props.setRenaming(true) },
    { kind: 'heading', label: 'Colour' },
    ...COLUMN_COLORS.map<MenuItem>((color) => ({
      kind: 'item',
      label: COLOR_LABEL[color],
      icon: (col.color ?? 'gray') === color ? 'check' : 'circle-dashed',
      run: () => props.onEdit({ ...col, color }),
    })),
    { kind: 'separator' },
    { kind: 'item', label: 'WIP limit…', icon: 'sliders', run: () => setForm('wip') },
    { kind: 'item', label: 'Date range…', icon: 'calendar-range', run: () => setForm('dates') },
    { kind: 'separator' },
    { kind: 'item', label: 'Delete column', icon: 'trash', danger: true, run: props.onDelete },
  ]

  const dragOver = (index: number) => (event: React.DragEvent) => {
    if (!known) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    if (dropIndex !== index) props.onDragOver(index)
  }
  const drop = (index: number) => (event: React.DragEvent) => {
    if (!known) return
    event.preventDefault()
    event.stopPropagation()
    const path = event.dataTransfer.getData('text/plain')
    if (path !== '') props.onDrop(path, index)
  }

  return (
    <section
      className={`board-col${dropIndex !== null ? ' is-target' : ''}${known ? '' : ' board-col--unknown'}`}
      aria-label={name}
      data-column={column?.id ?? ''}
      style={column?.color === undefined ? undefined : { ['--col-ink' as string]: `var(--col-${column.color})` }}
      // A note dragged onto a column becomes a card, not a new pane.
      data-accepts-drop={known ? true : undefined}
      onDragOver={dragOver(cards.length)}
      onDrop={drop(cards.length)}
    >
      <header className="board-col__head">
        <span className="board-col__dot" aria-hidden="true" />
        {props.renaming && column !== null ? (
          <input
            className="board-col__rename"
            defaultValue={column.name}
            aria-label="Column name"
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => {
              props.setRenaming(false)
              const next = event.target.value.trim()
              // The id is left alone on rename: it is what the notes say.
              if (next !== '' && next !== column.name) props.onEdit({ ...column, name: next })
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                event.currentTarget.value = column.name
                event.currentTarget.blur()
              }
            }}
          />
        ) : (
          <h2 className="board-col__name" onDoubleClick={() => known && props.setRenaming(true)}>
            {name}
          </h2>
        )}
        {/* With a WIP limit the count is in the limit's pill; once is enough. */}
        {column?.wip === undefined && <span className="board-col__count">{total}</span>}
        {column?.wip !== undefined && (
          <span className={`board-col__wip${full ? ' is-full' : ''}`} title="Work-in-progress limit">
            {total}/{column.wip}
          </span>
        )}
        {column !== null && (
          <span className="board-col__acts">
            <Tip label="New card">
              <button
                className="icon-btn board-col__btn"
                aria-label={`New card in ${name}`}
                onClick={(event) => props.onNewCard(event.currentTarget.closest('.board-col')!.getBoundingClientRect())}
              >
                <Icon name="plus" size={14} />
              </button>
            </Tip>
            <button className="icon-btn board-col__btn" aria-label={`${name} menu`} onClick={(event) => menu.open(event, null)}>
              <Icon name="more-horizontal" size={14} />
            </button>
          </span>
        )}
      </header>

      {column !== null && form !== null && <ColumnForm column={column} form={form} onSave={props.onEdit} onClose={() => setForm(null)} />}
      {column !== null && column.start !== undefined && (
        <p className="board-col__range">
          <Icon name="calendar-range" size={11} />
          {spanLabel({ from: column.start, to: column.due !== undefined && column.due > column.start ? column.due : column.start }, props.today)}
        </p>
      )}

      <div className="board-col__cards">
        {cards.map((card, index) => (
          <BoardCard
            key={card.path}
            card={card}
            today={props.today}
            selected={props.selected === card.path}
            dragging={props.dragging === card.path}
            dropBefore={dropIndex === index}
            onOpen={() => props.onOpenCard(card.path)}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', card.path)
              event.dataTransfer.effectAllowed = 'move'
              props.onDragStart(card.path)
            }}
            onDragEnd={props.onDragEnd}
            onDragOver={dragOver(index)}
            onDrop={drop(index)}
            onContextMenu={(event) => props.onCardMenu(event, card)}
          />
        ))}
        {dropIndex === cards.length && <div className="board-col__dropline" aria-hidden="true" />}
        {!known && <p className="board-col__note">Their status names no column. Drag a card to a column, or set its status.</p>}
        {known && total === 0 && dropIndex === null && <p className="board-col__note">No cards. + above adds one.</p>}
      </div>

      {menu.menu !== null && column !== null && <ContextMenu items={menuItems(column)} at={menu.menu.at} onClose={menu.close} />}
    </section>
  )
}

/** The column's WIP limit or date range, edited in place under its header. */
function ColumnForm({
  column,
  form,
  onSave,
  onClose,
}: {
  column: Column
  form: 'wip' | 'dates'
  onSave: (next: Column) => void
  onClose: () => void
}): React.ReactElement {
  const [wip, setWip] = useState(column.wip === undefined ? '' : String(column.wip))
  const [start, setStart] = useState(column.start ?? '')
  const [due, setDue] = useState(column.due ?? '')
  const backwards = form === 'dates' && start !== '' && due !== '' && start > due

  const save = (): void => {
    if (backwards) return
    const next: Column = { ...column }
    if (form === 'wip') {
      const n = Number(wip)
      if (wip.trim() !== '' && Number.isInteger(n) && n > 0) next.wip = n
      else delete next.wip
    } else {
      if (start !== '') next.start = start
      else delete next.start
      if (due !== '') next.due = due
      else delete next.due
    }
    onSave(next)
    onClose()
  }

  return (
    <form
      className="board-col__form"
      aria-label={form === 'wip' ? 'WIP limit' : 'Date range'}
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') onClose()
      }}
    >
      {form === 'wip' ? (
        <label className="board-field">
          <span>WIP limit</span>
          <input
            type="number"
            min={1}
            value={wip}
            placeholder="None"
            autoFocus
            aria-label="WIP limit"
            onChange={(e) => setWip(e.target.value)}
          />
        </label>
      ) : (
        <>
          <label className="board-field">
            <span>From</span>
            <input type="date" value={start} autoFocus aria-label="Column start" onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="board-field">
            <span>To</span>
            <input type="date" value={due} aria-label="Column end" onChange={(e) => setDue(e.target.value)} />
          </label>
          {backwards && <p className="board-field__error">The start is after the end.</p>}
        </>
      )}
      <div className="board-col__formacts">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn--sm" disabled={backwards}>
          Save
        </button>
      </div>
    </form>
  )
}
