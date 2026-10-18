import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isoDay, type Priority } from '@shared/card-fields'
import { IPC } from '@shared/ipc'
import {
  addLane,
  parseKanban,
  rectoSettings,
  removeLane,
  setLaneComplete,
  setLaneHeading,
  updateRecto,
  type RectoBoardSettings,
} from '@shared/kanban'
import { api } from '../../../app/api'
import { noteIndexChanged } from '../../../app/note-bus'
import { ContextMenu, useContextMenu, type MenuItem } from '../../../ui/ContextMenu'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { newColumnName, type Board, type Column } from '../boards'
import { filterCards, isSortKey, sortCards, SORTS, type CardView, type SortKey } from '../board-view'
import { takeNewCardRequest, useNewCardRequest } from '../boards-store'
import { CARD_FOLDER } from '../create-card'
import { useBoardCards, type Drop } from '../hooks/use-board-cards'
import { WidgetStrip } from '../widgets/WidgetStrip'
import { widgetsOf } from '../widgets/registry'
import { BoardColumn } from './BoardColumn'
import { CardPanel } from './CardPanel'
import { NewCardPopover } from './NewCardPopover'

const LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low', none: 'No priority' } as const

/**
 * The kanban board: a board note in the Obsidian Kanban format, drawn.
 *
 * The note says which columns there are, in what order, and which cards sit
 * in each, in order; a card is either a line of text or a link to a note in
 * tasks/, whose own frontmatter holds its priority, dates and tags. Every
 * change here is a change to one of those two files, never to anything else.
 */

type Props = {
  /** The board note. */
  path: string
  /** A card to open beside the board on arrival (from the graph). */
  card?: string | null
  onOpenNote: (path: string) => void
  /** The board note's Markdown, instead of the board. */
  onShowMarkdown?: () => void
}

/**
 * A lane's colour and dates, by title, in the settings block: `look` merged in
 * (an empty value drops its key), carried to `rename`, or dropped with the lane.
 * The block is left alone when nothing in it changes.
 */
function setLook(text: string, title: string, change: { look?: Record<string, string | undefined>; rename?: string; drop?: boolean }): string {
  const before = rectoSettings(parseKanban(text)).lanes ?? {}
  const lanes = { ...before }
  const current = lanes[title] ?? {}
  delete lanes[title]
  if (change.drop !== true) {
    const merged: Record<string, string | undefined> = { ...current, ...change.look }
    const clean = Object.fromEntries(Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== ''))
    if (Object.keys(clean).length > 0) lanes[change.rename ?? title] = clean
  }
  if (JSON.stringify(lanes) === JSON.stringify(before)) return text
  return updateRecto(text, { lanes: Object.keys(lanes).length > 0 ? lanes : undefined })
}

/** Where a drop at slot `at` of what the column shows lands in the column's file order, the moved card left out. */
function fileIndex(shown: readonly CardView[], at: number, moving: CardView | undefined, column: string): number {
  const others = shown.filter((card) => card.key !== moving?.key)
  const before = shown.slice(0, at).filter((card) => card.key !== moving?.key)
  const sameLane = moving !== undefined && moving.column === column
  const shift = (index: number): number => (sameLane && moving.index < index ? index - 1 : index)
  if (before.length < others.length) return shift(others[before.length]!.index)
  const last = others.at(-1)
  return last === undefined ? 0 : shift(last.index) + 1
}

