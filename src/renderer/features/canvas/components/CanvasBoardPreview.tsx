import { useRef, useState } from 'react'
import { isoDay } from '@shared/card-fields'
import { addLane } from '@shared/kanban'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'
import { noteIndexChanged } from '../../../app/note-bus'
import { ContextMenu, useContextMenu, type MenuItem } from '../../../ui/ContextMenu'
import { Icon } from '../../../ui/Icon'
import { PriorityLabel } from '../../boards/components/BoardCard'
import { useBoardCards } from '../../boards/hooks/use-board-cards'
import { doneColumn, newColumnName, renameColumnIn, type Column } from '../../boards/boards'
import { dueState, fileIndex, spanLabel, type CardView } from '../../boards/board-view'
import { useCanvasActions } from '../canvas-actions'

/** A chip dragged in a board preview: its board and key. Not the board view's type, so neither takes the other's. */
const CARD_DRAG = 'application/x-recto-canvas-card'

/**
 * A board on the canvas: the board itself, drawn for the canvas. Its lanes
 * side by side while the node is wide, under one another when it is narrow,
 * each with every card - priority, title, dates, checklist - and scrolling
 * when they are many. It is changed the way the board changes it, through the
 * same hook on the same note (use-board-cards.ts), so the board's tab, the
 * card's note and this preview are one thing:
 *
 * - a chip is dragged to another lane or place, and lands where the board
 *   would put it (Done ticks it); chips are `nodrag`, so it never moves the
 *   node or the canvas;
 * - a click opens the card beside the canvas; right-click has the board's
 *   menu; a double-click on its title renames it (its note, or its line);
 * - a lane's + adds a task, named in place; a double-click on its name
 *   renames it; "+ Column" adds one, named at once.
 */
