import { cardLink, insertItem, isKanban } from '@shared/kanban'
import { IPC } from '@shared/ipc'
import { api } from '../../app/api'
import { noteIndexChanged } from '../../app/note-bus'
import { noteEdited } from '../../app/usage'
import { newBoardText } from './boards'

/**
 * Making cards and boards.
 *
 * A card that is a note is a note in tasks/ and a line on a board, `- [ ]
 * [[Name]]`. The note carries nothing about the board - not its lane, not its
 * order; the board's line is the whole of that. It has no H1 either: a card's
 * title is its file name, as everywhere else in Recto.
 */

/** Where card notes and board notes are written. A folder, not a database. */
export const CARD_FOLDER = 'tasks'

/** A card's name as a file name: one line, nothing a path or a link cannot hold. */
export const cardName = (text: string): string =>
  text
    .split('\n')[0]!
    .replace(/[\\/:|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)

/**
 * The note a new card's name would collide with, or null. A link resolves by
 * name across the vault, so a second note of that name anywhere is a clash;
 * the file check covers a card the index has not seen yet.
 */
export async function cardExists(name: string): Promise<string | null> {
  const resolved = await api.invoke(IPC.indexResolveLink, name)
  if (resolved !== null) return resolved
  const path = `${CARD_FOLDER}/${name}.md`
  const read = await api.invoke(IPC.fsRead, path)
  return read.ok ? path : null
}

/**
 * A card's note, empty or with a body. `onTaken: 'number'` for a name the app
 * chose ("New task"); a typed name that is taken anywhere is refused by main.
 */
export async function createCardNote(
  name: string,
  body = '',
  onTaken: 'refuse' | 'number' = 'refuse',
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (name === '') return { ok: false, error: 'A card needs a name.' }
  const created = await api.invoke(IPC.fsCreate, CARD_FOLDER, `${name}.md`, 'file', onTaken)
  if (!created.ok) return created
  if (body !== '') {
    const written = await api.invoke(IPC.fsWrite, created.path, `${body}\n`)
    if (!written.ok) {
      await api.invoke(IPC.fsTrash, created.path)
      return { ok: false, error: written.error ?? 'Could not write the card.' }
    }
  }
  noteIndexChanged()
  noteEdited(created.path)
  return { ok: true, path: created.path }
}

/**
 * A card made from outside a board (the sidebar's New button): its note, and
 * its line at the top of the board's first column.
 */
export async function createCard(
  boardPath: string,
  title: string,
  onTaken: 'refuse' | 'number' = 'refuse',
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const created = await createCardNote(title.trim(), '', onTaken)
  if (!created.ok) return created
  const read = await api.invoke(IPC.fsRead, boardPath)
  const stem = created.path.slice(created.path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  if (!read.ok || !isKanban(read.content)) return created
  let next: string
  try {
    next = insertItem(read.content, 0, 0, cardLink(stem))
  } catch {
    // A board with no column yet: the note is made, and stays a note.
    return created
  }
  const written = await api.invoke(IPC.fsWrite, boardPath, next)
  if (written.ok) {
    noteIndexChanged()
    noteEdited(boardPath)
  }
  return created
}

/** A new board note in tasks/, beside its cards, under a typed name (refused when a note has it). */
export async function createBoard(name: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const created = await api.invoke(IPC.fsCreate, CARD_FOLDER, `${name}.md`, 'file', 'refuse')
  if (!created.ok) return created
  const written = await api.invoke(IPC.fsWrite, created.path, newBoardText())
  if (!written.ok) {
    await api.invoke(IPC.fsTrash, created.path)
    return { ok: false, error: written.error ?? 'Could not write the board.' }
  }
  noteIndexChanged()
  noteEdited(created.path)
  return { ok: true, path: created.path }
}
