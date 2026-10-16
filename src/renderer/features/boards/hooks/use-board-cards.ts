import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IPC } from '@shared/ipc'
import { isoDay, setCardField } from '@shared/card-fields'
import { api } from '../../../app/api'
import { noteIndexChanged, useNoteBus } from '../../../app/note-bus'
import { doneColumn, UNKNOWN_COLUMN, type Board } from '../boards'
import { toView, type CardView } from '../board-view'
import { placeAt, sortColumn } from '../ordering'

/** How long to trust our own write over what the index says. */
const OVERRIDE_TTL_MS = 15_000

/** Where a card is dropped: a column, and the slot in it (0 is the top). */
export type Drop = { column: string; index: number }

/**
 * A board's cards, and the writes that change them.
 *
 * A card is a note, so every change is a read-edit-write of that one file,
 * touching only the keys being changed. Moving a card in or out of the Done
 * column also sets or removes `completed` in the same write - that is the
 * signal "Done this week" counts.
 */
export function useBoardCards(board: Board): {
  cards: CardView[] | null
  error: string | null
  clearError: () => void
  reload: () => void
  /** Edit one card's file; the edit is handed the text and returns the new text. */
  editCard: (path: string, edit: (text: string) => string) => Promise<boolean>
  move: (path: string, target: Drop) => Promise<void>
} {
  const [cards, setCards] = useState<CardView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { revision } = useNoteBus()

  /**
   * Cards we have written but the index has not caught up with yet.
   *
   * A drag writes a file; the indexer sees it a moment later. Reloading in
   * between hands back the OLD status and the card snaps back to the column it
   * came from. So a write records what it expects, every reload re-applies it,
   * and the entry is dropped the moment the index agrees (or after a timeout,
   * so a write that silently failed cannot pin the board to a lie forever).
   */
  const overrides = useRef(new Map<string, { status: string | null; order: number; at: number }>())

  const load = useCallback(() => {
    void api.invoke(IPC.indexBoard, board.id).then((rows) => {
      const now = Date.now()
      setCards(
        rows.map((row) => {
          const pending = overrides.current.get(row.path)
          if (pending === undefined) return toView(row, board.columns)
          if ((row.status === pending.status && row.order === pending.order) || now - pending.at > OVERRIDE_TTL_MS) {
            overrides.current.delete(row.path)
            return toView(row, board.columns)
          }
          return toView({ ...row, status: pending.status, order: pending.order }, board.columns)
        }),
      )
    })
  }, [board.id, board.columns])

  useEffect(() => {
    load()
    // The indexer is a process behind. A second pass a moment later picks up
    // whatever it has since seen and retires the optimistic override.
    const timer = window.setTimeout(load, 1200)
    return () => window.clearTimeout(timer)
  }, [load, revision])

  const editCard = useCallback(async (path: string, edit: (text: string) => string): Promise<boolean> => {
    const read = await api.invoke(IPC.fsRead, path)
    if (!read.ok) {
      setError(read.error)
      return false
    }
    const next = edit(read.content)
    if (next === read.content) return true
    const written = await api.invoke(IPC.fsWrite, path, next)
    if (!written.ok) setError(written.error ?? 'Could not save the card.')
    return written.ok
  }, [])

  const byColumn = useMemo(() => {
    const out = new Map<string, CardView[]>()
    for (const card of cards ?? []) out.set(card.column, [...(out.get(card.column) ?? []), card])
    for (const [id, list] of out) out.set(id, sortColumn(list))
    return out
  }, [cards])

  const move = useCallback(
    async (path: string, target: Drop) => {
      const card = cards?.find((entry) => entry.path === path)
      if (card === undefined || target.column === UNKNOWN_COLUMN) return

      // The column as it will be WITHOUT the card being moved, which is what
      // the drop index refers to.
      const column = (byColumn.get(target.column) ?? []).filter((entry) => entry.path !== path)
      const orders = column.map((entry) => entry.order).filter((order): order is number => order !== null)
      const index = Math.max(0, Math.min(orders.length, target.index))
      const placed = placeAt(orders, index)
      const order = placed.kind === 'order' ? placed.order : placed.orders[index]!

      const done = doneColumn(board.columns)
      const entering = target.column === done && card.column !== done
      const leaving = card.column === done && target.column !== done
      const completed = entering ? isoDay(new Date()) : leaving ? null : card.completed

      // Optimistic: the board moves now, the file catches up.
      setCards((prev) =>
        (prev ?? []).map((entry) =>
          entry.path === path
            ? {
                ...entry,
                column: target.column,
                status: target.column,
                order,
                completed,
                completedDay: completed === null ? null : (entry.completedDay ?? completed),
              }
            : entry,
        ),
      )
      overrides.current.set(path, { status: target.column, order, at: Date.now() })
      await editCard(path, (text) => {
        let next = setCardField(text, 'status', target.column)
        next = setCardField(next, 'order', order)
        if (entering) next = setCardField(next, 'completed', completed)
        if (leaving) next = setCardField(next, 'completed', null)
        return next
      })

      if (placed.kind === 'renumber') {
        // The gap between two cards got too small to halve. Rewrite the whole
        // column once - the only time this board touches more than one file for
        // one gesture.
        const rest = [...column]
        rest.splice(index, 0, { ...card, order })
        for (const [position, entry] of rest.entries()) {
          const next = placed.orders[position]!
          if (entry.path === path || entry.order === next) continue
          overrides.current.set(entry.path, { status: entry.status, order: next, at: Date.now() })
          await editCard(entry.path, (text) => setCardField(text, 'order', next))
        }
        setCards((prev) =>
          (prev ?? []).map((entry) => {
            const pending = overrides.current.get(entry.path)
            return pending === undefined ? entry : { ...entry, order: pending.order }
          }),
        )
      }
      noteIndexChanged()
    },
    [cards, byColumn, board.columns, editCard],
  )

  return { cards, error, clearError: () => setError(null), reload: load, editCard, move }
}
