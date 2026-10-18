import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IPC } from '@shared/ipc'
import type { BoardCardInfo } from '@shared/index-results'
import { cardFields, isoDay, setCardField } from '@shared/card-fields'
import { cardLink, findItem, insertItem, moveItem, parseKanban, removeItem, replaceItem, type KanbanBoard } from '@shared/kanban'
import { api } from '../../../app/api'
import { noteIndexChanged, useNoteBus } from '../../../app/note-bus'
import { noteEdited } from '../../../app/usage'
import { boardFrom, doneColumn, type Board } from '../boards'
import { toView, type CardView } from '../board-view'
import { cardExists, cardName, createCardNote } from '../create-card'

/** How long to trust our own write over what the index says. */
const OVERRIDE_TTL_MS = 15_000

/** Where a card is dropped: a column, and the slot in it among its other cards, in file order (0 is the top). */
export type Drop = { column: string; index: number }

/** What adding a card came to: made, refused because the name is taken, or failed. */
export type AddResult = { ok: true; path: string } | { ok: false; exists: string } | { ok: false; error: string }

type Patch = Partial<BoardCardInfo>

const lower = (s: string): string => s.normalize('NFC').toLowerCase()

/**
 * One board: its note, read and written by this hook, and the cards' notes.
 *
 * The board note is the only source of lanes, order and which lane a card is
 * in; a drag rewrites lines of that file and nothing else (shared/kanban.ts).
 * A card that is a note keeps its own fields in its own frontmatter, edited
 * here one key at a time.
 *
 * Every change shows first and is written second. A board write reads the file
 * again just before writing and, when it changed meanwhile (Obsidian, sync),
 * makes the same change to what is there now - found by the card's own lines,
 * not by where it was - so nobody's edit is written over. A write that fails is
 * undone on screen and said in a notice. Writes go one at a time.
 */
