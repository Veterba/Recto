import fs from 'node:fs'
import path from 'node:path'
import { isKanban, parseKanban, updateSettings } from '../shared/kanban'
import { normalizeName } from '../shared/parse'
import { formatLink, linkVault, resolveLinkpath, splitSubpath } from '../shared/obsidian-links'
import {
  boardFile,
  boardFolder,
  CHATS_FOLDER,
  LEGACY_CHATS_FOLDER,
  LEGACY_TASKS_FOLDER,
  NEW_NOTE_FOLDER_KEY,
  ownFolderOf,
  RECTO_README,
  RECTO_README_FALLBACK,
  RECTO_README_TEXT,
  UNSORTED_FOLDER,
  type LayoutMigrationResult,
} from '../shared/recto-paths'
import { isHidden, nameOf } from '../shared/vault'
import { mapLinkTargets } from './link-rewrite'

/**
 * Once per vault: the flat `tasks/` and `chats/` folders become Recto's
 * layout (shared/recto-paths.ts).
 *
 *   tasks/<Board>.md (a board)    -> Recto/Boards/<Board>/<Board>.md
 *   tasks/<Card>.md on one board  -> Recto/Boards/<Board>/<Card>.md
 *   ... on several                -> the folder of the first of them, by name
 *   ... on none (or only on boards outside tasks/), and anything else in
 *       tasks/                     -> Recto/Unsorted/, subfolders kept
 *   chats/**                      -> Recto/Chats/**
 *
 * Every moved board gets `new-note-folder` set to its folder; nothing else in
 * its settings changes. Links resolve by name, so a `[[Card]]` keeps working
 * as it is. A link that would end up at another file, or that spells out a
 * path that no longer exists (`[[tasks/Card]]`, written when two notes share
 * the name), is rewritten to the new shortest unique form - and only those.
 *
 * `planLayout` is pure: the files in, what to do out. `migrateLayout` backs up
 * every file it moves or changes first, then does it, and keeps what it did
 * in `.recto/layout-migration.json`, which the notice reads. Nothing is
 * written when a target is taken.
 */

export const LAYOUT_RECORD = '.recto/layout-migration.json'

export type LayoutFile = { path: string; text?: string }

export type LayoutPlan = {
  moves: { from: string; to: string }[]
  /** Notes whose text changes, by their path after the moves. */
  edits: { path: string; from: string; before: string; after: string; links: { from: string; to: string }[] }[]
  creates: { path: string; text: string }[]
  /** Targets that exist already, or that two files would take. */
  conflicts: { from: string; to: string }[]
}

export type { LayoutMigrationResult }

const within = (p: string, folder: string): boolean => p === folder || p.startsWith(`${folder}/`)
const stem = (p: string): string => nameOf(p).replace(/\.md$/i, '')
const isNote = (p: string): boolean => p.toLowerCase().endsWith('.md')
const key = (p: string): string => p.normalize('NFC').toLowerCase()

export function planLayout(files: readonly LayoutFile[]): LayoutPlan {
  const plan: LayoutPlan = { moves: [], edits: [], creates: [], conflicts: [] }
  const notes = files.filter((f) => isNote(f.path))
  // Links are read as Obsidian reads them, from the note they are in (shared/obsidian-links.ts).
  const oldVault = linkVault(notes.map((n, i) => ({ path: n.path, ctime: i })))
  const resolveOld = (target: string, source: string): string | null => resolveLinkpath(splitSubpath(target).path, source, oldVault)

  // Boards in tasks/ move to their own folders; boards anywhere list cards.
  const boards = notes.filter((n) => n.text !== undefined && isKanban(n.text))
  const target = new Map<string, string>()
  for (const board of boards) if (within(board.path, LEGACY_TASKS_FOLDER)) target.set(board.path, boardFile(stem(board.path)))
  const linkedFrom = new Map<string, string[]>()
  for (const board of boards) {
    for (const lane of parseKanban(board.text!).lanes)
      for (const item of lane.items) {
        const card = item.link === null ? null : resolveOld(item.link, board.path)
        if (card !== null && card !== board.path) linkedFrom.set(card, [...new Set([...(linkedFrom.get(card) ?? []), board.path])])
      }
  }

  for (const file of files) {
    if (target.has(file.path)) continue
    if (within(file.path, LEGACY_TASKS_FOLDER)) {
      const homes = (linkedFrom.get(file.path) ?? [])
        .map((b) => target.get(b) ?? b)
        .map(ownFolderOf)
        .filter((f): f is string => f !== null)
        .sort((a, b) => a.localeCompare(b))
      const home = isNote(file.path) ? homes[0] : undefined
      target.set(file.path, home !== undefined ? `${home}/${nameOf(file.path)}` : `${UNSORTED_FOLDER}${file.path.slice(LEGACY_TASKS_FOLDER.length)}`)
    } else if (within(file.path, LEGACY_CHATS_FOLDER)) {
      target.set(file.path, `${CHATS_FOLDER}${file.path.slice(LEGACY_CHATS_FOLDER.length)}`)
    }
  }

  // Taken: a file already there that is not moving away, or two files to one place.
  const staying = new Set(files.filter((f) => !target.has(f.path)).map((f) => key(f.path)))
  const claimed = new Set<string>()
  for (const [from, to] of target) {
    if (staying.has(key(to)) || claimed.has(key(to))) plan.conflicts.push({ from, to })
    claimed.add(key(to))
  }
  if (plan.conflicts.length > 0) return plan
  plan.moves = [...target].map(([from, to]) => ({ from, to }))
  if (plan.moves.length === 0) return plan

  // Links: compare where each target resolves before and after the moves.
  const moved = (p: string): string => target.get(p) ?? p
  const newVault = linkVault(notes.map((n, i) => ({ path: moved(n.path), ctime: i })))
  const resolveNew = (t: string, source: string): string | null => resolveLinkpath(splitSubpath(t).path, source, newVault)
  /** How Obsidian writes a link to `p` from `source`, as a wikilink's target: its name, or its path when another note has the name. */
  const linkFor = (p: string, source: string): string => formatLink(p, source, newVault, { newLinkFormat: 'shortest', useMarkdownLinks: false }).slice(2, -2)
  const pathStillMatches = (written: string, p: string): boolean => {
    if (!written.includes('/')) return true
    const w = normalizeName(written.replace(/\\/g, '/').replace(/^\.\//, ''))
    const n = normalizeName(p)
    return n === w || n.endsWith(`/${w}`)
  }

  for (const note of notes) {
    if (note.text === undefined) continue
    const now = moved(note.path)
    let text = note.text
    const result = mapLinkTargets(text, (written, kind) => {
      const before = resolveOld(written, note.path)
      if (before === null) return null
      const expected = moved(before)
      if (resolveNew(written, now) === expected && pathStillMatches(written, expected)) return null
      if (kind === 'markdown') return expected
      return /\.md$/i.test(written) ? `${linkFor(expected, now)}.md` : linkFor(expected, now)
    })
    text = result.text
    if (target.has(note.path) && ownFolderOf(now) !== null && isKanban(text)) {
      try {
        text = updateSettings(text, (settings) => ({ ...settings, [NEW_NOTE_FOLDER_KEY]: boardFolder(stem(now)) }))
      } catch {
        // A settings block that does not parse is left as it is.
      }
    }
    if (text !== note.text) plan.edits.push({ path: now, from: note.path, before: note.text, after: text, links: result.changes })
  }

  const all = new Set([...files.map((f) => moved(f.path))].map(key))
  if (!all.has(key(RECTO_README)) && !all.has(key(RECTO_README_FALLBACK)))
    plan.creates.push({ path: RECTO_README, text: RECTO_README_TEXT })
  return plan
}

/** Every file, hidden folders left out; notes with their text. */
function filesOf(vault: string): LayoutFile[] {
  const out: LayoutFile[] = []
  const walk = (dir: string, rel: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (isHidden(entry.name) || entry.isSymbolicLink()) continue
      const relative = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relative)
      else if (entry.isFile())
        out.push(isNote(relative) ? { path: relative, text: fs.readFileSync(path.join(dir, entry.name), 'utf8') } : { path: relative })
    }
  }
  walk(vault, '')
  return out
}

