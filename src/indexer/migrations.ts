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
  {
    version: 3,
    name: 'link-context',
    sql: `
      -- The source line of each link, so a backlinks list can show why a note
      -- is linked without opening every referring file.
      ALTER TABLE links ADD COLUMN context TEXT;
    `,
  },
  {
    version: 4,
    name: 'snapshots',
    sql: `
      -- Periodic copies of note content, so an edit can be undone days later.
      --
      -- This is the ONE exception to "the database is a cache": a snapshot
      -- cannot be rebuilt from the files, because it is what the file used to
      -- be. Deleting index.db therefore loses version history - which is
      -- acceptable, and stated plainly in the UI, because the alternative is
      -- thousands of tiny files cluttering the vault.
      CREATE TABLE snapshots (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        path    TEXT NOT NULL,
        content TEXT NOT NULL,
        bytes   INTEGER NOT NULL,
        ts      REAL NOT NULL
      );
      CREATE INDEX idx_snapshots_path_ts ON snapshots(path, ts DESC);
    `,
  },
  {
    version: 5,
    name: 'frontmatter-links',
    sql: `
      -- The parser now reads [[links]] in frontmatter. Notes already indexed
      -- would keep their old link rows until they happened to change, because
      -- staleness is judged by (mtime, size) - so every note is marked stale
      -- once, and the next reconcile re-parses them all. Nothing is lost: the
      -- index is a cache, and this is it being rebuilt.
      UPDATE notes SET mtime = -1;
    `,
  },
  {
    version: 6,
    name: 'autolinks',
    sql: `
      -- Auto-links. Written by the embedder process, never by the indexer; the
      -- migration lives here only because the indexer opens the file first.
      -- A cache like everything else: the user's decisions (rejections) live
      -- in .recto/autolinks.json, not here.
      --
      -- idx -1 is the note's title vector (title + aliases + headings).
      CREATE TABLE autolink_chunks (
        path TEXT NOT NULL,
        idx  INTEGER NOT NULL,
        hash TEXT NOT NULL,
        vec  BLOB NOT NULL,
        PRIMARY KEY (path, idx)
      );

      -- mean_vec, own_words and evaluated_at describe the note as it was at its
      -- last evaluation, which is what the drift rule compares against.
      -- embedded_mtime and suggested: when the chunks were last brought up to
      -- date, and the chips waiting for the user. What we WROTE to a note is
      -- not here: that decides what may be removed from a user's file, so it
      -- lives in the vault and survives a rebuild.
      CREATE TABLE autolink_state (
        path           TEXT PRIMARY KEY,
        mean_vec       BLOB,
        own_words      INTEGER,
        evaluated_at   INTEGER,
        embedded_mtime REAL,
        suggested      TEXT
      );

      CREATE TABLE autolink_meta (key TEXT PRIMARY KEY, value TEXT);
    `,
  },
  {
    version: 7,
    name: 'link-property',
    sql: `
      -- The frontmatter key a link sits under (null in the body), so the graph
      -- can draw links from the auto-links property apart from the user's own.
      -- Every note is re-parsed once to fill it, like migration 5.
      ALTER TABLE links ADD COLUMN property TEXT;
      UPDATE notes SET mtime = -1;
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
