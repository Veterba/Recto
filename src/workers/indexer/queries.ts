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
  BoardSummary,
  CardPlace,
  NoteContext,
} from '../../shared/indexer-protocol'
import { linkStage, type CardStage } from '../../shared/kanban'
import type { OverviewIndex } from '../../shared/overview'
import { requireDb } from './db'
import { pathsByName, resolveLink } from '../../shared/parse'
import { cardDescription, checklist } from '../../shared/card-fields'

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
 *
 * @param autoProperty the topics property. A pair is an auto edge when
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

  // A board's card lines link it to its cards; that link is membership, not one anyone wrote.
  const members = new Set(
    (handleDb.prepare('SELECT DISTINCT board_path, target_path FROM board_items WHERE target_path IS NOT NULL').all() as {
      board_path: string
      target_path: string
    }[]).map((row) => `${row.board_path}\u0000${row.target_path}`),
  )

  for (const link of [...links, ...resolvedTopics]) {
    if (link.source === link.target) continue
    if (!known.has(link.source) || (!known.has(link.target) && !topics.has(link.target.toLowerCase()))) continue
    const member = members.has(`${link.source}\u0000${link.target}`)
    // Undirected for layout purposes: A->B and B->A are one spring.
    const key = link.source < link.target ? `${link.source}\u0000${link.target}` : `${link.target}\u0000${link.source}`
    const seen = byPair.get(key)
    if (seen !== undefined) {
      if (link.manual === 1) seen.auto = false
      if (!member) delete seen.member
      continue
    }
    byPair.set(key, { source: link.source, target: link.target, auto: link.manual === 0, ...(member ? { member: true } : {}) })
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1)
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1)
  }
  const edges = [...byPair.values()]

  const boardPaths = new Set(boards().map((b) => b.path))
  const stages = stagesByPath()
  const dues = new Map(
    (handleDb.prepare(`SELECT path, value FROM properties WHERE key = 'due'`).all() as { path: string; value: string | null }[]).map((r) => [
      r.path,
      /\d{4}-\d{2}-\d{2}/.exec(r.value ?? '')?.[0] ?? null,
    ]),
  )
  const nodes: GraphNode[] = [
    ...rows.map((row) => {
      const card = stages.get(row.path)
      return {
        path: row.path,
        name: row.name.replace(/\.md$/i, ''),
        title: row.title,
        degree: degree.get(row.path) ?? 0,
        topic: row.path.toLowerCase().startsWith('topics/'),
        ...(boardPaths.has(row.path) ? { board: true } : {}),
        ...(card === undefined ? {} : { stage: card.stage, lane: card.lane, due: dues.get(row.path) ?? null, cardBoard: card.board }),
      }
    }),
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
 * The card fields of the notes some link texts name - the cards a board file
 * lists, `[[Name]]` by `[[Name]]`, resolved the way a link is.
 *
 * A card is a note, so this is a join over the frontmatter rows rather than a
 * table of its own. A card's title is its file name, like every note's in
 * Recto - not its H1. Which lane it is in is the board file's business.
 */
export function cards(targets: readonly string[]): Record<string, BoardCard | null> {
  const handle = requireDb()
  const rows = handle.prepare('SELECT path FROM notes').all() as { path: string }[]
  const allPaths = new Set(rows.map((r) => r.path))
  const byName = pathsByName(allPaths)
  const field = (key: string, as: string): string =>
    `(SELECT value FROM properties WHERE properties.path = n.path AND properties.key = '${key}') AS ${as}`
  const read = handle.prepare(
    `SELECT n.path AS path, n.name AS title,
            ${field('start', 'start')},
            ${field('due', 'due')},
            ${field('completed', 'completed')},
            ${field('priority', 'priority')},
            ${field('tags', 'tags')},
            (SELECT COUNT(*) FROM links WHERE links.source_path = n.path AND links.property IS NULL) AS links,
            (SELECT body FROM notes_fts WHERE notes_fts.path = n.path) AS body
       FROM notes n WHERE n.path = ?`,
  )
  const out: Record<string, BoardCard | null> = {}
  for (const target of targets) {
    const path = resolveLink(target, byName, allPaths)
    const row = path === null ? undefined : (read.get(path) as (Omit<BoardCard, 'description' | 'checklist'> & { body: string | null }) | undefined)
    if (row === undefined) {
      out[target] = null
      continue
    }
    const { body, ...fields } = row
    const items = checklist(body ?? '')
    out[target] = {
      ...fields,
      title: fields.title.replace(/\.md$/i, ''),
      description: cardDescription(body ?? ''),
      checklist: { done: items.filter((item) => item.done).length, total: items.length },
    }
  }
  return out
}

/** Every board note - a note in the Obsidian Kanban format - with its card count. */
export function boards(): BoardSummary[] {
  return (
    requireDb()
      .prepare(
        `SELECT n.path, n.name, (SELECT COUNT(*) FROM board_items bi WHERE bi.board_path = n.path) AS cards
           FROM notes n JOIN properties p ON p.path = n.path AND p.key = 'kanban-plugin'
          WHERE p.value IS NOT NULL AND p.value <> '' AND p.value <> 'false'
          ORDER BY lower(n.name)`,
      )
      .all() as BoardSummary[]
  ).map((row) => ({ ...row, name: row.name.replace(/\.md$/i, '') }))
}

/** Every card that is a note, on every board, and where it stands there. */
export function cardPlaces(): CardPlace[] {
  return requireDb()
    .prepare(
      `SELECT target_path AS path, board_path AS board, lane_title AS lane, stage
         FROM board_items WHERE target_path IS NOT NULL
        -- board_items.lane, not the alias: a bare 'lane' here would sort by the lane's title.
        ORDER BY board_path, board_items.lane, position`,
    )
    .all() as CardPlace[]
}

/** A card's stage over all its boards, and its first board's lane, by note path. */
function stagesByPath(): Map<string, { stage: CardStage | 'mixed'; lane: string; board: string }> {
  const out = new Map<string, { stages: CardStage[]; lane: string; board: string }>()
  for (const place of cardPlaces()) {
    const seen = out.get(place.path)
    if (seen === undefined) out.set(place.path, { stages: [place.stage], lane: place.lane, board: place.board })
    else seen.stages.push(place.stage)
  }
  return new Map([...out].map(([path, v]) => [path, { stage: linkStage(v.stages)!, lane: v.lane, board: v.board }]))
}

/** Notes that are cards: some board lists them. Board notes are left out of the overview's lists too. */
const NOT_CARD = `NOT EXISTS (SELECT 1 FROM board_items bi WHERE bi.target_path = n.path)
  AND NOT EXISTS (SELECT 1 FROM properties kp WHERE kp.path = n.path AND kp.key = 'kanban-plugin')`

/**
 * What the vault overview reads, in one call.
 *
 * Small aggregates, never a walk of the files: the overview opens on a
 * keystroke. `days` are the days "on this day" looks for (a month and a year
 * back), asked by the renderer because its clock is the one on screen.
 *
 * Cards (notes a board lists) are tasks, not notes: they are never orphans
 * and never offered to reread.
 */
export function overview(days: readonly string[]): OverviewIndex {
  const handle = requireDb()
  const one = (sql: string, ...args: unknown[]): number => (handle.prepare(sql).get(...args) as { n: number } | undefined)?.n ?? 0
  const name = (row: { title: string | null; name: string }): string => row.title ?? row.name.replace(/\.md$/i, '')

  const folders = (
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

  // Degree, both directions, over resolved links between two different notes.
  const degree = handle
    .prepare(
      `SELECT n.path AS path, n.title AS title, n.name AS name, COUNT(*) AS links
         FROM (
           SELECT source_path AS path FROM links WHERE target_path IS NOT NULL AND target_path <> source_path
           UNION ALL
           SELECT target_path AS path FROM links WHERE target_path IS NOT NULL AND target_path <> source_path
         ) AS ends
         JOIN notes n ON n.path = ends.path
        WHERE ${NOT_CARD}
        GROUP BY ends.path ORDER BY links DESC, n.name`,
    )
    .all() as { path: string; title: string | null; name: string; links: number }[]
  const linked = degree.map((row) => ({ path: row.path, name: name(row), links: row.links }))

  const orphans = (
    handle
      .prepare(
        `SELECT n.path, n.title, n.name FROM notes n
          WHERE ${NOT_CARD}
            AND NOT EXISTS (SELECT 1 FROM links l WHERE l.source_path = n.path AND l.target_path IS NOT NULL AND l.target_path <> n.path)
            AND NOT EXISTS (SELECT 1 FROM links l WHERE l.target_path = n.path AND l.source_path <> n.path)
          ORDER BY n.name`,
      )
      .all() as { path: string; title: string | null; name: string }[]
  ).map((row) => ({ path: row.path, name: name(row) }))

  const broken = (
    handle
      .prepare(
        `SELECT DISTINCT n.path, n.title, n.name, l.target_text AS target
           FROM links l JOIN notes n ON n.path = l.source_path
          WHERE l.target_path IS NULL ORDER BY n.name, l.target_text`,
      )
      .all() as { path: string; title: string | null; name: string; target: string }[]
  ).map((row) => ({ path: row.path, name: name(row), target: row.target }))

  const stages = stagesByPath()
  const boardName = new Map(boards().map((b) => [b.path, b.name]))
  const dueCards = (
    handle
      .prepare(
        `SELECT n.path, n.title, n.name, due.value AS due
           FROM notes n JOIN properties due ON due.path = n.path AND due.key = 'due'
          WHERE EXISTS (SELECT 1 FROM board_items bi WHERE bi.target_path = n.path)
          ORDER BY due.value, n.name`,
      )
      .all() as { path: string; title: string | null; name: string; due: string | null }[]
  ).flatMap((row) => {
    const due = /\d{4}-\d{2}-\d{2}/.exec(row.due ?? '')?.[0]
    const place = stages.get(row.path)
    if (due === undefined || place === undefined) return []
    return [{ path: row.path, name: name(row), due, done: place.stage === 'done', board: boardName.get(place.board) ?? null }]
  })

  const written =
    days.length === 0
      ? []
      : (
          handle
            .prepare(
              `SELECT n.path, n.title, n.name, n.written FROM notes n
                WHERE ${NOT_CARD} AND n.written IN (${days.map(() => '?').join(', ')}) ORDER BY n.name`,
            )
            .all(...days) as { path: string; title: string | null; name: string; written: string }[]
        ).map((row) => ({ path: row.path, name: name(row), date: row.written }))

  return {
    notes: one('SELECT COUNT(*) AS n FROM notes'),
    words: one('SELECT COALESCE(SUM(words), 0) AS n FROM notes'),
    links: one('SELECT COUNT(*) AS n FROM links'),
    tags: one('SELECT COUNT(DISTINCT tag) AS n FROM tags'),
    oldest: (handle.prepare('SELECT MIN(note_date) AS d FROM notes').get() as { d: string | null }).d,
    folders,
    hubs: linked.slice(0, 4),
    orphans,
    broken,
    dueCards,
    written,
    linked,
  }
}

/**
 * Every note's tags and resolved outgoing links.
 *
 * Read in one pass rather than per note: Tidy reasons over the whole vault at
 * once, and a query per note on a few thousand notes is the difference between
 * instant and a visible pause.
 */
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