function backupDir(vault: string, now: Date): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  let dir = path.join(vault, '.recto', 'backup', `layout-${day}`)
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(vault, '.recto', 'backup', `layout-${day}-${n}`)
  return dir
}

function writeFile(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.recto-tmp`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
}

/** A legacy folder and its subfolders, removed once nothing is left in them. */
function removeEmpty(dir: string): void {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) removeEmpty(path.join(dir, entry.name))
  const left = fs.readdirSync(dir).filter((name) => name !== '.DS_Store')
  if (left.length === 0) fs.rmSync(dir, { recursive: true })
}

/**
 * Run once per vault, before the watcher and the index start. A vault with no
 * tasks/ or chats/ only gets its record, so a folder of that name made later
 * is the person's and never moved.
 */
export function migrateLayout(vault: string, now: Date = new Date()): LayoutMigrationResult {
  const record = path.join(vault, LAYOUT_RECORD)
  if (fs.existsSync(record)) return { state: 'none' }
  const legacy = [LEGACY_TASKS_FOLDER, LEGACY_CHATS_FOLDER].some((f) => fs.existsSync(path.join(vault, f)))
  if (!legacy) {
    writeFile(record, `${JSON.stringify({ state: 'none' } satisfies LayoutMigrationResult, null, 2)}\n`)
    return { state: 'none' }
  }
  const plan = planLayout(filesOf(vault))
  if (plan.conflicts.length > 0) return { state: 'conflicts', conflicts: plan.conflicts }

  // Back up everything that moves or changes, at its path before the move.
  const dir = backupDir(vault, now)
  const copied = new Set<string>()
  for (const relative of [...plan.moves.map((m) => m.from), ...plan.edits.map((e) => e.from)]) {
    if (copied.has(relative)) continue
    copied.add(relative)
    const backup = path.join(dir, relative)
    fs.mkdirSync(path.dirname(backup), { recursive: true })
    fs.copyFileSync(path.join(vault, relative), backup)
  }

  for (const move of plan.moves) {
    const to = path.join(vault, move.to)
    if (fs.existsSync(to)) throw new Error(`${move.to} already exists.`)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.renameSync(path.join(vault, move.from), to)
  }
  for (const edit of plan.edits) writeFile(path.join(vault, edit.path), edit.after)
  for (const create of plan.creates) if (!fs.existsSync(path.join(vault, create.path))) writeFile(path.join(vault, create.path), create.text)
  for (const folder of [LEGACY_TASKS_FOLDER, LEGACY_CHATS_FOLDER]) removeEmpty(path.join(vault, folder))

  const result: LayoutMigrationResult = {
    state: 'migrated',
    at: now.toISOString(),
    backup: copied.size === 0 ? null : path.relative(vault, dir),
    moves: plan.moves,
    links: plan.edits.flatMap((e) => e.links.map((l) => ({ path: e.path, ...l }))),
  }
  writeFile(record, `${JSON.stringify(result, null, 2)}\n`)
  return result
}
