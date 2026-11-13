import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import { insertItem, isKanban, parseKanban, updateSettings } from '../shared/kanban'
import { formatLink, resolveLinkpath } from '../shared/obsidian-links'
import {
  boardFolder,
  isPlacedCard,
  NEW_NOTE_FOLDER_KEY,
  ownFolderOf,
  placeFor,
  RECTO_FOLDER,
  RECTO_README,
  RECTO_README_FALLBACK,
  RECTO_README_TEXT,
  UNSORTED_FOLDER,
} from '../shared/recto-paths'
import { nameOf, nameProblem, type RenameOutcome } from '../shared/vault'
import type { BoardDeleteChoice, BoardDeleteResult } from '../shared/ipc'
import { currentLinkSettings, currentLinkVault } from './link-context'
import { resolveInVault } from './paths'
import { currentVault } from './vault'
import * as vaultFs from './vault-fs'
import { markSelfWrite } from './watcher'

/**
 * Where boards' and cards' files live, kept in step with what the boards say
 * (layout in shared/recto-paths.ts).
 *
 * Runs in main because it moves files: every move goes through `relocate`, the
 * same path as a rename in the tree, so links follow and history moves with
 * the note. A card file is moved only when it is Recto's to place - in a
 * board's folder or in Unsorted; a note from anywhere else that sits on a
 * board is never moved and never trashed.
 *
 * What lists a card is read from the board files on disk, not the index, so a
 * board written a moment ago counts.
 */

type Relocate = (
  from: string,
  apply: () => Promise<{ ok: true; path: string } | { ok: false; error: string }>,
  /** One answer to Update links for a run of moves (main/ipc.ts). */
  asked?: { update?: boolean },
) => Promise<RenameOutcome | { ok: false; error: string }>

type Deps = {
  relocate: Relocate
  /** Board notes the index knows. Boards written since are passed in by the caller. */
  listBoards: () => Promise<string[]>
}

const root = (): string => {
  const vault = currentVault()
  if (vault === null) throw new Error('No vault is open.')
  return vault.path
}

const readText = (relative: string): string | null => {
  try {
    return fs.readFileSync(resolveInVault(root(), relative), 'utf8')
  } catch {
    return null
  }
}

