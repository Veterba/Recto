import Database from 'better-sqlite3'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { runMigrations } from './migrations'
import {
  getSnapshot,
  listSnapshots,
  pruneSnapshots,
  takeSnapshot,
} from './snapshots'
import { normalizeName, parseNote, resolveLink } from './parse'
import type {
  Backlink,
  BoardCard,
  GraphData,
  GraphEdge,
  GraphNode,
  IndexRequest,
  NoteContext,
  IndexResponse,
  SearchHit,
  Snapshot,
  VaultUsage,
} from './protocol'

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

const HIDDEN = new Set(['.recto', '.git', '.DS_Store', 'node_modules', '.trash'])
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
    'INSERT INTO links (source_path, target_text, target_path, heading, alias, line, context) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const bodyLines = parsed.body.split('\n')
  for (const link of parsed.links) {
    // Trim the context: a backlinks row shows a sentence, not a paragraph.
    const raw = bodyLines[link.line] ?? ''
    const context = raw.trim().slice(0, 300)
    insertLink.run(relative, link.target, null, link.heading, link.alias, link.line, context)
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
  // Nor do snapshots, which have no foreign key because they outlive an edit
  // on purpose. They must not outlive the NOTE: history kept for a deleted
  // path resurfaces the moment something is created with the same name, and a
  // new note showing a stranger's version history is alarming.
  handle.prepare('DELETE FROM snapshots WHERE path = ?').run(relative)
}

/**
 * Carry a note's history across a rename.
 *
 * Main sends this BEFORE it touches the disk. The watcher then reports an
 * unlink of the old path and an add of the new one, in whatever order it likes
 * - and by then the snapshots have already moved, so the unlink finds nothing
 * to delete. Doing it afterwards would be a race with `removeNote`.
 */
