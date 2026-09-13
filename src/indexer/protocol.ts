/**
 * The message contract between main and the indexer process.
 *
 * Separate from the renderer's IPC contract on purpose: the renderer talks to
 * main, main talks to the indexer, and neither end of one hop should be able to
 * reach across the other.
 */

export type SearchHit = {
  path: string
  snippet: string
  /** BM25; lower is better, which is SQLite's convention. */
  score: number
}

/** The link graph. Degree is precomputed so the renderer can size nodes. */
export type GraphNode = { path: string; name: string; title: string | null; degree: number }
export type GraphEdge = { source: string; target: string }
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] }

export type Backlink = {
  path: string
  line: number
  alias: string | null
  /** The source line, so the list shows why the note is linked. */
  context: string | null
  title: string | null
}

/**
 * One card on a board. A card IS a note - these fields are frontmatter, read
 * back out of the properties table rather than stored anywhere of their own.
 */
export type BoardCard = {
  path: string
  title: string
  /** First line of the note's body, for the card. Empty when there is none. */
  preview: string
  status: string | null
  /** Fractional index within its column; null for a card never dragged. */
  order: number | null
  due: string | null
  priority: string | null
}

/** What Tidy reasons over: a note's own signals about where it belongs. */
export type NoteContext = { path: string; tags: string[]; links: string[] }

export type NoteChange = { type: 'upserted' | 'removed'; path: string }

/** One stored version of a note. `content` is omitted when listing. */
export type Snapshot = { id: number; path: string; ts: number; bytes: number; content?: string }

export type IndexRequest =
  | { kind: 'open'; vaultPath: string; dbPath: string }
  | { kind: 'reindex'; force?: boolean }
  | { kind: 'note-changed'; changes: NoteChange[] }
  | { kind: 'search'; query: string; limit?: number }
  | { kind: 'backlinks'; path: string }
  | { kind: 'resolve-link'; target: string }
  | { kind: 'resolve-links'; targets: string[] }
  | { kind: 'unresolved' }
  | { kind: 'graph' }
  | { kind: 'board'; board: string }
  | { kind: 'boards' }
  | { kind: 'context' }
  | { kind: 'note-renamed'; from: string; to: string }
  | { kind: 'history'; path: string }
  | { kind: 'history-get'; id: number }
  | { kind: 'history-prune' }
  | { kind: 'stats' }
  | { kind: 'close' }

export type IndexResponse =
  | { kind: 'opened'; migratedFrom: number; migratedTo: number }
  | { kind: 'reindexed'; indexed: number; removed: number; total: number }
  | { kind: 'note-changed-done' }
  | { kind: 'search-result'; hits: SearchHit[] }
  | { kind: 'backlinks-result'; links: Backlink[] }
  | { kind: 'resolve-link-result'; path: string | null }
  | { kind: 'resolve-links-result'; resolved: Record<string, string | null> }
  | { kind: 'unresolved-result'; entries: { target: string; sources: string[] }[] }
  | { kind: 'graph-result'; graph: GraphData }
  | { kind: 'board-result'; cards: BoardCard[] }
  | { kind: 'boards-result'; boards: { board: string; count: number }[] }
  | { kind: 'context-result'; notes: NoteContext[] }
  | { kind: 'history-result'; snapshots: Snapshot[] }
  | { kind: 'history-get-result'; snapshot: Snapshot | null }
  | { kind: 'history-prune-result'; removed: number }
  | { kind: 'stats-result'; notes: number; links: number; unresolved: number; tags: number }
  | { kind: 'closed' }
  | { kind: 'error'; message: string }
