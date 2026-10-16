import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IPC } from '@shared/ipc'
import type { BoardCardInfo } from '@shared/index-results'
import { cardFields, isoDay, setCardField } from '@shared/card-fields'
import { api } from '../../../app/api'
import { noteIndexChanged, useNoteBus } from '../../../app/note-bus'
import { doneColumn, UNKNOWN_COLUMN, type Board } from '../boards'
import { toView, type CardView } from '../board-view'
import { CARD_FOLDER, cardExists, createCard } from '../create-card'
import { placeAt, sortColumn } from '../ordering'

/** How long to trust our own write over what the index says. */
const OVERRIDE_TTL_MS = 15_000

/** Where a card is dropped: a column, and the slot in it (0 is the top). */
export type Drop = { column: string; index: number }

/** What adding a card came to: made, refused because the name is taken, or failed. */
export type AddResult = { ok: true; path: string } | { ok: false; exists: string } | { ok: false; error: string }

type Patch = Partial<BoardCardInfo>

/** What the board draws of a card, to tell whether the index has caught up with a patch. */
const drawn = (card: CardView): string =>
  JSON.stringify([
    card.title,
    card.column,
    card.order,
    card.level,
    card.span,
    card.tagList,
    card.completedDay,
    card.description,
    card.checklist,
  ])

const blankRow = (path: string, title: string): BoardCardInfo => ({
  path,
  title,
  description: '',
  status: null,
  order: null,
  start: null,
  due: null,
  completed: null,
  priority: null,
  tags: null,
  checklist: { done: 0, total: 0 },
  links: 0,
})

/**
 * A board's cards, and the writes that change them.
 *
 * A card is a note, so every change is a read-edit-write of that one file,
 * touching only the keys being changed. Every change shows on the board first
 * and is written second: the index is a process behind, and waiting for it
 * made each click feel like a save dialog. A write that fails is undone on
 * screen and said in a notice.
 *
 * Moving a card in or out of the Done column also sets or removes `completed`
 * in the same write - that is the signal "Done this week" counts.
 */
