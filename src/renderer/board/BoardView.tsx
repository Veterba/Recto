import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BoardCardInfo } from '@shared/ipc-contract'
import { api } from '../api'
import { ContextMenu, useContextMenu, type MenuItem } from '../components/ContextMenu'
import { Icon } from '../components/Icon'
import { Tip } from '../components/Tip'
import { setField } from '../core/frontmatter'
import { noteIndexChanged, useNoteBus } from '../core/note-bus'
import { registerView } from '../core/view-registry'
import { columnId, columnOf, type Board, type Column } from './boards'
import { CARD_FOLDER, createCard } from './create-card'
import { placeAt, sortColumn } from './ordering'
import { currentBoards, updateBoards, useBoards } from './use-boards'

/**
 * The kanban board.
 *
 * A card IS a note. `board`, `status` and `order` are frontmatter on that note,
 * so the board has no store of its own: it queries the property index for
 * cards, and a drag writes one field into one file. That is why clicking a card
 * opens the ordinary editor - there is nothing else to open.
 *
 * Columns are the exception and live in `boards.json`, because an empty column
 * has to be able to exist. Deriving columns from the statuses present in the
 * vault would delete "Done" the moment you dragged the last card out of it.
 */

/** How long to trust our own write over what the index says. */
const OVERRIDE_TTL_MS = 15_000

type Props = {
  board: Board
  onOpenNote: (path: string) => void
  onEditBoard: (next: Board) => void
}

type Card = BoardCardInfo & { column: string }

/** A drag in flight: which card, and where it would land. */
type Drop = { column: string; index: number }

