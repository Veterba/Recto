import Database from 'better-sqlite3'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { runMigrations } from './migrations'
import { normalizeName, parseNote, resolveLink } from './parse'
import type { IndexRequest, IndexResponse, SearchHit } from './protocol'

/**
 * The indexer, running in its own process.
 *
 * It lives off the main process because a first-run walk of a large vault is
 * seconds of synchronous file reading and SQLite writes; doing that on main
 * freezes the window, and doing it in the renderer means giving the renderer
 * the filesystem.
 *
 * Everything here is a cache. Delete index.db and it rebuilds from the markdown
 * on next launch, losing usage history and nothing else.
 */

const HIDDEN = new Set(['.obsidian-like', '.git', '.DS_Store', 'node_modules', '.trash'])
const isHidden = (name: string): boolean => HIDDEN.has(name) || name.startsWith('.')

let db: Database.Database | null = null
let vaultRoot = ''

function open(root: string, dbPath: string): { migratedFrom: number; migratedTo: number } {
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

function requireDb(): Database.Database {
  if (!db) throw new Error('index not open')
  return db
}

/** Every markdown file in the vault, with its stat. */
async function walk(dir: string, out: { path: string; mtime: number; size: number }[] = []): Promise<typeof out> {
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (isHidden(entry.name)) continue
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(absolute, out)
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      try {
        const stat = await fsp.stat(absolute)
        out.push({
          path: path.relative(vaultRoot, absolute).split(path.sep).join('/'),
          mtime: stat.mtimeMs,
          size: stat.size,
        })
      } catch {
        // Vanished between readdir and stat; nothing to index.
      }
    }
  }
  return out
}

/** Write one note's rows. Caller wraps this in a transaction. */
function writeNote(relative: string, content: string, mtime: number, size: number): void {
  const handle = requireDb()
  const parsed = parseNote(content)
  const name = relative.slice(relative.lastIndexOf('/') + 1)

  handle
    .prepare(
      `INSERT INTO notes (path, name, title, mtime, size, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         name = excluded.name, title = excluded.title,
         mtime = excluded.mtime, size = excluded.size, indexed_at = excluded.indexed_at`,
    )
    .run(relative, name, parsed.title, mtime, size, Date.now())

  // Child rows are rewritten wholesale rather than diffed: a note is small, and
  // a diff here would be a source of drift for no measurable gain.
  for (const table of ['links', 'tags', 'properties', 'headings']) {
    handle.prepare(`DELETE FROM ${table} WHERE ${table === 'links' ? 'source_path' : 'path'} = ?`).run(relative)
  }

  const insertLink = handle.prepare(
    'INSERT INTO links (source_path, target_text, target_path, heading, alias, line) VALUES (?, ?, ?, ?, ?, ?)',
  )
  for (const link of parsed.links) {
    insertLink.run(relative, link.target, null, link.heading, link.alias, link.line)
  }

  const insertTag = handle.prepare('INSERT INTO tags (path, tag, line) VALUES (?, ?, ?)')
  for (const tag of parsed.tags) insertTag.run(relative, tag.tag, tag.line)

  const insertHeading = handle.prepare('INSERT INTO headings (path, text, level, line) VALUES (?, ?, ?, ?)')
  for (const heading of parsed.headings) insertHeading.run(relative, heading.text, heading.level, heading.line)

  const insertProperty = handle.prepare('INSERT OR REPLACE INTO properties (path, key, value, num) VALUES (?, ?, ?, ?)')
  for (const [key, value] of Object.entries(parsed.frontmatter)) {
    insertProperty.run(relative, key, value === null ? null : String(value), typeof value === 'number' ? value : null)
  }

  handle.prepare('DELETE FROM notes_fts WHERE path = ?').run(relative)
  handle
    .prepare('INSERT INTO notes_fts (path, name, title, headings, body) VALUES (?, ?, ?, ?, ?)')
    .run(relative, name, parsed.title ?? '', parsed.headings.map((h) => h.text).join(' '), parsed.body)
}

function removeNote(relative: string): void {
  const handle = requireDb()
  // Child tables cascade from notes; FTS is a virtual table and does not.
  handle.prepare('DELETE FROM notes WHERE path = ?').run(relative)
  handle.prepare('DELETE FROM notes_fts WHERE path = ?').run(relative)
}

/**
 * Re-point every link whose text resolves to a known note.
 *
 * Done as a pass over the whole link table rather than per-note, because
 * creating one file can resolve links in a hundred others.
 */
function resolveAllLinks(): number {
  const handle = requireDb()
  const rows = handle.prepare('SELECT path FROM notes').all() as { path: string }[]
  const allPaths = new Set(rows.map((r) => r.path))
  const byName = new Map<string, string[]>()
  for (const { path: notePath } of rows) {
    const key = normalizeName(notePath.slice(notePath.lastIndexOf('/') + 1))
    const list = byName.get(key)
    if (list) list.push(notePath)
    else byName.set(key, [notePath])
  }

  const links = handle.prepare('SELECT DISTINCT target_text FROM links').all() as { target_text: string }[]
  const update = handle.prepare('UPDATE links SET target_path = ? WHERE target_text = ?')
  let resolved = 0

  handle.transaction(() => {
    for (const { target_text } of links) {
      const target = resolveLink(target_text, byName, allPaths)
      update.run(target, target_text)
      if (target !== null) resolved++
    }
  })()

  return resolved
}