export function useBoardCards(board: Board): {
  cards: CardView[] | null
  notice: string | null
  clearNotice: () => void
  reload: () => void
  /** Edit one card's file; the edit is handed the text and returns the new text. */
  editCard: (path: string, edit: (text: string) => string) => Promise<boolean>
  move: (path: string, target: Drop) => Promise<void>
  addCard: (column: string, title: string) => Promise<AddResult>
  /** Rename the card's note, which is its title. Resolves to the new path, or null. */
  renameCard: (path: string, name: string) => Promise<string | null>
} {
  const [cards, setCards] = useState<CardView[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const { revision } = useNoteBus()
  const columnsRef = useRef(board.columns)
  columnsRef.current = board.columns
  const cardsRef = useRef(cards)
  cardsRef.current = cards

  /**
   * What we have shown but the index has not caught up with yet.
   *
   * Reloading in between would hand back the OLD values and the card would
   * snap back. So each change records what it expects, every reload re-applies
   * it, and the entry is dropped the moment the index draws the same card (or
   * after a timeout, so a write that silently failed cannot pin the board to a
   * lie forever).
   */
  const patches = useRef(new Map<string, { patch: Patch; at: number }>())
  /** Cards made here that the index has not listed yet. */
  const added = useRef(new Map<string, { row: BoardCardInfo; at: number }>())
  /** Old paths of renamed cards, which the index lists until it sees the rename. */
  const gone = useRef(new Map<string, number>())

  const load = useCallback(() => {
    void api.invoke(IPC.indexBoard, board.id).then((rows) => {
      const now = Date.now()
      const columns = columnsRef.current
      for (const [path, at] of gone.current) if (now - at > OVERRIDE_TTL_MS || !rows.some((r) => r.path === path)) gone.current.delete(path)
      const listed = rows.filter((row) => !gone.current.has(row.path))
      for (const [path, entry] of added.current)
        if (now - entry.at > OVERRIDE_TTL_MS || listed.some((r) => r.path === path)) added.current.delete(path)
      const all = [...listed, ...[...added.current.values()].map((entry) => entry.row)]
      setCards(
        all.map((row) => {
          const pending = patches.current.get(row.path)
          if (pending === undefined) return toView(row, columns)
          const indexed = toView(row, columns)
          const patched = toView({ ...row, ...pending.patch }, columns)
          if (drawn(indexed) === drawn(patched) || now - pending.at > OVERRIDE_TTL_MS) {
            patches.current.delete(row.path)
            return indexed
          }
          return patched
        }),
      )
    })
  }, [board.id])

  useEffect(() => {
    load()
    // The indexer is a process behind. A second pass a moment later picks up
    // whatever it has since seen and retires the optimistic patches.
    const timer = window.setTimeout(load, 1200)
    return () => window.clearTimeout(timer)
  }, [load, revision, board.columns])

  // A notice says its piece and goes.
  useEffect(() => {
    if (notice === null) return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  /** Show a change to one card now. Returns how to take it back. */
  const show = useCallback((path: string, patch: Patch): (() => void) => {
    const before = patches.current.get(path)
    patches.current.set(path, { patch: { ...before?.patch, ...patch }, at: Date.now() })
    let previous: CardView | undefined
    setCards((prev) =>
      (prev ?? []).map((card) => {
        if (card.path !== path) return card
        previous = card
        return toView({ ...card, ...patch }, columnsRef.current)
      }),
    )
    return () => {
      if (before === undefined) patches.current.delete(path)
      else patches.current.set(path, before)
      setCards((prev) => (prev ?? []).map((card) => (card.path === path && previous !== undefined ? previous : card)))
    }
  }, [])

  /**
   * Read, edit, show, write. `shown` takes back whatever the caller already put
   * on screen for the same gesture, so a failure lands where it started.
   */
  const writeCard = useCallback(
    async (path: string, edit: (text: string) => string, shown?: () => void): Promise<boolean> => {
      const read = await api.invoke(IPC.fsRead, path)
      if (!read.ok) {
        shown?.()
        setNotice(`Couldn't read the card: ${read.error}`)
        return false
      }
      const next = edit(read.content)
      if (next === read.content) return true
      const undo = show(path, cardFields(next))
      const written = await api.invoke(IPC.fsWrite, path, next)
      if (!written.ok) {
        undo()
        shown?.()
        setNotice(`Couldn't save the card, so the change was undone. ${written.error ?? ''}`.trim())
        return false
      }
      noteIndexChanged()
      return true
    },
    [show],
  )

  const editCard = useCallback((path: string, edit: (text: string) => string) => writeCard(path, edit), [writeCard])

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

      // Shown now, before the file is even read; taken back if the write fails.
      const shown = show(path, { status: target.column, order, completed })
      await writeCard(
        path,
        (text) => {
          let next = setCardField(text, 'status', target.column)
          next = setCardField(next, 'order', order)
          if (entering) next = setCardField(next, 'completed', completed)
          if (leaving) next = setCardField(next, 'completed', null)
          return next
        },
        shown,
      )

      if (placed.kind === 'renumber') {
        // The gap between two cards got too small to halve. Rewrite the whole
        // column once - the only time this board touches more than one file for
        // one gesture.
        const rest = [...column]
        rest.splice(index, 0, { ...card, order })
        for (const [position, entry] of rest.entries()) {
          const next = placed.orders[position]!
          if (entry.path === path || entry.order === next) continue
          await writeCard(entry.path, (text) => setCardField(text, 'order', next))
        }
      }
    },
    [cards, byColumn, board.columns, writeCard, show],
  )

  /** Names being created right now: a second Enter during the first write must not make a second card. */
  const creating = useRef(new Set<string>())

  /**
   * Resolves once the card is on screen - or refused, when its name is taken -
   * and writes the note after. The name stays claimed until the write is done,
   * so Enter pressed again in between cannot make a second card.
   */
  const addCard = useCallback(
    async (column: string, title: string): Promise<AddResult> => {
      const name = title.trim()
      const key = name.toLowerCase()
      if (name === '') return { ok: false, error: 'A card needs a name.' }
      if (creating.current.has(key)) return { ok: false, error: 'That card is already being made.' }
      creating.current.add(key)
      const release = (): void => void creating.current.delete(key)

      const shown = cardsRef.current?.find((card) => card.title.toLowerCase() === key)
      const existing = shown?.path ?? (await cardExists(name))
      if (existing !== null) {
        release()
        return { ok: false, exists: existing }
      }

      const orders = (byColumn.get(column) ?? []).map((card) => card.order).filter((order): order is number => order !== null)
      const placed = placeAt(orders, orders.length)
      const order = placed.kind === 'order' ? placed.order : placed.orders.at(-1)!
      const path = `${CARD_FOLDER}/${name}.md`
      const row = { ...blankRow(path, name), status: column, order }
      added.current.set(path, { row, at: Date.now() })
      setCards((prev) => [...(prev ?? []), toView(row, columnsRef.current)])

      void createCard(board.id, column, name, { order })
        .then((created) => {
          if (!created.ok) {
            added.current.delete(path)
            setCards((prev) => (prev ?? []).filter((card) => card.path !== path))
            setNotice(`Couldn't create the card, so it was taken off the board. ${created.error}`)
          } else if (created.path !== path) {
            // The file system picked another name after all; follow it.
            added.current.delete(path)
            added.current.set(created.path, { row: { ...row, path: created.path }, at: Date.now() })
            setCards((prev) => (prev ?? []).map((card) => (card.path === path ? { ...card, path: created.path } : card)))
          }
        })
        .finally(release)
      return { ok: true, path }
    },
    [board.id, byColumn],
  )

  const renameCard = useCallback(async (path: string, name: string): Promise<string | null> => {
    const title = name.trim()
    const slash = path.lastIndexOf('/')
    const target = `${path.slice(0, slash + 1)}${title}.md`
    if (title === '' || target === path) return null

    // Shown under its new name at once; the old path is hidden until the index has it.
    const at = Date.now()
    gone.current.set(path, at)
    const pending = patches.current.get(path)
    if (pending !== undefined) patches.current.set(target, pending)
    const card = cardsRef.current?.find((entry) => entry.path === path)
    if (card !== undefined) added.current.set(target, { row: { ...card, path: target, title }, at })
    setCards((prev) => (prev ?? []).map((card) => (card.path === path ? { ...card, path: target, title } : card)))

    const result = await api.invoke(IPC.fsRename, path, `${title}.md`)
    if (!result.ok) {
      gone.current.delete(path)
      patches.current.delete(target)
      added.current.delete(target)
      setCards((prev) =>
        (prev ?? []).map((card) => (card.path === target ? { ...card, path, title: path.slice(slash + 1).replace(/\.md$/i, '') } : card)),
      )
      setNotice(`Couldn't rename the card. ${result.error}`)
      return null
    }
    if (result.path !== target) {
      const moved = added.current.get(target)
      added.current.delete(target)
      if (moved !== undefined) added.current.set(result.path, { ...moved, row: { ...moved.row, path: result.path } })
      setCards((prev) => (prev ?? []).map((entry) => (entry.path === target ? { ...entry, path: result.path } : entry)))
    }
    noteIndexChanged()
    return result.path
  }, [])

  return { cards, notice, clearNotice: () => setNotice(null), reload: load, editCard, move, addCard, renameCard }
}