export function BoardPreview({
  path,
  onScroll,
  far = false,
}: {
  path: string
  onScroll: (ev: React.WheelEvent<HTMLElement>) => void
  /** Zoomed far out: each lane its name and count only, no cards - light to draw, and too small to read anyway. */
  far?: boolean
}): React.ReactElement {
  const actions = useCanvasActions()
  const { board, cards, editBoard, move, addCard, addExisting, removeCard, renameCard, setCardText } = useBoardCards(path)
  const today = isoDay(new Date())
  /** The lane a task is being named in. */
  const [adding, setAdding] = useState<string | null>(null)
  /** What came of the last try; `use` - notes of the name to use instead, `title` - the name, for a new one anyway. */
  const [said, setSaid] = useState<{ lane: string; text: string; use?: string[]; title?: string } | null>(null)
  /** The chip being dragged, and the lane and slot it would land in. */
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<{ lane: string; at: number } | null>(null)
  /** What is being renamed in place: a card (by key) or a lane (by id). */
  const [renaming, setRenaming] = useState<{ card: string } | { lane: string } | null>(null)
  const cardMenu = useContextMenu<CardView>()

  const folderName = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : 'the vault’s top level')
  const add = async (lane: string, title: string, anyway = false): Promise<void> => {
    if (title.trim() === '') return setAdding(null)
    const made = await addCard(lane, title.trim(), anyway)
    if (made.ok) {
      setAdding(null)
      setSaid(null)
    } else if ('here' in made) {
      // One note of a name per folder, as in Obsidian: this board's folder has it.
      setSaid({ lane, text: `“${title.trim()}” is already in this board’s folder.`, use: [made.here] })
    } else if ('elsewhere' in made) {
      // Other folders have it: a new card here, or one of those (its file stays where it is).
      const text =
        made.elsewhere.length === 1
          ? `“${title.trim()}” is already a note, in ${folderName(made.elsewhere[0]!)}.`
          : `${made.elsewhere.length} notes are called “${title.trim()}”.`
      setSaid({ lane, text, use: made.elsewhere, title: title.trim() })
    } else setSaid({ lane, text: made.error })
  }
  if (board === null || cards === null) return <div className="canvas-board" />
  const done = doneColumn(board.columns)

  const endDrag = (): void => {
    setDragging(null)
    setOver(null)
  }
  const dragOver = (lane: string, at: number) => (ev: React.DragEvent) => {
    if (!ev.dataTransfer.types.includes(CARD_DRAG)) return
    ev.preventDefault()
    ev.stopPropagation()
    ev.dataTransfer.dropEffect = 'move'
    if (over?.lane !== lane || over.at !== at) setOver({ lane, at })
  }
  const drop = (lane: string, at: number) => (ev: React.DragEvent) => {
    const raw = ev.dataTransfer.getData(CARD_DRAG)
    if (raw === '') return
    ev.preventDefault()
    ev.stopPropagation()
    endDrag()
    const dragged = JSON.parse(raw) as { board: string; key: string }
    // A chip from another board on this canvas stays on its own board.
    if (dragged.board !== path) return
    const card = cards.find((c) => c.key === dragged.key)
    void move(dragged.key, {
      column: lane,
      index: fileIndex(
        cards.filter((c) => c.column === lane),
        at,
        card,
        lane,
      ),
    })
  }

  const renameCardTo = (card: CardView, name: string | null): void => {
    setRenaming(null)
    if (name === null || name.trim() === '' || name.trim() === card.title) return
    void (card.light ? setCardText(card.key, name) : renameCard(card.path, name))
  }
  const renameLaneTo = (column: Column, name: string | null): void => {
    setRenaming(null)
    if (name === null || name.trim() === '' || name.trim() === column.name) return
    void editBoard((t) => renameColumnIn(t, column, name.trim()))
  }
  const addColumn = (): void => {
    const name = newColumnName(board.columns)
    // Named at once, as the board names a new column.
    void editBoard((t) => addLane(t, name)).then((ok) => ok && setRenaming({ lane: String(board.columns.length) }))
  }

  // The board's own menu for a card, as far as it makes sense beside a canvas.
  const menuOf = (card: CardView): MenuItem[] => [
    { kind: 'heading', label: 'This card' },
    ...(card.light ? [] : [{ kind: 'item', label: 'Open', icon: 'file-text', run: () => actions.openFile(card.path) } as MenuItem]),
    { kind: 'item', label: 'Rename', icon: 'pencil', run: () => setRenaming({ card: card.key }) },
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
    { kind: 'item', label: 'Remove from board', icon: 'x', run: () => void removeCard(card.key) },
    ...(card.light || card.path === ''
      ? []
      : [
          {
            kind: 'item',
            label: 'Move note to archive',
            icon: 'trash',
            danger: true,
            run: () =>
              void removeCard(card.key).then((ok) => {
                if (ok) void api.invoke(IPC.archiveAdd, card.path).then(() => noteIndexChanged())
              }),
          } as MenuItem,
        ]),
  ]

  return (
    <div className="canvas-board">
      {board.columns.map((column) => {
        const here = cards.filter((c) => c.column === column.id)
        const isDone = column.id === done
        return (
          <section
            key={column.id}
            className={`canvas-board__lane${isDone ? ' is-done' : ''}${over?.lane === column.id ? ' is-target' : ''}`}
            data-color={column.color}
            aria-label={column.name}
            onDragOver={dragOver(column.id, here.length)}
            onDragLeave={(ev) => {
              if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setOver((now) => (now?.lane === column.id ? null : now))
            }}
            onDrop={drop(column.id, here.length)}
          >
            <header className="canvas-board__head">
              <span className="canvas-board__dot" />
              {renaming !== null && 'lane' in renaming && renaming.lane === column.id ? (
                <InlineName
                  value={column.name}
                  label="Column name"
                  className="canvas-board__name-input"
                  onDone={(name) => renameLaneTo(column, name)}
                />
              ) : (
                <span
                  className="canvas-board__name nodrag"
                  title="Double-click to rename"
                  onDoubleClick={(ev) => (ev.stopPropagation(), setRenaming({ lane: column.id }))}
                >
                  {column.name}
                </span>
              )}
              <button
                className="canvas-board__add nodrag"
                aria-label={`Add a task to ${column.name}`}
                onClick={() => {
                  setSaid(null)
                  setAdding(column.id)
                }}
              >
                <Icon name="plus" size={13} />
              </button>
              <span className="canvas-board__count">{here.length}</span>
            </header>
            {adding === column.id && (
              <input
                className="canvas-board__new nodrag"
                aria-label={`New task in ${column.name}`}
                placeholder="Task name"
                autoFocus
                onKeyDown={(ev) => {
                  ev.stopPropagation()
                  if (ev.key === 'Enter') void add(column.id, ev.currentTarget.value)
                  if (ev.key === 'Escape') setAdding(null)
                }}
                onBlur={(ev) => ev.currentTarget.value.trim() === '' && setAdding(null)}
              />
            )}
            {said !== null && said.lane === column.id && (
              <div className="canvas-board__said" role="status">
                <p>{said.text}</p>
                {said.use !== undefined && (
                  <div className="canvas-board__choices">
                    {said.title !== undefined && (
                      <button className="btn btn--sm btn--primary nodrag" onClick={() => void add(column.id, said.title!, true)}>
                        Create a new “{said.title}” here
                      </button>
                    )}
                    {said.use.map((p) => (
                      <button
                        key={p}
                        className="btn btn--sm nodrag"
                        title={p}
                        onClick={() => {
                          void addExisting(column.id, p).then(() => {
                            setSaid(null)
                            setAdding(null)
                          })
                        }}
                      >
                        {said.title === undefined ? 'Add it to this board' : `Use the one in ${folderName(p)}`}
                      </button>
                    ))}
                    {said.title === undefined && (
                      <button className="btn btn--ghost btn--sm nodrag" onClick={() => setSaid(null)}>
                        Choose another name
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {!far && (
              <ul className="canvas-board__cards nowheel" onWheelCapture={onScroll}>
                {here.map((card, index) => (
                  <li
                    key={card.key}
                    className={`canvas-board__card nodrag${dragging === card.key ? ' is-dragging' : ''}${over?.lane === column.id && over.at === index ? ' is-drop-before' : ''}`}
                    draggable={!(renaming !== null && 'card' in renaming && renaming.card === card.key)}
                    onDragStart={(ev) => {
                      ev.stopPropagation()
                      ev.dataTransfer.setData(CARD_DRAG, JSON.stringify({ board: path, key: card.key }))
                      ev.dataTransfer.effectAllowed = 'move'
                      setDragging(card.key)
                    }}
                    onDragEnd={endDrag}
                    onDragOver={dragOver(column.id, index)}
                    onDrop={drop(column.id, index)}
                    onContextMenu={(ev) => cardMenu.open(ev, card)}
                  >
                    {renaming !== null && 'card' in renaming && renaming.card === card.key ? (
                      <InlineName
                        value={card.title}
                        label="Card name"
                        className="canvas-board__title-input"
                        onDone={(name) => renameCardTo(card, name)}
                      />
                    ) : (
                      <Chip
                        card={card}
                        today={today}
                        onOpen={() => actions.openFile(card.path)}
                        onRename={() => setRenaming({ card: card.key })}
                      />
                    )}
                  </li>
                ))}
                {over?.lane === column.id && over.at === here.length && <li className="canvas-board__dropline" aria-hidden="true" />}
                {here.length === 0 && adding !== column.id && <li className="canvas-board__empty">No cards</li>}
              </ul>
            )}
          </section>
        )
      })}
      {!far && (
        <button className="canvas-board__add-column nodrag" onClick={addColumn}>
          <Icon name="plus" size={13} />
          Column
        </button>
      )}
      {cardMenu.menu !== null && <ContextMenu items={menuOf(cardMenu.menu.subject)} at={cardMenu.menu.at} onClose={cardMenu.close} />}
    </div>
  )
}

/** One card in a lane: its title, priority, dates and checklist; a click opens it, a double-click on the title renames it. */
function Chip({
  card,
  today,
  onOpen,
  onRename,
}: {
  card: CardView
  today: string
  onOpen: () => void
  onRename: () => void
}): React.ReactElement {
  const state = dueState(card.span, today)
  const { done, total } = card.checklist
  // A click opens the card a moment later, so a double-click on the title renames it without opening it first.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const later = (): void => {
    if (pending.current !== null) clearTimeout(pending.current)
    pending.current = setTimeout(onOpen, 250)
  }
  return (
    <button
      className="canvas-board__open nodrag"
      onClick={(ev) => !card.light && ev.detail <= 1 && later()}
      title={card.light ? 'Double-click to edit' : 'Open the card'}
    >
      <span
        className="canvas-board__title"
        onDoubleClick={(ev) => {
          ev.stopPropagation()
          if (pending.current !== null) clearTimeout(pending.current)
          onRename()
        }}
      >
        {card.title}
      </span>
      {(card.level !== null || card.span !== null || total > 0) && (
        <span className="canvas-board__meta">
          {card.level !== null && <PriorityLabel card={card} />}
          {card.span !== null && (
            <span className={`board-card__when${state === null ? '' : ` is-${state}`}`}>
              <Icon name="calendar" size={10} />
              {spanLabel(card.span, today)}
            </span>
          )}
          {total > 0 && (
            <span className="canvas-board__progress" title={`${done} of ${total} checked`}>
              <Icon name="check" size={10} />
              {done}/{total}
            </span>
          )}
        </span>
      )}
    </button>
  )
}

/** A name edited in place: Enter or leaving keeps it, Escape leaves it as it was. */
function InlineName({
  value,
  label,
  className,
  onDone,
}: {
  value: string
  label: string
  className: string
  onDone: (name: string | null) => void
}): React.ReactElement {
  // Enter, then the blur that follows it: one rename, not two.
  const finished = useRef(false)
  const finish = (name: string | null): void => {
    if (finished.current) return
    finished.current = true
    onDone(name)
  }
  return (
    <input
      className={`${className} nodrag`}
      aria-label={label}
      defaultValue={value}
      autoFocus
      onFocus={(ev) => ev.currentTarget.select()}
      onClick={(ev) => ev.stopPropagation()}
      onKeyDown={(ev) => {
        ev.stopPropagation()
        if (ev.key === 'Enter') finish(ev.currentTarget.value)
        if (ev.key === 'Escape') finish(null)
      }}
      onBlur={(ev) => finish(ev.currentTarget.value)}
    />
  )
}
