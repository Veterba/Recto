import { useEffect, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { addDays, isoDay, setCardField } from '@shared/card-fields'
import { Icon } from '../../../ui/Icon'
import type { MenuItem } from '../../../ui/ContextMenu'
import { boardOfCard } from '../../boards'
import { PriorityLabel } from '../../boards/components/BoardCard'
import { useBoardCards } from '../../boards/hooks/use-board-cards'
import { doneColumn } from '../../boards/boards'
import { dueState, fileIndex, spanLabel } from '../../boards/board-view'
import type { FlowNode } from '../canvas-flow'
import { useCanvasActions } from '../canvas-actions'
import { Frame } from './CanvasNodes'

/**
 * Boards and their cards on a canvas.
 *
 * A card is drawn the way its board draws it - status, priority, dates - and
 * changed the way its board changes it: the same hook, so marking it done or
 * moving it to a lane writes the board note (and the card's note) exactly as
 * dragging it on the board would. A board shows its lanes and how full each is.
 */

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

export function CardNode(props: NodeProps<FlowNode>): React.ReactElement {
  const actions = useCanvasActions()
  const node = props.data.node
  const path = node.file ?? ''
  const board = boardOfCard(path) ?? ''
  const { board: shown, cards, move, editCard } = useBoardCards(board)
  const card = cards?.find((c) => c.path === path) ?? null
  const column = shown?.columns.find((c) => c.id === card?.column) ?? null
  const done = shown === null ? null : doneColumn(shown.columns)
  const today = isoDay(new Date())

  // What its board's menu has for it: where it can go, its priority, its due date.
  useEffect(() => {
    if (card === null || shown === null) return actions.registerMenu(node.id, null)
    const items: MenuItem[] = [
      { kind: 'heading', label: `On “${nameOf(board)}”` },
      ...(done !== null && card.column !== done
        ? [
            {
              kind: 'item',
              label: 'Mark done',
              icon: 'check',
              run: () => void move(card.key, { column: done, index: Number.MAX_SAFE_INTEGER }),
            } as MenuItem,
          ]
        : []),
      ...shown.columns
        .filter((c) => c.id !== card.column)
        .map<MenuItem>((c) => ({
          kind: 'item',
          label: `Move to ${c.name}`,
          icon: 'arrow-right',
          run: () => void move(card.key, { column: c.id, index: Number.MAX_SAFE_INTEGER }),
        })),
      { kind: 'separator' },
      ...(['high', 'medium', 'low'] as const).map<MenuItem>((level) => ({
        kind: 'item',
        label: `Priority ${level}`,
        icon: card.level === level ? 'check' : 'minus',
        run: () => void editCard(card.path, (t) => setCardField(t, 'priority', level)),
      })),
      { kind: 'item', label: 'Due today', icon: 'calendar', run: () => void editCard(card.path, (t) => setCardField(t, 'due', today)) },
      {
        kind: 'item',
        label: 'Due tomorrow',
        icon: 'calendar',
        run: () => void editCard(card.path, (t) => setCardField(t, 'due', addDays(today, 1))),
      },
      ...(card.due !== null
        ? [
            {
              kind: 'item',
              label: 'No due date',
              icon: 'x',
              run: () => void editCard(card.path, (t) => setCardField(t, 'due', null)),
            } as MenuItem,
          ]
        : []),
      { kind: 'separator' },
    ]
    actions.registerMenu(node.id, items)
    return () => actions.registerMenu(node.id, null)
  }, [actions, node.id, card, shown, done, board, move, editCard, today])

  const state = card === null ? null : dueState(card.span, today)
  return (
    <Frame props={props} className={`canvas-node--card${card !== null && card.column === done ? ' is-done' : ''}`}>
      {/* Double-clicked anywhere, the card opens beside the canvas, as on its board. */}
      <div className="canvas-card" onDoubleClick={() => actions.openFile(path)}>
        <header className="canvas-note__title">
          <Icon name={card !== null && card.column === done ? 'check' : 'square-kanban'} size={13} />
          <span>{column?.name ?? 'Card'}</span>
        </header>
        <div className="canvas-node__body canvas-card">
          {card !== null && (
            <div className="canvas-card__top">
              <PriorityLabel card={card} />
              {card.span !== null && (
                <span className={`board-card__when${state === null ? '' : ` is-${state}`}`}>
                  <Icon name="calendar" size={11} />
                  {spanLabel(card.span, today)}
                </span>
              )}
            </div>
          )}
          <p className="canvas-card__title">{card?.title ?? nameOf(path)}</p>
          {card !== null && card.description !== '' && <p className="canvas-card__text">{card.description}</p>}
        </div>
      </div>
    </Frame>
  )
}

/** How many cards a lane shows on the canvas before "+N more". */
const LANE_CARDS = 6
/** A chip dragged in a board preview: its board and key. Not the board view's type, so neither takes the other's. */
const CARD_DRAG = 'application/x-recto-canvas-card'

/**
 * A board on the canvas: a preview made for the canvas, not its page. Its
 * lanes side by side while the node is wide, under one another when it is
 * narrow; each with its first cards as chips - priority, title, dates - and
 * how many more. A click on a chip opens the card beside the canvas. A lane's + adds a task to it, named in place, as the board adds one.
 * A chip is dragged to another lane or another place in its own, and lands
 * where the board would put it (the same move, so Done ticks it); the chips
 * are `nodrag`, so dragging one never moves the node or the canvas.
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
  const { board, cards, move, addCard, addExisting } = useBoardCards(path)
  const today = isoDay(new Date())
  /** The lane a task is being named in, and what came of the last try. */
  const [adding, setAdding] = useState<string | null>(null)
  /** What came of the last try; `use` - notes of the name to use instead, `title` - the name, for a new one anyway. */
  const [said, setSaid] = useState<{ lane: string; text: string; use?: string[]; title?: string } | null>(null)
  /** The chip being dragged, and the lane and slot it would land in. */
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<{ lane: string; at: number } | null>(null)
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
      const text = made.elsewhere.length === 1 ? `“${title.trim()}” is already a note, in ${folderName(made.elsewhere[0]!)}.` : `${made.elsewhere.length} notes are called “${title.trim()}”.`
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
    void move(dragged.key, { column: lane, index: fileIndex(cards.filter((c) => c.column === lane), at, card, lane) })
  }
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
            onDragOver={dragOver(column.id, here.length)}
            onDragLeave={(ev) => {
              if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setOver((now) => (now?.lane === column.id ? null : now))
            }}
            onDrop={drop(column.id, here.length)}
          >
            <header className="canvas-board__head">
              <span className="canvas-board__dot" />
              <span className="canvas-board__name">{column.name}</span>
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
              <ul className="canvas-board__cards" onWheelCapture={onScroll}>
                {here.slice(0, LANE_CARDS).map((card, index) => {
                  const state = dueState(card.span, today)
                  return (
                    <li
                      key={card.key}
                      className={`canvas-board__card nodrag${dragging === card.key ? ' is-dragging' : ''}${over?.lane === column.id && over.at === index ? ' is-drop-before' : ''}`}
                      draggable
                      onDragStart={(ev) => {
                        ev.stopPropagation()
                        ev.dataTransfer.setData(CARD_DRAG, JSON.stringify({ board: path, key: card.key }))
                        ev.dataTransfer.effectAllowed = 'move'
                        setDragging(card.key)
                      }}
                      onDragEnd={endDrag}
                      onDragOver={dragOver(column.id, index)}
                      onDrop={drop(column.id, index)}
                    >
                      <button
                        className="canvas-board__open nodrag"
                        disabled={card.light}
                        onClick={() => actions.openFile(card.path)}
                        title={card.light ? undefined : 'Open the card'}
                      >
                        <span className="canvas-board__title">{card.title}</span>
                        {(card.level !== null || card.span !== null) && (
                          <span className="canvas-board__meta">
                            {card.level !== null && <PriorityLabel card={card} />}
                            {card.span !== null && (
                              <span className={`board-card__when${state === null ? '' : ` is-${state}`}`}>
                                <Icon name="calendar" size={10} />
                                {spanLabel(card.span, today)}
                              </span>
                            )}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
                {over?.lane === column.id && over.at === here.length && <li className="canvas-board__dropline" aria-hidden="true" />}
                {here.length > LANE_CARDS && <li className="canvas-board__more">+{here.length - LANE_CARDS} more</li>}
                {here.length === 0 && adding !== column.id && <li className="canvas-board__empty">No cards</li>}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
