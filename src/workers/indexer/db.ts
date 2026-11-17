/**
 * The open index: one SQLite connection per vault, migrated on open.
 */

import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { runMigrations } from './migrations'

let db: Database.Database | null = null

export let vaultRoot = ''

export function open(root: string, dbPath: string): { migratedFrom: number; migratedTo: number } {
  closeDb()
  vaultRoot = root
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  try {
    return connect(dbPath)
  } catch (err) {
    // A damaged file (a crash, a sync conflict) would fail every open, this
    // launch and the next. It is set aside, not deleted - version history is
    // in it - and a new index is built from the notes. Other failures (no
    // permission, a bad migration) still throw: those are not the file's
    // fault, and setting it aside would lose history for nothing.
    if (!isDamaged(err)) throw err
    const aside = setAside(dbPath)
    console.error(`[indexer] ${dbPath} is damaged (${(err as { code: string }).code}); moved to ${aside} and rebuilding`)
    return connect(dbPath)
  }
}

function connect(dbPath: string): { migratedFrom: number; migratedTo: number } {
  const handle = new Database(dbPath)
  try {
    handle.pragma('journal_mode = WAL')
    handle.pragma('foreign_keys = ON')
    // A cache can afford to lose the last few writes to a power cut; it cannot
    // afford to fsync on every keystroke-triggered reindex.
    handle.pragma('synchronous = NORMAL')
    // The embedder writes topic vectors into this same file. Without a wait,
    // the moment both write at once SQLite fails the indexer's statement with
    // "database is locked" instead of letting it queue for the lock; the
    // embedder already waits up to 5 s, and so does this side now.
    handle.pragma('busy_timeout = 5000')

    const { from, to } = runMigrations(handle)
    db = handle
    return { migratedFrom: from, migratedTo: to }
  } catch (err) {
    handle.close()
    throw err
  }
}

const isDamaged = (err: unknown): boolean => {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && (code === 'SQLITE_NOTADB' || code.startsWith('SQLITE_CORRUPT'))
}

/** Moves the file and its WAL aside as index.db.corrupt-<time> (+ -wal, -shm), so SQLite can still open the copy. */
function setAside(dbPath: string): string {
  const aside = `${dbPath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.renameSync(dbPath + suffix, aside + suffix)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
  return aside
}

export function requireDb(): Database.Database {
  if (!db) throw new Error('index not open')
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