export function BoardView({ path, card: openOnArrival = null, onOpenNote, onShowMarkdown }: Props): React.ReactElement {
  const { board, cards, error, notice, clearNotice, editBoard, editCard, move, addCard, makeNote, removeCard, renameCard } = useBoardCards(path)
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ column: string; at: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(openOnArrival)
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState<Priority | 'none' | null>(null)
  const [newCard, setNewCard] = useState<{ column: string; anchor: DOMRect | null; choose: boolean } | null>(null)
  const [deleting, setDeleting] = useState<Column | null>(null)
  const columnsRow = useRef<HTMLDivElement | null>(null)
  const root = useRef<HTMLDivElement | null>(null)
  const cardMenu = useContextMenu<CardView>()
  const sortMenu = useContextMenu<null>()
  const today = isoDay(new Date())

  useEffect(() => {
    if (openOnArrival !== null) setSelected(openOnArrival)
  }, [openOnArrival])

  const all = useMemo(() => cards ?? [], [cards])
  const sort: SortKey = isSortKey(board?.sort) ? board.sort : 'manual'
  const visible = useMemo(() => filterCards(all, { query, priority }), [all, query, priority])
  const columnCards = (id: string): CardView[] =>
    sortCards(
      visible.filter((card) => card.column === id),
      sort,
    )
  const totalOf = (id: string): number => all.filter((card) => card.column === id).length
  const open = selected === null ? undefined : all.find((card) => card.key === selected)

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

  // "New card" from the palette: the popover, with the column to choose.
  const request = useNewCardRequest()
  useEffect(() => {
    const first = board?.columns[0]
    if (first !== undefined && takeNewCardRequest()) setNewCard({ column: first.id, anchor: null, choose: true })
  }, [request, board?.columns])

  if (error !== null && board === null) {
    return (
      <div className="board">
        <p className="board__empty">Couldn't open this board: {error}</p>
      </div>
    )
  }
  if (board === null) return <div className="board" ref={root} />

  const recto = (patch: Partial<Record<keyof RectoBoardSettings, unknown>>): void => void editBoard((t) => updateRecto(t, patch))
  const widgets = widgetsOf(board)

  const editColumn = (column: Column, next: Column): void => {
    void editBoard((t) => {
      let out = t
      if (next.name !== column.name || next.wip !== column.wip) out = setLaneHeading(out, column.index, next.name, next.wip ?? null)
      out = setLook(out, column.name, { look: { color: next.color ?? '', start: next.start ?? '', due: next.due ?? '' }, rename: next.name })
      if (next.done === true && column.done !== true) {
        // One done lane: marking this one unmarks the other.
        for (const other of board.columns) if (other.done === true) out = setLaneComplete(out, other.index, false)
        out = setLaneComplete(out, column.index, true)
      } else if (next.done !== true && column.done === true) out = setLaneComplete(out, column.index, false)
      return out
    })
  }

  const addColumn = (): void => {
    const name = newColumnName(board.columns)
    void editBoard((t) => addLane(t, name)).then((ok) => {
      if (!ok) return
      setRenaming(String(board.columns.length))
      requestAnimationFrame(() => columnsRow.current?.scrollTo({ left: columnsRow.current.scrollWidth, behavior: 'smooth' }))
    })
  }

  const removeColumn = (column: Column): void => {
    // A column with cards asks where they go; an empty one just goes.
    if (totalOf(column.id) > 0) setDeleting(column)
    else void editBoard((t) => setLook(removeLane(t, column.index), column.name, { drop: true }))
  }

  const finishDrag = (): void => {
    setDragging(null)
    setDrop(null)
  }

  const moveTo = (key: string, column: string, at: number): void => {
    const card = all.find((c) => c.key === key)
    const shown = columnCards(column)
    const target: Drop = { column, index: fileIndex(shown, at, card, column) }
    void move(key, target)
  }

  const cardMenuItems = (card: CardView): MenuItem[] => [
    { kind: 'heading', label: 'This card' },
    ...(card.light
      ? [{ kind: 'item', label: 'Make it a note', icon: 'file-plus', run: () => void makeNote(card.key) } as MenuItem]
      : [
          { kind: 'item', label: 'Open as note', icon: 'file-text', run: () => onOpenNote(card.path) } as MenuItem,
          {
            kind: 'item',
            label: 'Copy relative path',
            icon: 'copy',
            run: () => void navigator.clipboard.writeText(card.path).catch(() => undefined),
          } as MenuItem,
          { kind: 'item', label: 'Reveal in Finder', icon: 'external-link', run: () => void api.invoke(IPC.fsReveal, card.path) } as MenuItem,
        ]),
    { kind: 'separator' },
    { kind: 'heading', label: 'Move to' },
    ...board.columns
      .filter((column) => column.id !== card.column)
      .map<MenuItem>((column) => ({
        kind: 'item',
        label: column.name,
        icon: 'arrow-right',
        run: () => void move(card.key, { column: column.id, index: Number.MAX_SAFE_INTEGER }),
      })),
    { kind: 'separator' },
    {
      kind: 'item',
      label: 'Remove from board',
      icon: 'x',
      run: () => {
        if (selected === card.key) setSelected(null)
        void removeCard(card.key)
      },
    },
    ...(card.light || card.path === ''
      ? []
      : [
          {
            kind: 'item',
            label: 'Move note to archive',
            icon: 'trash',
            danger: true,
            run: () => {
              if (selected === card.key) setSelected(null)
              void removeCard(card.key).then((ok) => {
                if (ok) void api.invoke(IPC.archiveAdd, card.path).then(() => noteIndexChanged())
              })
            },
          } as MenuItem,
        ]),
  ]

  const columnProps = (column: Column) => {
    const id = column.id
    return {
      column,
      today,
      selected,
      dragging,
      dropIndex: drop?.column === id ? drop.at : null,
      renaming: renaming === id,
      setRenaming: (on: boolean) => setRenaming(on ? id : null),
      onDragStart: (key: string) => setDragging(key),
      onDragEnd: finishDrag,
      onDragOver: (at: number) => setDrop({ column: id, at }),
      onDrop: (key: string, at: number) => {
        finishDrag()
        moveTo(key, id, at)
      },
      onOpenCard: setSelected,
      onCardMenu: (event: React.MouseEvent, card: CardView) => cardMenu.open(event, card),
      onNewCard: (anchor: DOMRect) => setNewCard({ column: id, anchor, choose: false }),
      onEdit: (next: Column) => editColumn(column, next),
      onDelete: () => removeColumn(column),
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
          <button
            className={`board__tool${priority === 'high' ? ' is-on' : ''}`}
            aria-pressed={priority === 'high'}
            onClick={() => setPriority(priority === 'high' ? null : 'high')}
          >
            High only
          </button>
          {priority !== null && priority !== 'high' && (
            <button className="board__tool is-on" aria-label={`${LEVEL_LABEL[priority]} only: clear`} onClick={() => setPriority(null)}>
              {LEVEL_LABEL[priority]} only
              <Icon name="x" size={12} />
            </button>
          )}
          <span className="board__spacer" />
          <button
            className={`board__tool${widgets.shown ? ' is-on' : ''}`}
            aria-pressed={widgets.shown}
            onClick={() => recto({ widgets: { ...widgets, shown: !widgets.shown } })}
          >
            <Icon name="grid-3x3" size={12} />
            Widgets
          </button>
          <button className="board__tool" aria-label="Sort" onClick={(event) => sortMenu.open(event, null)}>
            <Icon name="arrow-down-a-z" size={12} />
            {SORTS.find((s) => s.key === sort)!.label}
          </button>
          {onShowMarkdown !== undefined && (
            <Tip label="Show Markdown" hint="The board note as text">
              <button className="board__tool" aria-label="Show Markdown" onClick={onShowMarkdown}>
                <Icon name="file-code" size={12} />
                Markdown
              </button>
            </Tip>
          )}
        </div>

        {notice !== null && (
          <p className="board__notice" role="alert" onClick={clearNotice}>
            <Icon name="alert-triangle" size={13} />
            {notice}
          </p>
        )}

        {widgets.shown && (
          <WidgetStrip
            board={board}
            cards={all.filter((card) => !card.light)}
            today={today}
            priority={priority}
            onOpenCard={(cardPath) => setSelected(all.find((c) => c.path === cardPath)?.key ?? null)}
            onFilterPriority={(level) => setPriority(priority === level ? null : level)}
            onEditWidgets={(next) => recto({ widgets: next })}
          />
        )}

        <div className="board__columns" ref={columnsRow}>
          {board.columns.map((column) => (
            <BoardColumn key={column.id} {...columnProps(column)} cards={columnCards(column.id)} total={totalOf(column.id)} />
          ))}
          <button className="board__addcol" aria-label="Add column" title="Add column" onClick={addColumn}>
            <Icon name="plus" size={14} />
          </button>
        </div>

        {cards !== null && cards.length === 0 && board.columns.length > 0 && (
          <p className="board__empty">
            No cards on <strong>{board.name}</strong> yet. Every card you add is a real note in <code>{CARD_FOLDER}/</code>, linked from this board.
          </p>
        )}
        {board.columns.length === 0 && (
          <p className="board__empty">This board has no columns yet. Add one with + on the right.</p>
        )}
      </div>

      {open !== undefined && (
        <CardPanel
          key={open.key}
          board={board}
          card={open}
          editCard={editCard}
          move={move}
          onRename={async (name) => {
            const next = await renameCard(open.path, name)
            if (next !== null) setSelected(next)
          }}
          onMakeNote={async () => {
            const made = await makeNote(open.key)
            if (made !== null) setSelected(made)
          }}
          onOpenNote={onOpenNote}
          onClose={() => setSelected(null)}
        />
      )}

      {newCard !== null && (
        <NewCardPopover
          column={newCard.column}
          columns={newCard.choose ? board.columns : undefined}
          anchor={newCard.anchor}
          onAdd={addCard}
          onOpenExisting={(existing) => {
            setNewCard(null)
            const shown = all.find((card) => card.path === existing)
            if (shown !== undefined) setSelected(shown.key)
            else onOpenNote(existing)
          }}
          onClose={() => setNewCard(null)}
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
              run: () => recto({ sort: s.key === 'manual' ? undefined : s.key }),
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
            // The cards move first, one line at a time; the column goes once it is empty.
            for (const card of all.filter((c) => c.column === column.id)) await move(card.key, { column: target, index: Number.MAX_SAFE_INTEGER })
            await editBoard((t) => {
              const lane = parseKanban(t).lanes.findIndex((l, i) => i === column.index && l.title === column.name)
              return lane === -1 ? t : setLook(removeLane(t, lane), column.name, { drop: true })
            })
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
          It has {count} {count === 1 ? 'card' : 'cards'}. They stay on the board; choose the column they move to.
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

export type { Board }
