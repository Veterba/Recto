/** What the index answers with: search hits, backlinks, the graph, boards, history and stats. */

/**
 * The link graph, for the graph view.
 * `topic`: drawn as a hollow circle, and has no note to open.
 */
export type GraphNodeInfo = { path: string; name: string; title: string | null; degree: number; topic: boolean }
/** `auto`: the pair is linked only through the topics property. */
export type GraphEdgeInfo = { source: string; target: string; auto: boolean }
export type GraphInfo = { nodes: GraphNodeInfo[]; edges: GraphEdgeInfo[] }

/**
 * One card on a kanban board - which is just a note whose frontmatter says so.
 * There is no card record: these fields come back out of the property index.
 */
export type BoardCardInfo = {
  path: string
  title: string
  preview: string
  status: string | null
  order: number | null
  due: string | null
  priority: string | null
}

/** A note's own signals about where it belongs, for Tidy. */
export type NoteContextInfo = { path: string; tags: string[]; links: string[] }

/** One stored version of a note. `content` is present only for a single fetch. */
export type SnapshotInfo = { id: number; path: string; ts: number; bytes: number; content?: string }

/** A full-text hit. `snippet` marks matches with << >> for the UI to highlight. */
export type SearchResult = { path: string; snippet: string; score: number }
export type BacklinkResult = {
  path: string
  line: number
  alias: string | null
  context: string | null
  title: string | null
}

export type IndexStats = { notes: number; links: number; unresolved: number; tags: number }

/**
 * The vault's own account of itself, for the home overlay.
 *
 * `mtime` is the only date the filesystem keeps that survives a clone or a
 * sync, so everything dated here means *touched*, not created.
 */
export type VaultUsage = {
  notes: number
  links: number
  unresolved: number
  tags: number
  touchedThisWeek: number
  /** Notes touched per day, oldest first, seven entries. */
  weekTrend: number[]
  topFolders: { name: string; count: number }[]
  topTags: { tag: string; count: number }[]
  hubs: { name: string; links: number }[]
}
