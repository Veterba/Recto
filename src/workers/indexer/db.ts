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
  db?.close()
  vaultRoot = root
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const handle = new Database(dbPath)
  handle.pragma('journal_mode = WAL')
  handle.pragma('foreign_keys = ON')
  // A cache can afford to lose the last few writes to a power cut; it cannot
  // afford to fsync on every keystroke-triggered reindex.
  handle.pragma('synchronous = NORMAL')

  const { from, to } = runMigrations(handle)
  db = handle
  return { migratedFrom: from, migratedTo: to }
}

export function requireDb(): Database.Database {
  if (!db) throw new Error('index not open')
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
