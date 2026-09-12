import type { Database } from 'better-sqlite3'
import type { Snapshot } from './protocol'

/**
 * Version history storage.
 *
 * Extracted from the indexer so the retention rules can be tested against a
 * real in-memory database rather than only through the running app. That matters
 * because the first implementation had a bug the rules themselves describe:
 * history that began at your *first edit*, so the content you had before it -
 * the version you are most likely to want back - was never captured.
 *
 * The rules, in one place:
 *
 *  1. A baseline is stored the first time a note is seen, not only when it
 *     changes.
 *  2. Identical content is never stored twice in a row.
 *  3. Within the throttle window, a new version replaces the newest rather than
 *     adding - so holding a key down does not store a hundred copies.
 *  4. Rule 3 never applies when only one version exists, or it would overwrite
 *     the baseline with the edit that replaced it. That is bug #1 again.
 *  5. The newest N per note are kept; older than M days is pruned.
 */

export const SNAPSHOT_MIN_INTERVAL_MS = 60_000
export const SNAPSHOT_KEEP_PER_NOTE = 30
export const SNAPSHOT_MAX_AGE_MS = 30 * 86_400_000

/** Injectable clock, so the tests do not have to sleep for a minute. */
export type Now = () => number

export function takeSnapshot(db: Database, path: string, content: string, now: Now = Date.now): void {
  const latest = db
    .prepare('SELECT content, ts FROM snapshots WHERE path = ? ORDER BY ts DESC LIMIT 1')
    .get(path) as { content: string; ts: number } | undefined

  if (latest !== undefined) {
    if (latest.content === content) return

    const count = (db.prepare('SELECT COUNT(*) AS n FROM snapshots WHERE path = ?').get(path) as { n: number }).n

    if (count > 1 && now() - latest.ts < SNAPSHOT_MIN_INTERVAL_MS) {
      db.prepare('UPDATE snapshots SET content = ?, bytes = ?, ts = ? WHERE path = ? AND ts = ?').run(
        content,
        Buffer.byteLength(content),
        now(),
        path,
        latest.ts,
      )
      return
    }
  }

  db.prepare('INSERT INTO snapshots (path, content, bytes, ts) VALUES (?, ?, ?, ?)').run(
    path,
    content,
    Buffer.byteLength(content),
    now(),
  )

  db.prepare(
    `DELETE FROM snapshots WHERE path = ? AND id NOT IN (
       SELECT id FROM snapshots WHERE path = ? ORDER BY ts DESC LIMIT ?
     )`,
  ).run(path, path, SNAPSHOT_KEEP_PER_NOTE)
}

/** Content is omitted: listing 30 versions of a long note would be megabytes. */
export function listSnapshots(db: Database, path: string): Snapshot[] {
  return db
    .prepare('SELECT id, path, ts, bytes FROM snapshots WHERE path = ? ORDER BY ts DESC')
    .all(path) as Snapshot[]
}

export function getSnapshot(db: Database, id: number): Snapshot | null {
  const row = db
    .prepare('SELECT id, path, ts, bytes, content FROM snapshots WHERE id = ?')
    .get(id) as Snapshot | undefined
  return row ?? null
}

export function pruneSnapshots(db: Database, now: Now = Date.now): number {
  return db.prepare('DELETE FROM snapshots WHERE ts < ?').run(now() - SNAPSHOT_MAX_AGE_MS).changes
}
