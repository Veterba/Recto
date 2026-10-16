import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isoDay } from '@shared/card-fields'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'
import { noteIndexChanged } from '../../../app/note-bus'
import { ContextMenu, useContextMenu, type MenuItem } from '../../../ui/ContextMenu'
import { Icon } from '../../../ui/Icon'
import { columnId, newColumnName, UNKNOWN_COLUMN, type Board, type Column } from '../boards'
import { filterCards, sortCards, SORTS, type CardView, type SortKey } from '../board-view'
import { CARD_FOLDER, createCard } from '../create-card'
import { useBoardCards, type Drop } from '../hooks/use-board-cards'
import { WidgetStrip } from '../widgets/WidgetStrip'
import { widgetsOf } from '../widgets/registry'
import { BoardColumn } from './BoardColumn'
import { CardPanel } from './CardPanel'

/**
 * The kanban board.
 *
 * A card IS a note. Its fields are frontmatter on that note (`board`,
 * `status`, `order`, `priority`, `start`, `due`, `tags`, `completed`), so the
 * board has no store of its own: it queries the index for cards, and every
 * change writes the keys it changes into that one file.
 *
 * Columns, their settings and the widgets are the exception and live in
 * `boards.json`, because an empty column has to be able to exist.
 */

type Props = {
  board: Board
  onOpenNote: (path: string) => void
  onEditBoard: (next: Board) => void
}

