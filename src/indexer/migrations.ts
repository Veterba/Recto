import type { Database } from 'better-sqlite3'

/**
 * Numbered migrations with a `schema_version` table.
 *
 * Kept as strings in code rather than loose .sql files so the bundle stays one
 * unit - there is no asset path to get wrong at package time. The numbering and
 * the version table are the part that matters: each migration runs once, in
 * order, inside a transaction.
 *
 * Remember the hard rule: this database is a CACHE. Every row here can be
 * rebuilt from the markdown files. If a migration is ever too painful, dropping
 * the file and reindexing is always a legitimate answer.
 */

export type Migration = { version: number; name: string; sql: string }

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
      CREATE TABLE notes (
        path      TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        title     TEXT,
        mtime     REAL NOT NULL,
        size      INTEGER NOT NULL,
        indexed_at REAL NOT NULL
      );
      CREATE INDEX idx_notes_name ON notes(name);
      CREATE INDEX idx_notes_mtime ON notes(mtime);

      -- One row per [[wikilink]]. 'target_path' is null while unresolved, which
      -- is how the UI finds broken links without a second scan.
      CREATE TABLE links (
        source_path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
        target_text TEXT NOT NULL,
        target_path TEXT,
        heading     TEXT,
        alias       TEXT,
        line        INTEGER NOT NULL
      );
      CREATE INDEX idx_links_source ON links(source_path);
      CREATE INDEX idx_links_target ON links(target_path);
      CREATE INDEX idx_links_text ON links(target_text);

      CREATE TABLE tags (
        path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
        tag  TEXT NOT NULL,
        line INTEGER NOT NULL
      );
      CREATE INDEX idx_tags_path ON tags(path);
      CREATE INDEX idx_tags_tag ON tags(tag);

      -- Frontmatter, one row per key. Typed loosely on purpose: the board reads
      -- 'status'/'board'/'order' from here, and a later query view reads whatever
      -- the user invented.
      CREATE TABLE properties (
        path  TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
        key   TEXT NOT NULL,
        value TEXT,
        num   REAL,
        PRIMARY KEY (path, key)
      );
      CREATE INDEX idx_properties_key ON properties(key);

      CREATE TABLE headings (
        path  TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
        text  TEXT NOT NULL,
        level INTEGER NOT NULL,
        line  INTEGER NOT NULL
      );
      CREATE INDEX idx_headings_path ON headings(path);

      -- Append-only usage events. Everything on the Home dashboard is a GROUP BY
      -- over this; derived counters are never stored, because they drift and
      -- cannot be recomputed.
      CREATE TABLE events (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        ts        REAL NOT NULL,
        type      TEXT NOT NULL CHECK (type IN (
                    'note_created','note_deleted','note_opened','note_edited',
                    'task_completed','session_tick','ai_message'
                  )),
        note_path TEXT,
        meta      TEXT
      );
      CREATE INDEX idx_events_ts ON events(ts);
      CREATE INDEX idx_events_type ON events(type);
    `,
  },
  {
    version: 2,
    name: 'fts',
    sql: `
      -- contentless-delete FTS5: the note body lives here and nowhere else, so
      -- the index is not a second copy of the vault in RAM the way an in-memory
      -- search index would be.
      CREATE VIRTUAL TABLE notes_fts USING fts5(
        path UNINDEXED,
        name,
        title,
        headings,
        body,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `,
  },
]

export function runMigrations(db: Database): { from: number; to: number } {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at REAL NOT NULL)')

  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }
  const current = row.v ?? 0

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    // One transaction per migration: a failure leaves the version table honest
    // rather than half-applied.
    const apply = db.transaction(() => {
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        Date.now(),
      )
    })
    apply()
  }

  const latest = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0
  return { from: current, to: latest }
}
