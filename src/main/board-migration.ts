import fs from 'node:fs'
import path from 'node:path'
import { planMigration, type BoardMigrationResult, type MigrationNote } from '../shared/board-migration'
import { isHidden } from '../shared/vault'

/**
 * Runs the boards migration (shared/board-migration.ts) on a vault's files.
 *
 * Once per vault, on its first open in this version, before the watcher and
 * the index start - so nothing it writes is taken for an edit. Every file it
 * will change is copied to `.recto/backup/<date>/` first, at its own path,
 * boards.json included; then the board notes are written, the cards lose
 * their old keys, and boards.json goes. What it did is kept in
 * `.recto/boards-migration.json`, which the notice reads.
 *
 * A board whose name is already a note's is not guessed at: nothing is
 * written, and the app asks for another name (`names`), then runs again.
 */

export const MIGRATION_RECORD = '.recto/boards-migration.json'
const BOARDS_JSON = '.recto/boards.json'

/** Every note in the vault, hidden folders (`.recto`, `.obsidian`) left out. */
function notesOf(vault: string): MigrationNote[] {
  const out: MigrationNote[] = []
  const walk = (dir: string, relative: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (isHidden(entry.name)) continue
      const rel = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push({ path: rel, text: fs.readFileSync(path.join(dir, entry.name), 'utf8') })
    }
  }
  walk(vault, '')
  return out
}

function readBoardsJson(vault: string): unknown {
  const file = path.join(vault, BOARDS_JSON)
  if (!fs.existsSync(file)) return undefined
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
  } catch {
    // Unreadable: treated like the old app treated it, as the default board.
    return null
  }
}

/** A day's backup folder, numbered when one exists already. */
function backupDir(vault: string, now: Date): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  let dir = path.join(vault, '.recto', 'backup', day)
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(vault, '.recto', 'backup', `${day}-${n}`)
  return dir
}

/** Write via a temp file and rename, so a crash never leaves half a note. */
function writeFile(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.recto-tmp`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
}

export function migrateBoards(vault: string, names: Readonly<Record<string, string>> = {}, now: Date = new Date()): BoardMigrationResult {
  const boardsJson = readBoardsJson(vault)
  const notes = notesOf(vault)
  const plan = planMigration(boardsJson, notes, names)
  if (plan.done) return { state: 'none' }
  if (plan.conflicts.length > 0) return { state: 'conflicts', conflicts: plan.conflicts }

  const changed = [...plan.edits.map((e) => e.path), ...(boardsJson === undefined ? [] : [BOARDS_JSON])]
  let backup: string | null = null
  if (changed.length > 0) {
    const dir = backupDir(vault, now)
    for (const relative of changed) {
      const target = path.join(dir, relative)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(vault, relative), target)
    }
    backup = path.relative(vault, dir)
  }

  for (const create of plan.creates) {
    const file = path.join(vault, create.path)
    // Checked again here, not only in the plan: never write over a note.
    if (fs.existsSync(file)) throw new Error(`${create.path} already exists.`)
    writeFile(file, create.text)
  }
  for (const edit of plan.edits) writeFile(path.join(vault, edit.path), edit.after)
  // Last, once everything else is written: its absence is what says it is done.
  if (boardsJson !== undefined) fs.rmSync(path.join(vault, BOARDS_JSON), { force: true })

  const result: BoardMigrationResult = {
    state: 'migrated',
    at: now.toISOString(),
    backup,
    boards: plan.creates.map((c) => ({ name: path.basename(c.path, '.md'), path: c.path, cards: c.cards })),
    cards: plan.edits.filter((e) => !plan.creates.some((c) => c.path === e.path)).length,
    changed: [...plan.creates.map((c) => c.path), ...plan.edits.map((e) => e.path)],
  }
  writeFile(path.join(vault, MIGRATION_RECORD), `${JSON.stringify(result, null, 2)}\n`)
  return result
}