function writeText(relative: string, text: string): void {
  markSelfWrite(relative)
  const file = resolveInVault(root(), relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf8')
}

/** The note each `[[link]]` on a board names, read from the board it is on - Obsidian's rules, as the index reads it. */
function resolver(): (target: string, board: string) => string | null {
  const files = currentLinkVault()
  return (target, board) => resolveLinkpath(target, board, files)
}

/** The notes a board's lines link, its `## Archive` left out. */
function cardsOn(text: string, board: string, resolve: (target: string, board: string) => string | null): string[] {
  return parseKanban(text).lanes.flatMap((lane) =>
    lane.items.flatMap((item) => {
      const card = item.link === null ? null : resolve(item.link, board)
      return card === null ? [] : [card]
    }),
  )
}

/** An undo for a board delete, in memory: for the next minute of "that was a mistake". */
type Undo = {
  /** Files put in the Trash - the board note, and cards trashed with it - as they were. */
  trashed: { path: string; data: Buffer }[]
  /** Cards that moved, to move back. */
  moved: { from: string; to: string }[]
  /** Another board that took the lines, as it was and as it was written. */
  merged: { path: string; before: string; after: string } | null
}
const undos = new Map<string, Undo>()

export function createBoardOps({ relocate, listBoards }: Deps) {
  /** Board files now, read fresh: the index's list, plus `extra`, minus `gone`. */
  async function boardTexts(extra: readonly string[], gone: readonly string[]): Promise<Map<string, string>> {
    const listed = await listBoards().catch(() => [] as string[])
    const out = new Map<string, string>()
    for (const p of new Set([...listed, ...extra])) {
      if (gone.includes(p)) continue
      const text = readText(p)
      if (text !== null && isKanban(text)) out.set(p, text)
    }
    return out
  }

  async function moveTo(card: string, folder: string): Promise<string | null> {
    fs.mkdirSync(resolveInVault(root(), folder), { recursive: true })
    // Recto's own tidying, not the user's move: the links follow without asking, or they would break.
    const moved = await relocate(card, () => vaultFs.move(card, folder), { update: true })
    return moved.ok ? moved.path : null
  }

  /**
   * After a change in Recto, put each placed card where the rules say (see
   * `placeFor`). Returns what moved.
   */
  async function placeCards(
    cards: readonly string[],
    extra: readonly string[] = [],
    gone: readonly string[] = [],
  ): Promise<{ from: string; to: string }[]> {
    const placed = cards.filter(isPlacedCard)
    if (placed.length === 0) return []
    const boards = await boardTexts(extra, gone)
    const resolve = resolver()
    const linking = new Map<string, string[]>()
    for (const [board, text] of boards) for (const card of cardsOn(text, board, resolve)) linking.set(card, [...(linking.get(card) ?? []), board])
    const moved: { from: string; to: string }[] = []
    for (const card of new Set(placed)) {
      const target = placeFor(card, [...new Set(linking.get(card) ?? [])])
      if (target === null) continue
      const to = await moveTo(card, target)
      if (to !== null) moved.push({ from: card, to })
    }
    return moved
  }

  /**
   * Rename a board. One in its own folder takes the folder with it: the board
   * note is renamed (its links follow), then every file moves to the new
   * folder one by one (so each keeps its history), and the board's
   * `new-note-folder` follows. Anywhere else it is a plain rename.
   */
  async function renameBoard(boardPath: string, name: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    const clean = name.trim()
    if (clean === '') return { ok: false, error: 'A board needs a name.' }
    const problem = nameProblem(clean)
    if (problem !== null) return { ok: false, error: problem }
    const own = ownFolderOf(boardPath)
    // The board and every file in its folder move: Update links is asked once for them all.
    const asked: { update?: boolean } = {}
    if (own === null) {
      const renamed = await relocate(boardPath, () => vaultFs.rename(boardPath, `${clean}.md`), asked)
      return renamed.ok ? { ok: true, path: renamed.path } : renamed
    }
    const folder = boardFolder(clean)
    const sameFolder = folder.normalize('NFC').toLowerCase() === own.normalize('NFC').toLowerCase()
    if (!sameFolder && fs.existsSync(resolveInVault(root(), folder))) return { ok: false, error: `A folder ${folder}/ exists already.` }
    const renamed = await relocate(boardPath, () => vaultFs.rename(boardPath, `${clean}.md`), asked)
    if (!renamed.ok) return renamed
    let board = renamed.path
    if (!sameFolder) {
      fs.mkdirSync(resolveInVault(root(), folder), { recursive: true })
      for (const entry of fs.readdirSync(resolveInVault(root(), own))) {
        const from = `${own}/${entry}`
        const moved = await relocate(from, () => vaultFs.move(from, folder), asked)
        if (moved.ok && from === board) board = moved.path
      }
      removeIfEmpty(own)
    } else if (own !== folder) {
      // Only the case changed: the folder is renamed in place, its notes' history and links with it.
      const renamedFolder = await relocate(own, () => vaultFs.rename(own, clean), asked)
      if (renamedFolder.ok) board = `${folder}/${nameOf(board)}`
    }
    setNewNoteFolder(board, folder)
    return { ok: true, path: board }
  }

  /**
   * Delete a board: the note goes to the macOS Trash, and its cards go where
   * `choice` says. Every delete has an undo that puts it all back.
   *
   * - `unsorted`: each placed card that no other board lists goes to Unsorted.
   * - `board`: its lines are added to another board (to the lane of the same
   *   title, else the first), skipping cards already there; the files follow.
   * - `trash`: each placed card no other board lists goes to the Trash too.
   *
   * A card another board still links stays on that board, its file placed by
   * the rules. A note outside Recto's folders only loses its line.
   */
  async function deleteBoard(boardPath: string, choice: BoardDeleteChoice): Promise<BoardDeleteResult> {
    const text = readText(boardPath)
    if (text === null) return { ok: false, error: 'The board could not be read.' }
    const resolve = resolver()
    const cards = [...new Set(cardsOn(text, boardPath, resolve))]
    const extra: string[] = []
    let merged: Undo['merged'] = null

    if (choice.kind === 'board') {
      const linkFiles = currentLinkVault()
      const linkFormat = { newLinkFormat: currentLinkSettings().newLinkFormat, useMarkdownLinks: false }
      const target = readText(choice.to)
      if (target === null || !isKanban(target)) return { ok: false, error: 'The other board could not be read.' }
      const there = new Set(cardsOn(target, choice.to, resolve))
      const lanes = parseKanban(target).lanes
      if (lanes.length === 0) return { ok: false, error: `${nameOf(choice.to).replace(/\.md$/i, '')} has no column to put the cards in.` }
      let next = target
      for (const lane of parseKanban(text).lanes) {
        const index = Math.max(0, lanes.findIndex((l) => l.title === lane.title))
        for (const item of lane.items) {
          const card = item.link === null ? null : resolve(item.link, boardPath)
          if (card !== null && there.has(card)) continue
          // Its link written again for the board it goes to: the same words there could mean another note.
          const line = card === null ? item.text : item.text.replace(/\[\[[^\]|]*/, () => formatLink(card, choice.to, linkFiles, linkFormat, { markdown: false }).slice(0, -2))
          next = insertItem(next, index, Number.MAX_SAFE_INTEGER, line.replace(/\n/g, '\n    '), item.checked)
        }
      }
      if (next !== target) {
        writeText(choice.to, next)
        merged = { path: choice.to, before: target, after: next }
      }
      extra.push(choice.to)
    }

    const trashed: { path: string; data: Buffer }[] = []
    const toTrash = async (relative: string): Promise<void> => {
      const file = resolveInVault(root(), relative)
      const data = fs.readFileSync(file)
      await shell.trashItem(file)
      trashed.push({ path: relative, data })
    }
    try {
      await toTrash(boardPath)
    } catch (err) {
      return { ok: false, error: `The board could not be moved to the Trash. ${err instanceof Error ? err.message : String(err)}` }
    }

    const boards = await boardTexts(extra, [boardPath])
    const stillListed = new Set([...boards].flatMap(([b, t]) => cardsOn(t, b, resolve)))
    if (choice.kind === 'trash') for (const card of cards) if (isPlacedCard(card) && !stillListed.has(card)) await toTrash(card)
    const rest = cards.filter((c) => !trashed.some((t) => t.path === c))
    const moved = await placeCards(rest, extra, [boardPath])

    const own = ownFolderOf(boardPath)
    if (own !== null) {
      // Whatever is left in its folder that is Recto's - cards that were on no
      // board - goes to Unsorted rather than holding the folder open.
      for (const left of fs.readdirSync(resolveInVault(root(), own))) {
        const relative = `${own}/${left}`
        if (!left.toLowerCase().endsWith('.md')) continue
        const to = await moveTo(relative, UNSORTED_FOLDER)
        if (to !== null) moved.push({ from: relative, to })
      }
      removeIfEmpty(own)
    }

    const undoId = `board-${Date.now().toString(36)}`
    undos.set(undoId, { trashed, moved, merged })
    if (undos.size > 10) undos.delete([...undos.keys()][0] ?? '')
    return { ok: true, moved, trashed: trashed.map((t) => t.path).filter((p) => p !== boardPath), undoId }
  }

  /**
   * Put a deleted board back as it was: the files it trashed (the copies in
   * the Trash stay there), the cards it moved, and the other board's lines -
   * that board only when nobody changed it since.
   */
  async function undoDelete(undoId: string): Promise<{ ok: boolean; error?: string }> {
    const entry = undos.get(undoId)
    if (entry === undefined) return { ok: false, error: 'That undo is no longer available.' }
    undos.delete(undoId)
    for (const file of entry.trashed) {
      const absolute = resolveInVault(root(), file.path)
      if (fs.existsSync(absolute)) continue
      markSelfWrite(file.path)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, file.data)
    }
    for (const move of [...entry.moved].reverse()) {
      if (!fs.existsSync(resolveInVault(root(), move.to)) || fs.existsSync(resolveInVault(root(), move.from))) continue
      await moveTo(move.to, path.posix.dirname(move.from))
    }
    if (entry.merged !== null && readText(entry.merged.path) === entry.merged.after) writeText(entry.merged.path, entry.merged.before)
    return { ok: true }
  }

  return { placeCards, renameBoard, deleteBoard, undoDelete }
}

/** Point a board's `new-note-folder` at its folder; nothing else in its settings changes. */
export function setNewNoteFolder(boardPath: string, folder: string): void {
  const text = readText(boardPath)
  if (text === null || !isKanban(text)) return
  let next: string
  try {
    next = updateSettings(text, (settings) => ({ ...settings, [NEW_NOTE_FOLDER_KEY]: folder }))
  } catch {
    // A settings block that does not parse is left as it is.
    return
  }
  if (next !== text) writeText(boardPath, next)
}

function removeIfEmpty(folder: string): void {
  const dir = resolveInVault(root(), folder)
  try {
    const left = fs.readdirSync(dir).filter((name) => name !== '.DS_Store')
    if (left.length === 0) fs.rmSync(dir, { recursive: true })
  } catch {
    // Gone already, or not empty after all: nothing to do.
  }
}

/**
 * `Recto/README.md` - what the folder is - once the folder exists, whatever
 * README another folder has (one of a name per folder, as in Obsidian). A
 * "Recto README" an older Recto wrote counts as the README.
 */
export function ensureReadme(vault: string): string | null {
  if (!fs.existsSync(path.join(vault, RECTO_FOLDER))) return null
  for (const candidate of [RECTO_README, RECTO_README_FALLBACK]) if (fs.existsSync(path.join(vault, candidate))) return null
  markSelfWrite(RECTO_README)
  fs.writeFileSync(path.join(vault, RECTO_README), RECTO_README_TEXT, { encoding: 'utf8', flag: 'wx' })
  return RECTO_README
}