export function BoardView({ board, onOpenNote, onEditBoard }: Props): React.ReactElement {
  const [cards, setCards] = useState<Card[] | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { revision } = useNoteBus()
  const contextMenu = useContextMenu<Card>()

  /**
   * Cards we have written but the index has not caught up with yet.
   *
   * A drag writes a file; the indexer sees it a moment later. Reloading in
   * between hands back the OLD status and the card snaps back to the column it
   * came from - which is exactly what happened the first time this ran. So a
   * write records what it expects, every reload re-applies it, and the entry is
   * dropped the moment the index agrees (or after a timeout, so a write that
   * silently failed cannot pin the board to a lie forever).
   */
  const overrides = useRef(new Map<string, { status: string | null; order: number; at: number }>())

  const load = useCallback(() => {
    void api.invoke('index:board', board.id).then((rows) => {
      const now = Date.now()
      const next = rows.map((row) => {
        const pending = overrides.current.get(row.path)
        if (pending === undefined) return { ...row, column: columnOf(row.status, board.columns) }
        if (row.status === pending.status && row.order === pending.order) {
          overrides.current.delete(row.path)
          return { ...row, column: columnOf(row.status, board.columns) }
        }
        if (now - pending.at > OVERRIDE_TTL_MS) {
          overrides.current.delete(row.path)
          return { ...row, column: columnOf(row.status, board.columns) }
        }
        return {
          ...row,
          status: pending.status,
          order: pending.order,
          column: columnOf(pending.status, board.columns),
        }
      })
      setCards(next)
    })
  }, [board.id, board.columns])

  useEffect(() => {
    load()
    // The indexer is a process behind. A second pass a moment later picks up
    // whatever it has since seen and retires the optimistic override, instead
    // of leaving it to time out.
    const timer = window.setTimeout(load, 1200)
    return () => window.clearTimeout(timer)
  }, [load, revision])

  const byColumn = useMemo(() => {
    const out = new Map<string, Card[]>(board.columns.map((column) => [column.id, []]))
    for (const card of cards ?? []) out.get(card.column)?.push(card)
    for (const [id, list] of out) out.set(id, sortColumn(list))
    return out
  }, [cards, board.columns])

  // --- writing ------------------------------------------------------------

  /** Apply frontmatter edits to a note, leaving everything else untouched. */
  const writeFields = useCallback(
    async (path: string, fields: Record<string, string | number>): Promise<boolean> => {
      const read = await api.invoke('fs:read', path)
      if (!read.ok) {
        setError(read.error)
        return false
      }
      let text = read.content
      for (const [key, value] of Object.entries(fields)) text = setField(text, key, value)
      const written = await api.invoke('fs:write', path, text)
      if (!written.ok) setError(written.error ?? 'Could not save the card.')
      return written.ok
    },
    [],
  )

  const move = useCallback(
    async (path: string, target: Drop) => {
      const card = cards?.find((entry) => entry.path === path)
      if (card === undefined) return

      // The column as it will be WITHOUT the card being moved, which is what
      // the drop index refers to.
      const column = (byColumn.get(target.column) ?? []).filter((entry) => entry.path !== path)
      const orders = column.map((entry) => entry.order).filter((order): order is number => order !== null)
      const index = Math.max(0, Math.min(orders.length, target.index))
      const placed = placeAt(orders, index)

      // Optimistic: the board moves now, the file catches up. A kanban that
      // waits for a disk write and a reindex before the card moves feels broken.
      const order = placed.kind === 'order' ? placed.order : placed.orders[index]!
      setCards((prev) =>
        (prev ?? []).map((entry) =>
          entry.path === path ? { ...entry, column: target.column, status: target.column, order } : entry,
        ),
      )

      overrides.current.set(path, { status: target.column, order, at: Date.now() })
      await writeFields(path, { status: target.column, order })

      if (placed.kind === 'renumber') {
        // The gap between two cards got too small to halve. Rewrite the whole
        // column once - the only time this board touches more than one file for
        // one gesture.
        const rest = [...column]
        rest.splice(index, 0, { ...card, order })
        for (const [position, entry] of rest.entries()) {
          const next = placed.orders[position]!
          if (entry.path === path || entry.order === next) continue
          // Only `order` is written for these, so the override has to claim the
          // status the file already has, or it would never agree with the index.
          overrides.current.set(entry.path, { status: entry.status, order: next, at: Date.now() })
          await writeFields(entry.path, { order: next })
        }
        setCards((prev) => (prev ?? []).map((entry) => {
          const pending = overrides.current.get(entry.path)
          return pending === undefined ? entry : { ...entry, order: pending.order }
        }))
      }

      noteIndexChanged()
    },
    [cards, byColumn, writeFields],
  )

  const addCard = useCallback(
    async (column: string, title: string) => {
      setAdding(null)
      if (title.trim() === '') return
      const created = await createCard(board.id, column, title)
      if (!created.ok) setError(created.error)
      load()
    },
    [board.id, load],
  )

  // --- columns ------------------------------------------------------------

  const setColumns = (columns: Column[]): void => onEditBoard({ ...board, columns })

  const addColumn = (name: string): void => {
    const trimmed = name.trim()
    if (trimmed === '') return
    setColumns([...board.columns, { id: columnId(trimmed, board.columns), name: trimmed }])
  }

  const removeColumn = (id: string): void => {
    if (board.columns.length <= 1) return
    // The cards keep their `status`. They reappear in the first column, because
    // that is where an unrecognised status lands - nothing is lost, and putting
    // the column back puts them back.
    setColumns(board.columns.filter((column) => column.id !== id))
  }

  /** Right-click on a card. A card is a note, so the note actions apply. */
  const menuFor = (card: Card): MenuItem[] => [
    { kind: 'heading', label: 'This card' },
    { kind: 'item', label: 'Open', icon: 'file-text', run: () => onOpenNote(card.path) },
    {
      kind: 'item',
      label: 'Copy relative path',
      icon: 'copy',
      run: () => void navigator.clipboard.writeText(card.path).catch(() => undefined),
    },
    {
      kind: 'item',
      label: 'Reveal in Finder',
      icon: 'external-link',
      run: () => void api.invoke('fs:reveal', card.path),
    },
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
        void api.invoke('archive:add', card.path).then(() => {
          noteIndexChanged()
          load()
        })
      },
    },
  ]

  // --- rendering ----------------------------------------------------------

  const onDropInto = (column: string, index: number) => (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const path = event.dataTransfer.getData('text/plain')
    setDragging(null)
    setDrop(null)
    if (path !== '') void move(path, { column, index })
  }

  const allowDrop = (column: string, index: number) => (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    if (drop?.column !== column || drop.index !== index) setDrop({ column, index })
  }

  return (
    <div className="board">
      {error !== null && (
        <p className="board__error" role="alert" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <div className="board__columns">
        {board.columns.map((column) => {
          const list = byColumn.get(column.id) ?? []
          return (
            <section
              className={`board__col${drop?.column === column.id ? ' is-target' : ''}`}
              key={column.id}
              onDragOver={allowDrop(column.id, list.length)}
              onDrop={onDropInto(column.id, list.length)}
            >
              <header className="board__colhead">
                {renaming === column.id ? (
                  <input
                    className="board__rename"
                    defaultValue={column.name}
                    autoFocus
                    onBlur={(event) => {
                      setRenaming(null)
                      const name = event.target.value.trim()
                      if (name !== '' && name !== column.name) {
                        // The id is left alone on rename: it is what the notes
                        // say, and rewriting it would mean editing every card.
                        setColumns(
                          board.columns.map((entry) => (entry.id === column.id ? { ...entry, name } : entry)),
                        )
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <button className="board__colname" onDoubleClick={() => setRenaming(column.id)}>
                    {column.name}
                  </button>
                )}
                <span className="board__count">{list.length}</span>
                {board.columns.length > 1 && (
                  <Tip label="Remove column" hint="Its cards move to the first column">
                    <button
                      className="board__colremove"
                      aria-label={`Remove ${column.name}`}
                      onClick={() => removeColumn(column.id)}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </Tip>
                )}
              </header>

              <div className="board__cards">
                {list.map((card, index) => (
                  <article
                    className={`board__card${dragging === card.path ? ' is-dragging' : ''}${
                      drop?.column === column.id && drop.index === index ? ' is-before' : ''
                    }`}
                    key={card.path}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', card.path)
                      event.dataTransfer.effectAllowed = 'move'
                      setDragging(card.path)
                    }}
                    onDragEnd={() => {
                      setDragging(null)
                      setDrop(null)
                    }}
                    onDragOver={allowDrop(column.id, index)}
                    onDrop={onDropInto(column.id, index)}
                    onClick={() => onOpenNote(card.path)}
                    onContextMenu={(event) => contextMenu.open(event, card)}
                  >
                    <h3 className="board__title">{card.title}</h3>
                    {(card.due !== null || card.priority !== null) && (
                      <p className="board__meta">
                        {card.priority !== null && (
                          <span className={`board__pri board__pri--${card.priority.toLowerCase()}`}>
                            {card.priority}
                          </span>
                        )}
                        {card.due !== null && (
                          <span className="board__due">
                            <Icon name="calendar" size={11} />
                            {card.due.slice(0, 10)}
                          </span>
                        )}
                      </p>
                    )}
                    {card.preview !== '' && <p className="board__preview">{card.preview}</p>}
                  </article>
                ))}

                {adding === column.id ? (
                  <input
                    className="board__new"
                    placeholder="Card title"
                    autoFocus
                    onBlur={(event) => void addCard(column.id, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') setAdding(null)
                    }}
                  />
                ) : (
                  <button className="board__add" onClick={() => setAdding(column.id)}>
                    <Icon name="plus" size={13} />
                    Add card
                  </button>
                )}
              </div>
            </section>
          )
        })}

        <section className="board__col board__col--ghost">
          <input
            className="board__newcol"
            placeholder="+ Column"
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              addColumn(event.currentTarget.value)
              event.currentTarget.value = ''
            }}
          />
        </section>
      </div>

      {contextMenu.menu !== null && (
        <ContextMenu
          items={menuFor(contextMenu.menu.subject)}
          at={contextMenu.menu.at}
          onClose={contextMenu.close}
        />
      )}

      {cards !== null && cards.length === 0 && (
        <p className="board__empty">
          No cards on <strong>{board.name}</strong> yet. Every card you add is a real note in{' '}
          <code>{CARD_FOLDER}/</code> — open it and it is an ordinary editor.
        </p>
      )}
    </div>
  )
}

