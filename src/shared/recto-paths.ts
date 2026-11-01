import { parseKanban } from './kanban'
import { parentOf } from './vault'

/**
 * Where Recto keeps the notes its own features make, in one place.
 *
 *   Recto/README.md                 says what the folder is
 *   Recto/Boards/<Board>/<Board>.md a board (Obsidian Kanban format)
 *   Recto/Boards/<Board>/<Card>.md  cards whose home is that board
 *   Recto/Unsorted/<Card>.md        cards on no board
 *   Recto/Chats/<bot>/...           chat topics
 *
 * They are ordinary Markdown notes: indexed, searchable, linkable by name and
 * synced like any other. The Data tree hides `Recto/` with one rule. Machine
 * data stays in `.recto/`.
 */

export const RECTO_FOLDER = 'Recto'
export const BOARDS_FOLDER = `${RECTO_FOLDER}/Boards`
export const UNSORTED_FOLDER = `${RECTO_FOLDER}/Unsorted`
export const CHATS_FOLDER = `${RECTO_FOLDER}/Chats`
export const RECTO_README = `${RECTO_FOLDER}/README.md`
/** The README's name when a note called README exists elsewhere already: names are unique vault-wide. */
export const RECTO_README_FALLBACK = `${RECTO_FOLDER}/Recto README.md`
export const RECTO_README_TEXT =
  "This folder is managed by Recto (boards and their tasks). Notes here are normal Markdown; don't rename the folder.\n"

/** Where boards, cards and chats lived before v0.53.1; read only by the migration. */
export const LEGACY_TASKS_FOLDER = 'tasks'
export const LEGACY_CHATS_FOLDER = 'chats'

/** The Obsidian Kanban key for the folder new notes made from a board's cards go in. */
export const NEW_NOTE_FOLDER_KEY = 'new-note-folder'

const within = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}/`)

export const inRecto = (path: string): boolean => within(path, RECTO_FOLDER)
/** The note that says what the folder is: Recto's, not one of yours, so the graph and the overview leave it out. */
export const isRectoReadme = (path: string): boolean => path === RECTO_README || path === RECTO_README_FALLBACK
export const isChatPath = (path: string): boolean => within(path, CHATS_FOLDER)

/** What moving tasks/ and chats/ into Recto/ did (main/layout-migration.ts), kept in `.recto/layout-migration.json`. */
export type LayoutMigrationResult =
  | { state: 'none' }
  | { state: 'conflicts'; conflicts: { from: string; to: string }[] }
  | { state: 'failed'; error: string }
  | {
      state: 'migrated'
      at: string
      backup: string | null
      moves: { from: string; to: string }[]
      links: { path: string; from: string; to: string }[]
    }

/** A board's folder and its file, from its name. */
export const boardFolder = (name: string): string => `${BOARDS_FOLDER}/${name}`
export const boardFile = (name: string): string => `${boardFolder(name)}/${name}.md`

/** A board's own folder when it lives in Recto's layout (`Recto/Boards/<B>/<B>.md`), else null. */
export function ownFolderOf(boardPath: string): string | null {
  const folder = parentOf(boardPath)
  if (parentOf(folder) !== BOARDS_FOLDER) return null
  const name = folder.slice(folder.lastIndexOf('/') + 1)
  return boardPath === `${folder}/${name}.md` ? folder : null
}

/**
 * Whether a card's file is Recto's to place: it lives in a board's folder or
 * in Unsorted. A note anywhere else is the person's, and stays where it is.
 */
export const isPlacedCard = (path: string): boolean =>
  (path.startsWith(`${BOARDS_FOLDER}/`) && parentOf(path) !== BOARDS_FOLDER) || within(parentOf(path), UNSORTED_FOLDER)

/**
 * Where a placed card's file belongs once a change in Recto left it on
 * `boards` (the board files that link it), or null to leave it where it is.
 *
 * - On no board: Unsorted.
 * - On exactly one board that has its own folder: that folder.
 * - On several: it stays - unless its folder is a board's that no longer
 *   lists it (that board was deleted, or let it go), then the first of the
 *   others with a folder of its own, by name.
 */
export function placeFor(cardPath: string, boards: readonly string[]): string | null {
  if (!isPlacedCard(cardPath)) return null
  const here = parentOf(cardPath)
  const folders = [...new Set(boards.map(ownFolderOf).filter((f): f is string => f !== null))].sort((a, b) => a.localeCompare(b))
  let target: string | null
  if (boards.length === 0) target = UNSORTED_FOLDER
  else if (boards.length === 1) target = folders[0] ?? null
  else target = folders.includes(here) || within(here, UNSORTED_FOLDER) ? null : (folders[0] ?? null)
  // Left in the folder of a board that no longer lists it, with no Recto board to go to.
  if (target === null && parentOf(here) === BOARDS_FOLDER && !folders.includes(here)) target = UNSORTED_FOLDER
  return target === null || target === here ? null : target
}

/** The folder a new card made on `boardPath` goes in: the board's `new-note-folder`, else its own folder, else Unsorted. */
export function cardFolderFor(boardPath: string, boardText: string | null): string {
  const setting = boardText === null ? undefined : parseKanban(boardText).settings[NEW_NOTE_FOLDER_KEY]
  if (typeof setting === 'string' && setting.trim() !== '') return setting.trim().replace(/^\/+|\/+$/g, '')
  return ownFolderOf(boardPath) ?? UNSORTED_FOLDER
}
