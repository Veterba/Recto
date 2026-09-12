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
  | { kind: 'history-result'; snapshots: Snapshot[] }
  | { kind: 'history-get-result'; snapshot: Snapshot | null }
  | { kind: 'history-prune-result'; removed: number }
  | { kind: 'stats-result'; notes: number; links: number; unresolved: number; tags: number }
  | { kind: 'closed' }
  | { kind: 'error'; message: string }