/** Full reconcile: index what changed, drop what is gone. */
async function reindex(force: boolean): Promise<{ indexed: number; removed: number; total: number }> {
  const handle = requireDb()
  const onDisk = await walk(vaultRoot)
  const known = new Map(
    (handle.prepare('SELECT path, mtime, size FROM notes').all() as { path: string; mtime: number; size: number }[]).map(
      (r) => [r.path, r],
    ),
  )

  const stale = onDisk.filter((file) => {
    if (force) return true
    const previous = known.get(file.path)
    // (mtime, size) is the standard cheap staleness check. It can miss an edit
    // that preserves both, which is rare enough that the alternative - hashing
    // every file on every boot - is not worth it.
    return previous === undefined || previous.mtime !== file.mtime || previous.size !== file.size
  })

  let indexed = 0
  const BATCH = 200
  for (let i = 0; i < stale.length; i += BATCH) {
    const batch = stale.slice(i, i + BATCH)
    const contents = await Promise.all(
      batch.map(async (file) => {
        try {
          return { file, content: await fsp.readFile(path.join(vaultRoot, file.path), 'utf8') }
        } catch {
          return null
        }
      }),
    )
    // One transaction per batch: a 5,000-note vault in one transaction holds the
    // write lock for seconds, and one per note fsyncs 5,000 times.
    handle.transaction(() => {
      for (const entry of contents) {
        if (entry === null) continue
        writeNote(entry.file.path, entry.content, entry.file.mtime, entry.file.size)
        indexed++
      }
    })()
  }

  const present = new Set(onDisk.map((f) => f.path))
  const gone = [...known.keys()].filter((p) => !present.has(p))
  handle.transaction(() => {
    for (const p of gone) removeNote(p)
  })()

  if (stale.length > 0 || gone.length > 0) resolveAllLinks()

  return { indexed, removed: gone.length, total: onDisk.length }
}

function search(query: string, limit: number): SearchHit[] {
  const handle = requireDb()
  const trimmed = query.trim()
  if (trimmed === '') return []

  // FTS5 treats a bare string as a query language, so a stray quote or '*' is a
  // syntax error rather than a search. Quote each token and let a trailing
  // wildcard through, which gives prefix search for free.
  const fts = trimmed
    .split(/\s+/)
    .map((token) => `"${token.replace(/"/g, '""')}"${token.endsWith('*') ? '' : '*'}`)
    .join(' ')

  try {
    return handle
      .prepare(
        `SELECT path,
                snippet(notes_fts, 4, '<<', '>>', '…', 12) AS snippet,
                bm25(notes_fts, 0.0, 8.0, 6.0, 3.0, 1.0) AS score
         FROM notes_fts
         WHERE notes_fts MATCH ?
         ORDER BY score
         LIMIT ?`,
      )
      .all(fts, limit) as SearchHit[]
  } catch {
    // A query FTS5 still cannot parse returns nothing rather than throwing at
    // the user mid-keystroke.
    return []
  }
}

function backlinks(target: string): { path: string; line: number; alias: string | null }[] {
  return requireDb()
    .prepare(
      `SELECT l.source_path AS path, l.line, l.alias
       FROM links l WHERE l.target_path = ? ORDER BY l.source_path, l.line`,
    )
    .all(target) as { path: string; line: number; alias: string | null }[]
}

function handle(request: IndexRequest): IndexResponse {
  switch (request.kind) {
    case 'open': {
      const { migratedFrom, migratedTo } = open(request.vaultPath, request.dbPath)
      return { kind: 'opened', migratedFrom, migratedTo }
    }
    case 'reindex':
      throw new Error('handled asynchronously')
    case 'note-changed':
      throw new Error('handled asynchronously')
    case 'search':
      return { kind: 'search-result', hits: search(request.query, request.limit ?? 50) }
    case 'backlinks':
      return { kind: 'backlinks-result', links: backlinks(request.path) }
    case 'stats': {
      const handleDb = requireDb()
      const notes = (handleDb.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n
      const links = (handleDb.prepare('SELECT COUNT(*) AS n FROM links').get() as { n: number }).n
      const unresolved = (
        handleDb.prepare('SELECT COUNT(*) AS n FROM links WHERE target_path IS NULL').get() as { n: number }
      ).n
      const tags = (handleDb.prepare('SELECT COUNT(DISTINCT tag) AS n FROM tags').get() as { n: number }).n
      return { kind: 'stats-result', notes, links, unresolved, tags }
    }
    case 'close':
      db?.close()
      db = null
      return { kind: 'closed' }
  }
}

process.parentPort?.on('message', (event) => {
  const { id, request } = event.data as { id: number; request: IndexRequest }
  const reply = (response: IndexResponse): void => process.parentPort?.postMessage({ id, response })

  const run = async (): Promise<IndexResponse> => {
    if (request.kind === 'reindex') {
      const result = await reindex(request.force ?? false)
      return { kind: 'reindexed', ...result }
    }
    if (request.kind === 'note-changed') {
      const handleDb = requireDb()
      for (const change of request.changes) {
        if (change.type === 'removed') {
          handleDb.transaction(() => removeNote(change.path))()
          continue
        }
        try {
          const absolute = path.join(vaultRoot, change.path)
          const stat = fs.statSync(absolute)
          const content = fs.readFileSync(absolute, 'utf8')
          handleDb.transaction(() => writeNote(change.path, content, stat.mtimeMs, stat.size))()
        } catch {
          // The file changed and then disappeared; the next reconcile catches it.
        }
      }
      resolveAllLinks()
      return { kind: 'note-changed-done' }
    }
    return handle(request)
  }

  run().then(reply, (err: unknown) => {
    reply({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
  })
})
