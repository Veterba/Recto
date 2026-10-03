import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { getSnapshot, listSnapshots, pruneSnapshots, takeSnapshot } from './snapshots'
import { parseNote, pathsByName, resolveLink } from '../../shared/parse'
import { extractTasks, normaliseTask, noteDate } from '../../shared/tasks'
import type { CatalogNote, IndexRequest, IndexResponse, PeriodNote, StoredCard, TaskRowData } from '../../shared/indexer-protocol'
import { isHidden } from '../../shared/vault'
import { vaultRoot, requireDb, open, closeDb } from './db'
import { search, backlinks, resolveOne, unresolved, graph, board, boards, context, vaultUsage } from './queries'

/**
 * The indexer, running in its own process.
 *
 * It lives off the main process because a first-run walk of a large vault is
 * seconds of synchronous file reading and SQLite writes; doing that on main
 * freezes the window, and doing it in the renderer means giving the renderer
 * the filesystem.
 *
 * Everything here is a cache of the markdown, except two tables: `events`
 * (usage history) and `snapshots` (version history). Delete index.db and the
 * rest rebuilds on next launch; those two are lost.
 */

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

/** Write one note's rows. Caller wraps this in a transaction. Exported for the tests. */
export function writeNote(relative: string, content: string, mtime: number, size: number): void {
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
  const date = noteDate(relative, parsed.frontmatter, mtime)
  handle.prepare('UPDATE notes SET note_date = ? WHERE path = ?').run(date, relative)
  writeTasks(relative, parsed, date, name.replace(/\.md$/i, ''))

  // Child rows are rewritten wholesale rather than diffed: a note is small, and
  // a diff here would be a source of drift for no measurable gain.
  for (const table of ['links', 'tags', 'properties', 'headings']) {
    handle.prepare(`DELETE FROM ${table} WHERE ${table === 'links' ? 'source_path' : 'path'} = ?`).run(relative)
  }

  const insertLink = handle.prepare(
    'INSERT INTO links (source_path, target_text, target_path, heading, alias, line, context, property) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const bodyLines = parsed.body.split('\n')
  for (const link of parsed.links) {
    // Trim the context: a backlinks row shows a sentence, not a paragraph.
    const raw = bodyLines[link.line] ?? ''
    const context = raw.trim().slice(0, 300)
    insertLink.run(relative, link.target, null, link.heading, link.alias, link.line, context, link.property ?? null)
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

/**
 * A note's task rows, rewritten. What the index already knew about a task -
 * when it first appeared, when it was checked - is kept across the rewrite;
 * a task checked before the index ever saw it gets its check date from the
 * note's snapshots, if they go back far enough.
 */
function writeTasks(relative: string, parsed: ReturnType<typeof parseNote>, date: string, name: string): void {
  const handle = requireDb()
  const before = new Map(
    (
      handle.prepare('SELECT norm, done, first_seen, done_at FROM tasks WHERE path = ?').all(relative) as {
        norm: string
        done: number
        first_seen: number
        done_at: number | null
      }[]
    ).map((r) => [r.norm, r]),
  )
  handle.prepare('DELETE FROM tasks WHERE path = ?').run(relative)
  const tasks = extractTasks(relative, parsed.body, parsed.frontmatter, parsed.title ?? name)
  if (tasks.length === 0) return
  const now = Date.now()
  const insert = handle.prepare(
    'INSERT INTO tasks (path, line, heading, text, norm, done, status, source, note_date, first_seen, done_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  let snapshots: { content: string; ts: number }[] | null = null
  for (const task of tasks) {
    const norm = normaliseTask(task.text)
    const old = before.get(norm)
    let doneAt: number | null = null
    if (task.done) {
      if (old !== undefined) doneAt = old.done === 1 ? old.done_at : now
      else {
        // First time the index sees it, already checked: the earliest snapshot with it checked.
        snapshots ??= handle.prepare('SELECT content, ts FROM snapshots WHERE path = ? ORDER BY ts').all(relative) as {
          content: string
          ts: number
        }[]
        const checked = new RegExp(`\\[[xX]\\]\\s*${task.text.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
        doneAt = snapshots.find((s) => checked.test(s.content))?.ts ?? null
      }
    }
    insert.run(
      relative,
      task.line,
      task.heading,
      task.text,
      norm,
      task.done ? 1 : 0,
      task.status,
      task.source,
      date,
      old?.first_seen ?? now,
      doneAt,
    )
  }
}

/** Task rows of notes dated `since`..`to`, and every card (a card is open until moved to done, whatever its date). */
function taskRows(since: string, to: string): TaskRowData[] {
  const rows = requireDb()
    .prepare(
      `SELECT t.path, coalesce(n.title, n.name) AS title, t.text, t.norm, t.done, t.source, t.status, t.note_date, t.done_at,
              (SELECT value FROM properties p WHERE p.path = t.path AND p.key = 'due') AS due,
              (SELECT value FROM properties p WHERE p.path = t.path AND p.key = 'board') AS board
         FROM tasks t JOIN notes n ON n.path = t.path
        WHERE (t.note_date >= ? AND t.note_date <= ?) OR t.source = 'card'
        ORDER BY t.note_date, t.path, t.line`,
    )
    .all(since, to) as {
    path: string
    title: string
    text: string
    norm: string
    done: number
    source: TaskRowData['source']
    status: string | null
    note_date: string
    done_at: number | null
    due: string | null
    board: string | null
  }[]
  return rows.map((r) => ({
    path: r.path,
    title: r.title.replace(/\.md$/i, ''),
    text: r.text,
    norm: r.norm,
    done: r.done === 1,
    source: r.source,
    status: r.status,
    noteDate: r.note_date,
    doneAt: r.done_at,
    due: r.due === null ? null : (/\d{4}-\d{2}-\d{2}/.exec(r.due)?.[0] ?? null),
    board: r.board,
  }))
}

/**
 * Notes dated in the period or edited in it, each with what it gained in the
 * period: the lines added since its last snapshot from before the period
 * started, or - with no such snapshot - its opening lines.
 */
function notesInPeriod(from: string, to: string): PeriodNote[] {
  const handle = requireDb()
  const start = new Date(`${from}T00:00:00`).getTime()
  const end = new Date(`${to}T00:00:00`).getTime() + 86_400_000
  const rows = handle
    .prepare(
      `SELECT n.path, coalesce(n.title, n.name) AS title, n.note_date, n.mtime,
              (SELECT COUNT(*) FROM links l WHERE l.source_path = n.path) AS links,
              (SELECT COUNT(*) FROM tasks t WHERE t.path = n.path) AS tasks
         FROM notes n
        WHERE (n.note_date >= ? AND n.note_date <= ?) OR (n.mtime >= ? AND n.mtime < ?)`,
    )
    .all(from, to, start, end) as { path: string; title: string; note_date: string | null; mtime: number; links: number; tasks: number }[]
  const before = handle.prepare('SELECT content FROM snapshots WHERE path = ? AND ts < ? ORDER BY ts DESC LIMIT 1')
  return rows.flatMap((r) => {
    let content: string
    try {
      content = fs.readFileSync(path.join(vaultRoot, r.path), 'utf8')
    } catch {
      return []
    }
    const body = parseNote(content).body
    const old = before.get(r.path, start) as { content: string } | undefined
    const lines = body
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim() !== '' && !/^#\s/.test(l))
    const added = old === undefined ? lines : lines.filter((l) => !old.content.includes(l))
    const changed = added.join('\n').slice(0, 600)
    const d = new Date(r.mtime)
    const date = r.note_date ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return [
      { path: r.path, title: r.title.replace(/\.md$/i, ''), date, links: r.links, tasks: r.tasks, changed, content: body.slice(0, 6000) },
    ]
  })
}

/** Every note with what the scope tools count: links both ways, aliases and topics, task rows, headings. */
function botCatalog(): CatalogNote[] {
  const handle = requireDb()
  const notes = handle
    .prepare(
      `SELECT n.path, n.name, n.mtime, n.size, n.note_date,
              (SELECT COUNT(*) FROM links l WHERE l.source_path = n.path AND (l.property IS NULL OR l.property <> 'topics')) AS links_out,
              (SELECT COUNT(*) FROM links l WHERE l.target_path = n.path AND l.source_path <> n.path) AS links_in,
              (SELECT value FROM properties p WHERE p.path = n.path AND p.key = 'aliases') AS aliases,
              (SELECT value FROM properties p WHERE p.path = n.path AND p.key = 'topics') AS topics,
              (SELECT COUNT(*) FROM tasks t WHERE t.path = n.path) AS tasks
         FROM notes n ORDER BY n.path`,
    )
    .all() as {
    path: string
    name: string
    mtime: number
    size: number
    note_date: string | null
    links_out: number
    links_in: number
    aliases: string | null
    topics: string | null
    tasks: number
  }[]
  const headings = new Map<string, { text: string; level: number }[]>()
  for (const h of handle.prepare('SELECT path, text, level FROM headings ORDER BY path, line').all() as {
    path: string
    text: string
    level: number
  }[]) {
    const list = headings.get(h.path) ?? []
    list.push({ text: h.text, level: h.level })
    headings.set(h.path, list)
  }
  return notes.map((n) => ({
    path: n.path,
    title: n.name.replace(/\.md$/i, ''),
    mtime: n.mtime,
    size: n.size,
    noteDate: n.note_date,
    linksOut: n.links_out,
    linksIn: n.links_in,
    aliases: n.aliases,
    topics: n.topics,
    tasks: n.tasks,
    headings: headings.get(n.path) ?? [],
  }))
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
  const byName = pathsByName(allPaths)

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
    (handle.prepare('SELECT path, mtime, size FROM notes').all() as { path: string; mtime: number; size: number }[]).map((r) => [
      r.path,
      r,
    ]),
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
      const byName = pathsByName(allPaths)
      const resolved: Record<string, string | null> = {}
      for (const target of request.targets) resolved[target] = resolveLink(target, byName, allPaths)
      return { kind: 'resolve-links-result', resolved }
    }
    case 'unresolved':
      return { kind: 'unresolved-result', entries: unresolved() }
    case 'graph':
      return { kind: 'graph-result', graph: graph(request.autoProperty ?? null) }
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
      const unresolved = (handleDb.prepare('SELECT COUNT(*) AS n FROM links WHERE target_path IS NULL').get() as { n: number }).n
      const tags = (handleDb.prepare('SELECT COUNT(DISTINCT tag) AS n FROM tags').get() as { n: number }).n
      return { kind: 'stats-result', notes, links, unresolved, tags }
    }
    case 'vault-usage':
      return { kind: 'vault-usage-result', usage: vaultUsage() }
    case 'link-sources':
      return {
        kind: 'link-sources-result',
        paths: (
          requireDb()
            .prepare('SELECT DISTINCT source_path AS path FROM links WHERE lower(target_text) = lower(?) ORDER BY source_path')
            .all(request.target) as { path: string }[]
        ).map((r) => r.path),
      }
    case 'topics-graph': {
      const handleDb = requireDb()
      return {
        kind: 'topics-graph-result',
        graph: {
          notes: handleDb.prepare('SELECT path, mtime FROM notes').all() as { path: string; mtime: number }[],
          links: handleDb
            .prepare('SELECT DISTINCT source_path AS source, target_path AS target FROM links WHERE target_path IS NOT NULL')
            .all() as { source: string; target: string }[],
          tags: handleDb.prepare('SELECT DISTINCT path, tag FROM tags').all() as { path: string; tag: string }[],
        },
      }
    }
    case 'task-rows':
      return { kind: 'task-rows-result', rows: taskRows(request.since, request.to) }
    case 'notes-in-period':
      return { kind: 'notes-in-period-result', notes: notesInPeriod(request.from, request.to) }
    case 'inferred-get': {
      const row = requireDb().prepare('SELECT items FROM inferred_tasks WHERE hash = ?').get(request.hash) as { items: string } | undefined
      return { kind: 'inferred-result', items: row === undefined ? null : (JSON.parse(row.items) as string[]) }
    }
    case 'inferred-put':
      requireDb()
        .prepare('INSERT OR REPLACE INTO inferred_tasks (hash, path, items, created) VALUES (?, ?, ?, ?)')
        .run(request.hash, request.path, JSON.stringify(request.items), Date.now())
      return { kind: 'inferred-result', items: request.items }
    case 'bot-catalog':
      return { kind: 'bot-catalog-result', notes: botCatalog() }
    case 'cards-get':
      return {
        kind: 'cards-result',
        cards: requireDb().prepare('SELECT hash, model, path, card FROM note_cards WHERE model = ?').all(request.model) as StoredCard[],
      }
    case 'card-put':
      requireDb()
        .prepare('INSERT OR REPLACE INTO note_cards (hash, model, path, card, created) VALUES (?, ?, ?, ?, ?)')
        .run(request.card.hash, request.card.model, request.card.path, request.card.card, Date.now())
      return { kind: 'ok' }
    case 'model-cache-export': {
      const handleDb = requireDb()
      return {
        kind: 'model-cache',
        cards: handleDb.prepare('SELECT hash, model, path, card FROM note_cards').all() as StoredCard[],
        inferred: (
          handleDb.prepare('SELECT hash, path, items FROM inferred_tasks').all() as { hash: string; path: string; items: string }[]
        ).map((r) => ({ ...r, items: JSON.parse(r.items) as string[] })),
      }
    }
    case 'model-cache-import': {
      const handleDb = requireDb()
      handleDb.transaction(() => {
        const card = handleDb.prepare('INSERT OR IGNORE INTO note_cards (hash, model, path, card, created) VALUES (?, ?, ?, ?, ?)')
        for (const c of request.cards) card.run(c.hash, c.model, c.path, c.card, Date.now())
        const inferred = handleDb.prepare('INSERT OR IGNORE INTO inferred_tasks (hash, path, items, created) VALUES (?, ?, ?, ?)')
        for (const i of request.inferred) inferred.run(i.hash, i.path, JSON.stringify(i.items), Date.now())
      })()
      return { kind: 'ok' }
    }
    case 'close':
      closeDb()
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
