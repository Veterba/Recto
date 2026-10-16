import { api } from '../../app/api'
import { setField } from '@shared/frontmatter'
import { noteIndexChanged } from '../../app/note-bus'
import { placeAt } from './ordering'
import { IPC } from '@shared/ipc'

/**
 * Create a card, which means: create a note and put three keys in its
 * frontmatter.
 *
 * Shared by the board's new-card popover and the sidebar's new-task button so
 * the two cannot produce differently-shaped cards. The note has no H1: a card's
 * title is its file name, as everywhere else in Recto, and a heading repeating
 * it would show the name twice.
 */

/** Where new cards are written. A folder, not a database. */
export const CARD_FOLDER = 'tasks'

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

export async function createCard(
  board: string,
  column: string,
  title: string,
  /**
   * The card's order, when the caller has the column on screen; otherwise it
   * goes last, asked of the index. `onTaken: 'number'` for a name the app chose
   * ("New task"); a typed name that is taken anywhere is refused by main.
   */
  options: { order?: number; onTaken?: 'refuse' | 'number' } = {},
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const name = title.trim()
  if (name === '') return { ok: false, error: 'A card needs a name.' }

  const created = await api.invoke(IPC.fsCreate, CARD_FOLDER, `${name}.md`, 'file', options.onTaken)
  if (!created.ok) return created

  let order = options.order
  if (order === undefined) {
    const cards = await api.invoke(IPC.indexBoard, board)
    const orders = cards
      .filter((card) => card.status === column)
      .map((card) => card.order)
      .filter((value): value is number => value !== null)
    const placed = placeAt(orders, orders.length)
    order = placed.kind === 'order' ? placed.order : placed.orders.at(-1)!
  }

  let text = ''
  text = setField(text, 'board', board)
  text = setField(text, 'status', column)
  text = setField(text, 'order', order)

  const written = await api.invoke(IPC.fsWrite, created.path, text)
  if (!written.ok) {
    // An empty note that is no card helps nobody.
    await api.invoke(IPC.fsTrash, created.path)
    return { ok: false, error: written.error ?? 'Could not write the card.' }
  }

  noteIndexChanged()
  return { ok: true, path: created.path }
}
