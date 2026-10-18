/** What the index answers with: search hits, backlinks, the graph, boards, history and stats. */

/**
 * The link graph, for the graph view.
 * `topic`: drawn as a hollow circle, and has no note to open.
 */
export type GraphNodeInfo = {
  path: string
  name: string
  title: string | null
  degree: number
  topic: boolean
  /** A board note: drawn as a rounded square. */
  board?: boolean
  /** A card: where it stands, `mixed` when its boards disagree. */
  stage?: 'open' | 'doing' | 'done' | 'mixed'
  due?: string | null
  lane?: string | null
  /** A card's first board note, where a click opens it. */
  cardBoard?: string
}
/** `auto`: the pair is linked only through the topics property. `member`: a board and one of its cards. */
export type GraphEdgeInfo = { source: string; target: string; auto: boolean; member?: boolean }
export type GraphInfo = { nodes: GraphNodeInfo[]; edges: GraphEdgeInfo[] }

/**
 * A card's note, as a board draws it: its frontmatter, read back out of the
 * property index. Which lane it is in is the board file's business.
 */
export type BoardCardInfo = {
  path: string
  title: string
  description: string
  start: string | null
  due: string | null
  completed: string | null
  priority: string | null
  tags: string | null
  checklist: { done: number; total: number }
  links: number
}

/** A board note, for the Tasks sidebar. */
export type BoardSummaryInfo = { path: string; name: string; cards: number }

/** One card on one board: where it stands there. */
export type CardPlaceInfo = { path: string; board: string; lane: string; stage: 'open' | 'doing' | 'done' }

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