function renameNote(from: string, to: string): void {
  requireDb().prepare('UPDATE snapshots SET path = ? WHERE path = ?').run(to, from)
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
        // Snapshot here too, not only on change. Otherwise history begins at
        // your FIRST edit and the content you had before it - the version you
        // are most likely to want back - is never captured. The
        // identical-content check makes a repeat reindex free.
        takeSnapshot(handle, entry.file.path, entry.content)
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

function backlinks(target: string): Backlink[] {
  return requireDb()
    .prepare(
      `SELECT l.source_path AS path, l.line, l.alias, l.context, n.title
       FROM links l LEFT JOIN notes n ON n.path = l.source_path
       WHERE l.target_path = ? ORDER BY l.source_path, l.line`,
    )
    .all(target) as Backlink[]
}

/** Every link in the vault that resolves to nothing, grouped by target. */
function unresolved(): { target: string; sources: string[] }[] {
  const rows = requireDb()
    .prepare(
      `SELECT target_text AS target, source_path AS source
       FROM links WHERE target_path IS NULL ORDER BY target_text, source_path`,
    )
    .all() as { target: string; source: string }[]

  const grouped = new Map<string, string[]>()
  for (const row of rows) {
    const list = grouped.get(row.target)
    if (list) {
      if (!list.includes(row.source)) list.push(row.source)
    } else grouped.set(row.target, [row.source])
  }
  return [...grouped.entries()].map(([target, sources]) => ({ target, sources }))
}

/**
 * Resolve a single wikilink target on demand.
 *
 * Reads the notes table rather than the links table, because a link may be
 * typed and clicked before the note containing it has been saved and indexed.
 */
function resolveOne(target: string): string | null {
  const rows = requireDb().prepare('SELECT path FROM notes').all() as { path: string }[]
  const allPaths = new Set(rows.map((r) => r.path))
  const byName = new Map<string, string[]>()
  for (const { path: notePath } of rows) {
    const key = normalizeName(notePath.slice(notePath.lastIndexOf('/') + 1))
    const list = byName.get(key)
    if (list) list.push(notePath)
    else byName.set(key, [notePath])
  }
  return resolveLink(target, byName, allPaths)
}

/**
 * The link graph: one node per note, one edge per resolved link.
 *
 * Unresolved links are excluded - an edge to a note that does not exist has no
 * node to attach to, and inventing placeholder nodes would make the graph a
 * picture of your typos. They are listed on the Unresolved screen instead.
 *
 * Self-links and duplicate pairs are collapsed, because the force simulation
 * treats a duplicated edge as a stronger spring and two notes that link each
 * other five times are not five times closer.
 */
function graph(): GraphData {
  const handleDb = requireDb()

  const rows = handleDb.prepare('SELECT path, name, title FROM notes ORDER BY path').all() as {
    path: string
    name: string
    title: string | null
  }[]

  const links = handleDb
    .prepare('SELECT DISTINCT source_path AS source, target_path AS target FROM links WHERE target_path IS NOT NULL')
    .all() as { source: string; target: string }[]

  const known = new Set(rows.map((row) => row.path))
  const degree = new Map<string, number>()
  const seen = new Set<string>()
  const edges: GraphEdge[] = []

  for (const link of links) {
    if (link.source === link.target) continue
    if (!known.has(link.source) || !known.has(link.target)) continue
    // Undirected for layout purposes: A->B and B->A are one spring.
    const key = link.source < link.target ? `${link.source}\u0000${link.target}` : `${link.target}\u0000${link.source}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({ source: link.source, target: link.target })
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1)
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1)
  }

  const nodes: GraphNode[] = rows.map((row) => ({
    path: row.path,
    name: row.name.replace(/\.md$/i, ''),
    title: row.title,
    degree: degree.get(row.path) ?? 0,
  }))

  return { nodes, edges }
}

/**
 * Every card on one board.
 *
 * A card is a note, so this is a join over the frontmatter rows rather than a
 * table of its own - there is no card record anywhere, and deleting the .md
 * file deletes the card. `board` is the required key: a note without it is not
 * on any board, which is what keeps the board from swallowing the whole vault.
 *
 * Cards with no `order` sort last, by name, so a note that was hand-written
 * into a column still appears somewhere stable rather than jumping about.
 */
function board(name: string): BoardCard[] {
  const rows = requireDb()
    .prepare(
      `SELECT n.path                       AS path,
              COALESCE(n.title, n.name)    AS title,
              s.value                      AS status,
              o.num                        AS "order",
              d.value                      AS due,
              p.value                      AS priority,
              (SELECT body FROM notes_fts WHERE notes_fts.path = n.path) AS body
       FROM notes n
       JOIN properties b ON b.path = n.path AND b.key = 'board' AND b.value = ?
       LEFT JOIN properties s ON s.path = n.path AND s.key = 'status'
       LEFT JOIN properties o ON o.path = n.path AND o.key = 'order'
       LEFT JOIN properties d ON d.path = n.path AND d.key = 'due'
       LEFT JOIN properties p ON p.path = n.path AND p.key = 'priority'
       ORDER BY o.num IS NULL, o.num, n.name`,
    )
    .all(name) as (BoardCard & { body: string | null })[]

  return rows.map(({ body, ...row }) => ({
    ...row,
    title: row.title.replace(/\.md$/i, ''),
    preview: previewOf(body, row.title),
  }))
}

/**
 * The first real line of a note, for the card's second line.
 *
 * The card used to show its file path, which is the one thing about a task
 * nobody needs on a board. Headings are skipped because the topmost one is
 * already the card's title, and repeating it says nothing.
 */
function previewOf(body: string | null, title: string): string {
  if (body === null) return ''
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    if (line.startsWith('#')) {
      // Skip a heading, but only while it is still just restating the title.
      const text = line.replace(/^#+\s*/, '')
      if (text === title || text === '') continue
      return text.slice(0, 160)
    }
    return line.replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '').slice(0, 160)
  }
  return ''
}

/** Board names that actually occur in the vault, with their card counts. */
function boards(): { board: string; count: number }[] {
  return requireDb()
    .prepare(
      `SELECT value AS board, COUNT(*) AS count
       FROM properties WHERE key = 'board' AND value IS NOT NULL AND value <> ''
       GROUP BY value ORDER BY value`,
    )
    .all() as { board: string; count: number }[]
}

/**
 * Every note's tags and resolved outgoing links.
 *
 * Read in one pass rather than per note: Tidy reasons over the whole vault at
 * once, and a query per note on a few thousand notes is the difference between
 * instant and a visible pause.
 */
/**
 * What the home overlay reads: the shape of the vault and the last week of
 * writing in it.
 *
 * One pass of small aggregates rather than a query per figure, because the
 * overlay asks for all of them at once and the whole point of an index is that
 * this costs nothing. `mtime` is the last write: the only date the filesystem
 * keeps that survives a clone, a sync or a restore, so every "this week" figure
 * here means touched, not created.
 */
function vaultUsage(): VaultUsage {
  const handle = requireDb()
  const one = (sql: string, ...args: unknown[]): number =>
    (handle.prepare(sql).get(...args) as { n: number } | undefined)?.n ?? 0

  const DAY = 86_400_000
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const weekStart = startOfToday.getTime() - 6 * DAY

  const perDay = handle
    .prepare(
      `SELECT CAST((mtime - ?) / ? AS INTEGER) AS bucket, COUNT(*) AS n
         FROM notes WHERE mtime >= ? GROUP BY bucket`,
    )
    .all(weekStart, DAY, weekStart) as { bucket: number; n: number }[]
  const weekTrend = Array.from({ length: 7 }, () => 0)
  for (const row of perDay) if (row.bucket >= 0 && row.bucket < 7) weekTrend[row.bucket] = row.n

  const topFolders = (
    handle
      .prepare(
        // `folder`, not `name`: SQLite resolves a bare `name` in GROUP BY to
        // the table's own column, so grouping by the alias silently grouped by
        // filename and every folder came back with a count of one.
        `SELECT substr(path, 1, instr(path, '/') - 1) AS folder, COUNT(*) AS count
           FROM notes WHERE instr(path, '/') > 0
          GROUP BY folder ORDER BY count DESC, folder LIMIT 4`,
      )
      .all() as { folder: string; count: number }[]
  )
    .filter((row) => row.folder !== '')
    .map((row) => ({ name: row.folder, count: row.count }))

  const topTags = handle
    .prepare('SELECT tag, COUNT(*) AS count FROM tags GROUP BY tag ORDER BY count DESC, tag LIMIT 5')
    .all() as { tag: string; count: number }[]

  // Degree, both directions, over resolved links only - an unresolved link
  // points at a note that is not there to be a hub.
  const hubs = (
    handle
      .prepare(
        `SELECT n.title AS title, n.name AS name, COUNT(*) AS links
           FROM (
             SELECT source_path AS path FROM links WHERE target_path IS NOT NULL
             UNION ALL
             SELECT target_path AS path FROM links WHERE target_path IS NOT NULL
           ) AS ends
           JOIN notes n ON n.path = ends.path
          GROUP BY ends.path ORDER BY links DESC, name LIMIT 3`,
      )
      .all() as { title: string | null; name: string; links: number }[]
  ).map((row) => ({ name: row.title ?? row.name.replace(/\.md$/i, ''), links: row.links }))

  return {
    notes: one('SELECT COUNT(*) AS n FROM notes'),
    links: one('SELECT COUNT(*) AS n FROM links'),
    unresolved: one('SELECT COUNT(*) AS n FROM links WHERE target_path IS NULL'),
    tags: one('SELECT COUNT(DISTINCT tag) AS n FROM tags'),
    touchedThisWeek: one('SELECT COUNT(*) AS n FROM notes WHERE mtime >= ?', weekStart),
    weekTrend,
    topFolders,
    topTags,
    hubs,
  }
}

function context(): NoteContext[] {
  const handle = requireDb()
  const notes = handle.prepare('SELECT path FROM notes ORDER BY path').all() as { path: string }[]

  const tags = handle.prepare('SELECT DISTINCT path, tag FROM tags').all() as { path: string; tag: string }[]
  const links = handle
    .prepare('SELECT DISTINCT source_path AS source, target_path AS target FROM links WHERE target_path IS NOT NULL')
    .all() as { source: string; target: string }[]

  const byTag = new Map<string, string[]>()
  for (const row of tags) {
    const list = byTag.get(row.path)
    if (list) list.push(row.tag)
    else byTag.set(row.path, [row.tag])
  }
  const byLink = new Map<string, string[]>()
  for (const row of links) {
    const list = byLink.get(row.source)
    if (list) list.push(row.target)
    else byLink.set(row.source, [row.target])
  }

  return notes.map((note) => ({
    path: note.path,
    tags: byTag.get(note.path) ?? [],
    links: byLink.get(note.path) ?? [],
  }))
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
    case 'resolve-link':
      return { kind: 'resolve-link-result', path: resolveOne(request.target) }
    case 'resolve-links': {
      // One lookup table for the whole batch: the editor asks about every link
      // in a document at once, and rebuilding the index per target is O(n*m).
      const rows = requireDb().prepare('SELECT path FROM notes').all() as { path: string }[]
      const allPaths = new Set(rows.map((r) => r.path))
      const byName = new Map<string, string[]>()
      for (const { path: notePath } of rows) {
        const key = normalizeName(notePath.slice(notePath.lastIndexOf('/') + 1))
        const list = byName.get(key)
        if (list) list.push(notePath)
        else byName.set(key, [notePath])
      }
      const resolved: Record<string, string | null> = {}
      for (const target of request.targets) resolved[target] = resolveLink(target, byName, allPaths)
      return { kind: 'resolve-links-result', resolved }
    }
    case 'unresolved':
      return { kind: 'unresolved-result', entries: unresolved() }
    case 'graph':
      return { kind: 'graph-result', graph: graph() }
    case 'board':
      return { kind: 'board-result', cards: board(request.board) }
    case 'boards':
      return { kind: 'boards-result', boards: boards() }
    case 'context':
      return { kind: 'context-result', notes: context() }
    case 'note-renamed':
      renameNote(request.from, request.to)
      return { kind: 'note-changed-done' }
    case 'history':
      return { kind: 'history-result', snapshots: listSnapshots(requireDb(), request.path) }
    case 'history-get':
      return { kind: 'history-get-result', snapshot: getSnapshot(requireDb(), request.id) }
    case 'history-prune':
      return { kind: 'history-prune-result', removed: pruneSnapshots(requireDb()) }
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
    case 'home-stats':
      return { kind: 'home-stats-result', stats: vaultUsage() }
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
          handleDb.transaction(() => {
            writeNote(change.path, content, stat.mtimeMs, stat.size)
            takeSnapshot(handleDb, change.path, content)
          })()
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
