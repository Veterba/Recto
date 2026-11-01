import { cardLink, insertItem, isKanban, updateSettings } from '@shared/kanban'
import { IPC } from '@shared/ipc'
import { boardFolder, cardFolderFor, NEW_NOTE_FOLDER_KEY } from '@shared/recto-paths'
import { nameProblem } from '@shared/vault'
import { api } from '../../app/api'
import { noteIndexChanged } from '../../app/note-bus'
import { noteEdited } from '../../app/usage'
import { newBoardText } from './boards'

/**
 * Making cards and boards.
 *
 * A board is a note in its own folder, `Recto/Boards/<Board>/<Board>.md`. A
 * card that is a note is a note in its board's folder and a line on the
 * board, `- [ ] [[Name]]`. The note carries nothing about the board - not its
 * lane, not its order; the board's line is the whole of that. It has no H1
 * either: a card's title is its file name, as everywhere else in Recto.
 */

/**
 * A card's name from what was typed: its first line, spaces tidied. What a
 * path or a link cannot hold is refused by `nameProblem`, never changed.
 */
export const cardName = (text: string): string =>
  text
    .split('\n')[0]!
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The note a new card's or board's name would collide with, or null. A link
 * resolves by name across the vault, so a note of that name anywhere is a
 * clash. Asked of the disk, not the index, which can be behind either way.
 */
export const noteNamed = (name: string): Promise<string | null> => api.invoke(IPC.fsNameTaken, `${name}.md`)

/**
 * A card's note in `folder`, empty or with a body. `onTaken: 'number'` for a
 * name the app chose ("New task"); a typed name that is taken anywhere is
 * refused by main.
 */
export async function createCardNote(
  name: string,
  folder: string,
  body = '',
  onTaken: 'refuse' | 'number' = 'refuse',
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (name === '') return { ok: false, error: 'A card needs a name.' }
  const created = await api.invoke(IPC.fsCreate, folder, `${name}.md`, 'file', onTaken)
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
 * A card made from outside a board (the sidebar's New button): its note, in
 * the board's folder, and its line at the top of the board's first column.
 */
export async function createCard(
  boardPath: string,
  title: string,
  onTaken: 'refuse' | 'number' = 'refuse',
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const read = await api.invoke(IPC.fsRead, boardPath)
  const created = await createCardNote(title.trim(), cardFolderFor(boardPath, read.ok ? read.content : null), '', onTaken)
  if (!created.ok) return created
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

/**
 * A new board note in its own folder, under a typed name. A name a note has
 * anywhere is not taken over: `exists` says which note, and nothing is made.
 */
export async function createBoard(name: string): Promise<{ ok: true; path: string } | { ok: false; exists: string } | { ok: false; error: string }> {
  const problem = nameProblem(name, true)
  if (problem !== null) return { ok: false, error: problem }
  const existing = await noteNamed(name)
  if (existing !== null) return { ok: false, exists: existing }
  const folder = boardFolder(name)
  const created = await api.invoke(IPC.fsCreate, folder, `${name}.md`, 'file', 'refuse')
  if (!created.ok) return created
  const text = updateSettings(newBoardText(), (settings) => ({ ...settings, [NEW_NOTE_FOLDER_KEY]: folder }))
  const written = await api.invoke(IPC.fsWrite, created.path, text)
  if (!written.ok) {
    await api.invoke(IPC.fsTrash, created.path)
    return { ok: false, error: written.error ?? 'Could not write the board.' }
  }
  noteIndexChanged()
  noteEdited(created.path)
  return { ok: true, path: created.path }
}