/**
 * Registered as a view type, so a board opens in a tab like anything else and
 * survives in `workspace.json`. The leaf state holds the board id, so reopening
 * the app lands on the board you left.
 */
export function registerBoardView(onOpenNote: (path: string) => void): () => void {
  return registerView({
    type: 'board',
    title: 'Board',
    icon: 'square-kanban',
    getTitle: (state) => {
      const id = state['board']
      const found = currentBoards().boards.find((entry) => entry.id === id)
      return found?.name ?? 'Board'
    },
    render: ({ state }) => <BoardHost boardId={state['board']} onOpenNote={onOpenNote} />,
  })
}

function BoardHost({
  boardId,
  onOpenNote,
}: {
  boardId: unknown
  onOpenNote: (path: string) => void
}): React.ReactElement {
  const file = useBoards()
  const id = typeof boardId === 'string' ? boardId : file.boards[0]?.id
  // A leaf that names a board which has since been deleted falls back rather
  // than rendering nothing - the same rule the workspace uses for view types.
  const board = file.boards.find((entry) => entry.id === id) ?? file.boards[0]

  if (board === undefined) return <p className="board__empty">No boards yet.</p>

  return (
    <BoardView
      board={board}
      onOpenNote={onOpenNote}
      onEditBoard={(next) =>
        updateBoards({ boards: file.boards.map((entry) => (entry.id === next.id ? next : entry)) })
      }
    />
  )
}
