import { api } from '../api'
import { setField } from '../core/frontmatter'
import { noteIndexChanged } from '../core/note-bus'
import { placeAt } from './ordering'

/**
 * Create a card, which means: create a note and put three keys in its
 * frontmatter.
 *
 * Shared by the board's "Add card" and the sidebar's new-task button so the two
 * cannot produce differently-shaped cards. It asks the index for the column's
 * current orders rather than taking them as an argument, so a caller that has
 * no board on screen (the sidebar) can use it too.
 */

/** Where new cards are written. A folder, not a database. */
export const CARD_FOLDER = 'tasks'

export async function createCard(
  board: string,
  column: string,
  title: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const name = title.trim()
  if (name === '') return { ok: false, error: 'A card needs a name.' }

  const created = await api.invoke('fs:create', CARD_FOLDER, `${name}.md`, 'file')
  if (!created.ok) return created

  const cards = await api.invoke('index:board', board)
  const orders = cards
    .filter((card) => card.status === column)
    .map((card) => card.order)
    .filter((order): order is number => order !== null)
  const placed = placeAt(orders, orders.length)
  const order = placed.kind === 'order' ? placed.order : placed.orders.at(-1)!

  let text = ''
  text = setField(text, 'board', board)
  text = setField(text, 'status', column)
  text = setField(text, 'order', order)

  const written = await api.invoke('fs:write', created.path, `${text}# ${name}\n`)
  if (!written.ok) return { ok: false, error: written.error ?? 'Could not write the card.' }

  noteIndexChanged()
  return { ok: true, path: created.path }
}