export function useBoardCards(path: string): {
  text: string | null
  board: Board | null
  cards: CardView[] | null
  /** The board note could not be read. */
  error: string | null
  notice: string | null
  clearNotice: () => void
  reload: () => void
  /** Change the board note: a column, a setting. The change is handed the text and returns the new text. */
  editBoard: (change: (text: string) => string) => Promise<boolean>
  /** Edit one card's note; the edit is handed the text and returns the new text. */
  editCard: (path: string, edit: (text: string) => string) => Promise<boolean>
  move: (key: string, target: Drop) => Promise<void>
  addCard: (column: string, title: string) => Promise<AddResult>
  /** A plain-text card becomes a note in tasks/, and its line a link to it. Resolves to the note's path. */
  makeNote: (key: string) => Promise<string | null>
  /** Take a card off the board: its line goes; its note, if any, stays. */
  removeCard: (key: string) => Promise<boolean>
  /** Rename the card's note, which is its title. Resolves to the new path, or null. */
  renameCard: (path: string, name: string) => Promise<string | null>
} {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, BoardCardInfo | null>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const { revision } = useNoteBus()

  /** The file as last read or written: what a write expects to find. */
  const base = useRef<string | null>(null)
  const textRef = useRef(text)
  textRef.current = text
  /** Board writes in flight, one after another. */
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const pending = useRef(0)

  /**
   * What we have shown of a card's note but the index has not caught up with:
   * re-applied over every reload, dropped once the index agrees or after a
   * timeout, so a write that silently failed cannot pin the board to a lie.
   * And the notes made here that the index has not seen yet, by link text.
   */
  const [overlay, setOverlay] = useState<Overlay>({ patches: {}, made: {} })

  const parsed: KanbanBoard | null = useMemo(() => (text === null ? null : parseKanban(text)), [text])
  const links = useMemo(() => {
    const out = new Set<string>()
    for (const lane of parsed?.lanes ?? []) for (const item of lane.items) if (item.link !== null) out.add(item.link)
    return [...out].sort()
  }, [parsed])
  const linkKey = links.join('\u0000')

  // The board note itself: read on open and whenever the vault changes - our
  // own write's echo included, which then reads what we wrote.
  const readBoard = useCallback(() => {
    void api.invoke(IPC.fsRead, path).then((read) => {
      if (!read.ok) {
        setError(read.error)
        return
      }
      setError(null)
      // A write of ours is on its way: what is on screen is newer than the file.
      if (pending.current > 0) return
      base.current = read.content
      setText(read.content)
    })
  }, [path])

  useEffect(readBoard, [readBoard, revision, tick])

  // The cards' notes, from the index.
  useEffect(() => {
    if (links.length === 0) {
      setRows({})
      return
    }
    const load = (): void => {
      void api.invoke(IPC.indexCards, links).then((found) => {
        setRows(found)
        setOverlay((prev) => prune(prev, found, Date.now()))
      })
    }
    load()
    // The indexer is a process behind; a second look a moment later sees what it has since read.
    const timer = window.setTimeout(load, 1200)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `linkKey` stands for `links`
  }, [linkKey, revision, tick])

  // A notice says its piece and goes.
  useEffect(() => {
    if (notice === null) return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const board = useMemo(() => (parsed === null ? null : boardFrom(path, parsed)), [parsed, path])

  const cards = useMemo(() => {
    if (parsed === null || board === null) return null
    const out: CardView[] = []
    parsed.lanes.forEach((lane, laneIndex) => {
      const column = board.columns[laneIndex]!
      lane.items.forEach((item, index) => {
        let row = item.link === null ? null : (rows[item.link] ?? null)
        if (row === null && item.link !== null) row = overlay.made[lower(item.link)]?.row ?? null
        const patch = row === null ? undefined : overlay.patches[row.path]
        if (row !== null && patch !== undefined) row = { ...row, ...patch.patch }
        out.push(toView(item, row, column, index))
      })
    })
    // Two lines naming one note: the second is told apart, so both can be drawn and dragged.
    const seen = new Set<string>()
    return out.map((card) => {
      if (!seen.has(card.key)) {
        seen.add(card.key)
        return card
      }
      return { ...card, key: `${card.key}#${card.column}:${card.index}` }
    })
  }, [parsed, board, rows, overlay])
  const cardsRef = useRef(cards)
  cardsRef.current = cards

  /** Show a change to one card's note now. Returns how to take it back. */
  const show = useCallback((cardPath: string, patch: Patch): (() => void) => {
    let before: Overlay['patches'][string] | undefined
    setOverlay((prev) => {
      before = prev.patches[cardPath]
      return { ...prev, patches: { ...prev.patches, [cardPath]: { patch: { ...before?.patch, ...patch }, at: Date.now() } } }
    })
    return () =>
      setOverlay((prev) => {
        const patches = { ...prev.patches }
        if (before === undefined) delete patches[cardPath]
        else patches[cardPath] = before
        return { ...prev, patches }
      })
  }, [])

  /** A note made here, drawn before the index lists it. */
  const showMade = useCallback((path: string): string => {
    const stem = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
    setOverlay((prev) => ({ ...prev, made: { ...prev.made, [lower(stem)]: { row: blankRow(path, stem), at: Date.now() } } }))
    return stem
  }, [])

  /**
   * The one way the board note is written: shown at once, then - in turn -
   * read again, changed, written. `change` may throw to refuse (the card is
   * gone); that is said, and nothing is written.
   */
  const editBoard = useCallback(
    (change: (text: string) => string): Promise<boolean> => {
      const shown = textRef.current
      if (shown === null) return Promise.resolve(false)
      let next: string
      try {
        next = change(shown)
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err))
        return Promise.resolve(false)
      }
      if (next === shown) return Promise.resolve(true)
      setText(next)
      pending.current++
      const run = async (): Promise<boolean> => {
        try {
          const read = await api.invoke(IPC.fsRead, path)
          let target = next
          if (read.ok && read.content !== base.current) {
            // Changed under us: the same change, made to what is there now.
            try {
              target = change(read.content)
            } catch (err) {
              base.current = read.content
              setText(read.content)
              setNotice(`The board changed meanwhile, so that was not saved. ${err instanceof Error ? err.message : ''}`.trim())
              return false
            }
          }
          const written = await api.invoke(IPC.fsWrite, path, target)
          if (!written.ok) {
            const back = read.ok ? read.content : base.current
            if (back !== null) setText(back)
            setNotice(`Couldn't save the board, so the change was undone. ${written.error ?? ''}`.trim())
            return false
          }
          base.current = target
          if (target !== next) setText(target)
          noteIndexChanged()
          noteEdited(path)
          return true
        } finally {
          pending.current--
        }
      }
      const result = queue.current.then(run, run)
      queue.current = result
      return result
    },
    [path],
  )

  /**
   * Read, edit, show, write one card's note. `shown` takes back whatever the
   * caller already put on screen for the same gesture.
   */
  const editCard = useCallback(
    async (cardPath: string, edit: (text: string) => string, shown?: () => void): Promise<boolean> => {
      const read = await api.invoke(IPC.fsRead, cardPath)
      if (!read.ok) {
        shown?.()
        setNotice(`Couldn't read the card: ${read.error}`)
        return false
      }
      const next = edit(read.content)
      if (next === read.content) return true
      const undo = show(cardPath, cardFields(next))
      const written = await api.invoke(IPC.fsWrite, cardPath, next)
      if (!written.ok) {
        undo()
        shown?.()
        setNotice(`Couldn't save the card, so the change was undone. ${written.error ?? ''}`.trim())
        return false
      }
      noteIndexChanged()
      noteEdited(cardPath)
      return true
    },
    [show],
  )

  const find = (key: string): CardView | undefined => cardsRef.current?.find((card) => card.key === key)

  /** The card's item in a text, found by its own lines; throws when it is gone. */
  const locate = (card: CardView) => (t: string) => {
    const ref = findItem(parseKanban(t), { lane: Number(card.column), index: card.index }, card.raw)
    if (ref === null) throw new Error(`“${card.title}” is no longer on the board.`)
    return ref
  }

  const move = useCallback(
    async (key: string, target: Drop) => {
      const card = find(key)
      if (card === undefined || board === null) return
      const done = doneColumn(board.columns)
      const entering = target.column === done && card.column !== done
      const leaving = card.column === done && target.column !== done
      const checked = entering ? true : leaving ? false : undefined
      const ok = await editBoard((t) => moveItem(t, locate(card)(t), { lane: Number(target.column), index: target.index }, checked))
      // Entering Done is when a card was finished: `completed` on its note, gone again on the way out.
      if (ok && !card.light && card.path !== '' && (entering || leaving)) {
        const completed = entering ? isoDay(new Date()) : null
        const undo = show(card.path, { completed })
        await editCard(card.path, (t) => setCardField(t, 'completed', completed), undo)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `find` and `locate` read refs
    [board, editBoard, editCard, show],
  )

  /** Names being created right now: a second Enter during the first write must not make a second card. */
  const creating = useRef(new Set<string>())

  /** A new card: its note in tasks/, then its line at the top of the column. */
  const addCard = useCallback(
    async (column: string, title: string): Promise<AddResult> => {
      const name = cardName(title)
      const key = lower(name)
      if (name === '') return { ok: false, error: 'A card needs a name.' }
      if (creating.current.has(key)) return { ok: false, error: 'That card is already being made.' }
      creating.current.add(key)
      try {
        const existing = await cardExists(name)
        if (existing !== null) return { ok: false, exists: existing }
        const created = await createCardNote(name)
        if (!created.ok) return created
        const stem = showMade(created.path)
        const ok = await editBoard((t) => insertItem(t, Number(column), 0, cardLink(stem)))
        if (!ok) {
          // A card note with no board to be on helps nobody.
          await api.invoke(IPC.fsTrash, created.path)
          return { ok: false, error: 'Could not add it to the board.' }
        }
        return { ok: true, path: created.path }
      } finally {
        creating.current.delete(key)
      }
    },
    [editBoard, showMade],
  )

  const makeNote = useCallback(
    async (key: string): Promise<string | null> => {
      const card = find(key)
      if (card === undefined || !card.light) return null
      const [first = '', ...rest] = card.text.split('\n')
      const name = cardName(first)
      if (name === '') {
        setNotice('This card has no text to name a note after.')
        return null
      }
      const existing = await cardExists(name)
      if (existing !== null) {
        setNotice(`A note called “${name}” exists already (${existing}). Rename the card first.`)
        return null
      }
      const created = await createCardNote(name, rest.join('\n').trim())
      if (!created.ok) {
        setNotice(`Couldn't make the note. ${created.error}`)
        return null
      }
      const stem = showMade(created.path)
      const ok = await editBoard((t) => replaceItem(t, locate(card)(t), cardLink(stem)))
      if (!ok) {
        await api.invoke(IPC.fsTrash, created.path)
        return null
      }
      return created.path
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `find` and `locate` read refs
    [editBoard, showMade],
  )

  const removeCard = useCallback(
    async (key: string): Promise<boolean> => {
      const card = find(key)
      if (card === undefined) return false
      return editBoard((t) => removeItem(t, locate(card)(t)))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `find` and `locate` read refs
    [editBoard],
  )

  /**
   * Renaming a card renames its note; main rewrites every link to it, this
   * board's line among them, and the board reads that back.
   */
  const renameCard = useCallback(async (cardPath: string, name: string): Promise<string | null> => {
    const title = cardName(name)
    const slash = cardPath.lastIndexOf('/')
    if (title === '' || `${cardPath.slice(slash + 1)}` === `${title}.md`) return null
    const result = await api.invoke(IPC.fsRename, cardPath, `${title}.md`)
    if (!result.ok) {
      setNotice(`Couldn't rename the card. ${result.error}`)
      return null
    }
    noteIndexChanged()
    setTick((t) => t + 1)
    return result.path
  }, [])

  return {
    text,
    board,
    cards,
    error,
    notice,
    clearNotice: () => setNotice(null),
    reload: () => setTick((t) => t + 1),
    editBoard,
    editCard,
    move,
    addCard,
    makeNote,
    removeCard,
    renameCard,
  }
}

type Overlay = {
  patches: Record<string, { patch: Patch; at: number }>
  made: Record<string, { row: BoardCardInfo; at: number }>
}

/** What the board draws of a card's note, to tell whether the index has caught up with a patch. */
const cardFieldsOf = (row: BoardCardInfo): string =>
  JSON.stringify([row.start, row.due, row.completed, row.priority, row.tags, row.description, row.checklist])

/** The overlay, less what the index now agrees with and what has waited too long. */
function prune(overlay: Overlay, found: Record<string, BoardCardInfo | null>, now: number): Overlay {
  const rows = Object.values(found).filter((row): row is BoardCardInfo => row !== null)
  const patches = Object.fromEntries(
    Object.entries(overlay.patches).filter(([path, entry]) => {
      const row = rows.find((r) => r.path === path)
      return now - entry.at < OVERRIDE_TTL_MS && (row === undefined || cardFieldsOf({ ...row, ...entry.patch }) !== cardFieldsOf(row))
    }),
  )
  const listed = new Set(Object.entries(found).flatMap(([link, row]) => (row === null ? [] : [lower(link)])))
  const made = Object.fromEntries(
    Object.entries(overlay.made).filter(([link, entry]) => now - entry.at < OVERRIDE_TTL_MS && !listed.has(link)),
  )
  return Object.keys(patches).length === Object.keys(overlay.patches).length &&
    Object.keys(made).length === Object.keys(overlay.made).length
    ? overlay
    : { patches, made }
}

const blankRow = (path: string, title: string): BoardCardInfo => ({
  path,
  title,
  description: '',
  start: null,
  due: null,
  completed: null,
  priority: null,
  tags: null,
  checklist: { done: 0, total: 0 },
  links: 0,
})