export function BoardView({ board, onOpenNote, onEditBoard }: Props): React.ReactElement {
  const { cards, error, clearError, reload, editCard, move } = useBoardCards(board)
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [highOnly, setHighOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('manual')
  const [deleting, setDeleting] = useState<Column | null>(null)
  const columnsRow = useRef<HTMLDivElement | null>(null)
  const root = useRef<HTMLDivElement | null>(null)
  const cardMenu = useContextMenu<CardView>()
  const sortMenu = useContextMenu<null>()
  const today = isoDay(new Date())
  const widgets = widgetsOf(board)

  const all = useMemo(() => cards ?? [], [cards])
  const visible = useMemo(() => filterCards(all, { query, highOnly }), [all, query, highOnly])
  const columnCards = (id: string): CardView[] =>
    sortCards(
      visible.filter((card) => card.column === id),
      sort,
    )
  const totalOf = (id: string): number => all.filter((card) => card.column === id).length
  const unknown = all.filter((card) => card.column === UNKNOWN_COLUMN)
  const open = selected === null ? undefined : all.find((card) => card.path === selected)

  // Esc closes the open card - from anywhere on this board or with nothing
  // focused, but not from a field, which has its own use for Esc.
  useEffect(() => {
    if (selected === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target as HTMLElement
      if (target.closest('input, select, textarea, [contenteditable="true"]') !== null) return
      if (target !== document.body && root.current?.contains(target) !== true) return
      event.preventDefault()
      setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const setColumns = (columns: Column[]): void => onEditBoard({ ...board, columns })

  const addColumn = (): void => {
    const name = newColumnName(board.columns)
    const id = columnId(name, board.columns)
    setColumns([...board.columns, { id, name }])
    setRenaming(id)
    requestAnimationFrame(() => columnsRow.current?.scrollTo({ left: columnsRow.current.scrollWidth, behavior: 'smooth' }))
  }

  const removeColumn = (column: Column): void => {
    // A column with cards asks where they go; an empty one just goes.
    if (totalOf(column.id) > 0) setDeleting(column)
    else setColumns(board.columns.filter((entry) => entry.id !== column.id))
  }

  const addCard = async (column: string, title: string): Promise<void> => {
    const created = await createCard(board.id, column, title)
    if (!created.ok) window.alert(created.error)
    reload()
  }

  const finishDrag = (): void => {
    setDragging(null)
    setDrop(null)
  }

  const cardMenuItems = (card: CardView): MenuItem[] => [
    { kind: 'heading', label: 'This card' },
    { kind: 'item', label: 'Open as note', icon: 'file-text', run: () => onOpenNote(card.path) },
    {
      kind: 'item',
      label: 'Copy relative path',
      icon: 'copy',
      run: () => void navigator.clipboard.writeText(card.path).catch(() => undefined),
    },
    { kind: 'item', label: 'Reveal in Finder', icon: 'external-link', run: () => void api.invoke(IPC.fsReveal, card.path) },
    { kind: 'separator' },
    { kind: 'heading', label: 'Move to' },
    ...board.columns
      .filter((column) => column.id !== card.column)
      .map<MenuItem>((column) => ({
        kind: 'item',
        label: column.name,
        icon: 'arrow-right',
        run: () => void move(card.path, { column: column.id, index: Number.MAX_SAFE_INTEGER }),
      })),
    { kind: 'separator' },
    {
      kind: 'item',
      label: 'Move to archive',
      icon: 'trash',
      danger: true,
      run: () => {
        if (selected === card.path) setSelected(null)
        void api.invoke(IPC.archiveAdd, card.path).then(() => {
          noteIndexChanged()
          reload()
        })
      },
    },
  ]

  const columnProps = (column: Column | null) => {
    const id = column?.id ?? UNKNOWN_COLUMN
    return {
      column,
      today,
      selected,
      dragging,
      dropIndex: drop?.column === id ? drop.index : null,
      renaming: renaming === id,
      setRenaming: (on: boolean) => setRenaming(on ? id : null),
      onDragStart: (path: string) => setDragging(path),
      onDragEnd: finishDrag,
      onDragOver: (index: number) => setDrop({ column: id, index }),
      onDrop: (path: string, index: number) => {
        finishDrag()
        void move(path, { column: id, index })
      },
      onOpenCard: setSelected,
      onCardMenu: (event: React.MouseEvent, card: CardView) => cardMenu.open(event, card),
      onAddCard: (title: string) => addCard(id, title),
      onEdit: (next: Column) => setColumns(board.columns.map((entry) => (entry.id === next.id ? next : entry))),
      onDelete: () => column !== null && removeColumn(column),
    }
  }

  return (
    <div className="board" ref={root}>
      <div className="board__main">
        <div className="board__toolbar">
          <h1 className="board__name">{board.name}</h1>
          <label className="board__filter">
            <Icon name="search" size={12} />
            <input
              value={query}
              placeholder="Filter cards"
              aria-label="Filter cards"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Escape') setQuery('')
              }}
            />
          </label>
          <button className={`board__tool${highOnly ? ' is-on' : ''}`} aria-pressed={highOnly} onClick={() => setHighOnly(!highOnly)}>
            High only
          </button>
          <span className="board__spacer" />
          <button
            className={`board__tool${widgets.shown ? ' is-on' : ''}`}
            aria-pressed={widgets.shown}
            onClick={() => onEditBoard({ ...board, widgets: { ...widgets, shown: !widgets.shown } })}
          >
            <Icon name="grid-3x3" size={12} />
            Widgets
          </button>
          <button className="board__tool" aria-label="Sort" onClick={(event) => sortMenu.open(event, null)}>
            <Icon name="arrow-down-a-z" size={12} />
            {SORTS.find((s) => s.key === sort)!.label}
          </button>
        </div>

        {error !== null && (
          <p className="board__error" role="alert" onClick={clearError}>
            {error}
          </p>
        )}

        {widgets.shown && <WidgetStrip board={board} cards={all} today={today} onOpenCard={setSelected} onEditBoard={onEditBoard} />}

        <div className="board__columns" ref={columnsRow}>
          {board.columns.map((column) => (
            <BoardColumn key={column.id} {...columnProps(column)} cards={columnCards(column.id)} total={totalOf(column.id)} />
          ))}
          {unknown.length > 0 && (
            <BoardColumn {...columnProps(null)} cards={sortCards(filterCards(unknown, { query, highOnly }), sort)} total={unknown.length} />
          )}
          <button className="board__addcol" aria-label="Add column" title="Add column" onClick={addColumn}>
            <Icon name="plus" size={14} />
          </button>
        </div>

        {cards !== null && cards.length === 0 && (
          <p className="board__empty">
            No cards on <strong>{board.name}</strong> yet. Every card you add is a real note in <code>{CARD_FOLDER}/</code>.
          </p>
        )}
      </div>

      {open !== undefined && (
        <CardPanel
          key={open.path}
          board={board}
          card={open}
          editCard={editCard}
          move={move}
          onOpenNote={onOpenNote}
          onClose={() => setSelected(null)}
        />
      )}

      {cardMenu.menu !== null && (
        <ContextMenu items={cardMenuItems(cardMenu.menu.subject)} at={cardMenu.menu.at} onClose={cardMenu.close} />
      )}
      {sortMenu.menu !== null && (
        <ContextMenu
          items={[
            { kind: 'heading', label: 'Sort cards by' },
            ...SORTS.map<MenuItem>((s) => ({
              kind: 'item',
              label: s.label,
              icon: s.key === sort ? 'check' : 'circle-dashed',
              run: () => setSort(s.key),
            })),
          ]}
          at={sortMenu.menu.at}
          onClose={sortMenu.close}
        />
      )}
      {deleting !== null && (
        <DeleteColumnDialog
          column={deleting}
          others={board.columns.filter((c) => c.id !== deleting.id)}
          count={totalOf(deleting.id)}
          onCancel={() => setDeleting(null)}
          onConfirm={async (target) => {
            const column = deleting
            setDeleting(null)
            // The cards move first, one note at a time; the column goes once they are out.
            for (const card of all.filter((c) => c.column === column.id))
              await move(card.path, { column: target, index: Number.MAX_SAFE_INTEGER })
            setColumns(board.columns.filter((entry) => entry.id !== column.id))
          }}
        />
      )}
    </div>
  )
}

/** Deleting a column that holds cards: where they go. Notes are never deleted. */
function DeleteColumnDialog({
  column,
  others,
  count,
  onCancel,
  onConfirm,
}: {
  column: Column
  others: Column[]
  count: number
  onCancel: () => void
  onConfirm: (target: string) => void
}): React.ReactElement {
  const [target, setTarget] = useState(others[0]?.id ?? '')
  return createPortal(
    <div
      className="dialog__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <form
        className="dialog"
        role="dialog"
        aria-label={`Delete ${column.name}`}
        onSubmit={(event) => {
          event.preventDefault()
          if (target !== '') onConfirm(target)
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') onCancel()
        }}
      >
        <h2 className="dialog__title">Delete “{column.name}”?</h2>
        <p className="dialog__lede">
          It has {count} {count === 1 ? 'card' : 'cards'}. They stay notes; choose the column they move to.
        </p>
        <label className="board-field">
          <span>Move them to</span>
          <select
            className="setting__select"
            value={target}
            autoFocus
            aria-label="Move cards to"
            onChange={(e) => setTarget(e.target.value)}
          >
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <footer className="dialog__actions">
          <button type="button" className="dialog__ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="dialog__submit dialog__submit--danger" disabled={target === ''}>
            Move cards and delete
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}
