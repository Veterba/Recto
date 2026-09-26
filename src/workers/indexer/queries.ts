/**
 * What the index answers: search, backlinks, unresolved links, the graph,
 * boards, the vault's usage figures and each note's own signals.
 */

import type {
  SearchHit,
  Backlink,
  GraphData,
  GraphEdge,
  GraphNode,
  BoardCard,
  VaultUsage,
  NoteContext,
} from '../../shared/indexer-protocol'
import { requireDb } from './db'
import { pathsByName, resolveLink } from '../../shared/parse'

export function search(query: string, limit: number): SearchHit[] {
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

export function backlinks(target: string): Backlink[] {
  return requireDb()
    .prepare(
      `SELECT l.source_path AS path, l.line, l.alias, l.context, n.title
       FROM links l LEFT JOIN notes n ON n.path = l.source_path
       WHERE l.target_path = ? ORDER BY l.source_path, l.line`,
    )
    .all(target) as Backlink[]
}

/** Every link in the vault that resolves to nothing, grouped by target. */
export function unresolved(): { target: string; sources: string[] }[] {
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
export function resolveOne(target: string): string | null {
  const rows = requireDb().prepare('SELECT path FROM notes').all() as { path: string }[]
  const allPaths = new Set(rows.map((r) => r.path))
  const byName = pathsByName(allPaths)
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
/**
 * @param autoProperty the auto-links property. A pair is an auto edge when
 * every link between the two notes, either way, sits in that property; one
 * link the user wrote makes it theirs.
 */
export function graph(autoProperty: string | null): GraphData {
  const handleDb = requireDb()

  const rows = handleDb.prepare('SELECT path, name, title FROM notes ORDER BY path').all() as {
    path: string
    name: string
    title: string | null
  }[]

  const links = handleDb
    .prepare(
      `SELECT source_path AS source, target_path AS target, MAX(COALESCE(property, '') <> ?) AS manual
       FROM links WHERE target_path IS NOT NULL GROUP BY source_path, target_path`,
    )
    .all(autoProperty ?? '\u0000') as { source: string; target: string; manual: number }[]

  const known = new Set(rows.map((row) => row.path))
  const degree = new Map<string, number>()
  const byPair = new Map<string, GraphEdge>()

  // A topic is a link to a note that does not exist, under topics/. It has no
  // file and no row of its own, so it becomes a node here, from its links.
  const topics = new Map<string, string>()
  const topicLinks = handleDb
    .prepare(
      `SELECT source_path AS source, target_text AS text, MAX(COALESCE(property, '') <> ?) AS manual
       FROM links WHERE target_path IS NULL AND lower(target_text) LIKE 'topics/%' GROUP BY source_path, lower(target_text)`,
    )
    .all(autoProperty ?? '\u0000') as { source: string; text: string; manual: number }[]
  for (const link of topicLinks) {
    const id = `topics/${link.text.slice('topics/'.length).replace(/\.md$/i, '').trim()}`
    const key = id.toLowerCase()
    if (!topics.has(key)) topics.set(key, id)
  }
  const resolvedTopics = topicLinks.map((l) => ({
    source: l.source,
    target: topics.get(`topics/${l.text.slice('topics/'.length).replace(/\.md$/i, '').trim()}`.toLowerCase())!,
    manual: l.manual,
  }))

  for (const link of [...links, ...resolvedTopics]) {
    if (link.source === link.target) continue
    if (!known.has(link.source) || (!known.has(link.target) && !topics.has(link.target.toLowerCase()))) continue
    // Undirected for layout purposes: A->B and B->A are one spring.
    const key = link.source < link.target ? `${link.source}\u0000${link.target}` : `${link.target}\u0000${link.source}`
    const seen = byPair.get(key)
    if (seen !== undefined) {
      if (link.manual === 1) seen.auto = false
      continue
    }
    byPair.set(key, { source: link.source, target: link.target, auto: link.manual === 0 })
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1)
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1)
  }
  const edges = [...byPair.values()]

  const nodes: GraphNode[] = [
    ...rows.map((row) => ({
      path: row.path,
      name: row.name.replace(/\.md$/i, ''),
      title: row.title,
      degree: degree.get(row.path) ?? 0,
      topic: row.path.toLowerCase().startsWith('topics/'),
    })),
    ...[...topics.values()].map((id) => ({
      path: id,
      name: id.slice('topics/'.length),
      title: null,
      degree: degree.get(id) ?? 0,
      topic: true,
    })),
  ]

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
export function board(name: string): BoardCard[] {
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
export function boards(): { board: string; count: number }[] {
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
export function vaultUsage(): VaultUsage {
  const handle = requireDb()
  const one = (sql: string, ...args: unknown[]): number => (handle.prepare(sql).get(...args) as { n: number } | undefined)?.n ?? 0

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

  const topTags = handle.prepare('SELECT tag, COUNT(*) AS count FROM tags GROUP BY tag ORDER BY count DESC, tag LIMIT 5').all() as {
    tag: string
    count: number
  }[]

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

export function context(): NoteContext[] {
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
