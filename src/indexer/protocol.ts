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

export type Backlink = { path: string; line: number; alias: string | null }

export type NoteChange = { type: 'upserted' | 'removed'; path: string }

export type IndexRequest =
  | { kind: 'open'; vaultPath: string; dbPath: string }
  | { kind: 'reindex'; force?: boolean }
  | { kind: 'note-changed'; changes: NoteChange[] }
  | { kind: 'search'; query: string; limit?: number }
  | { kind: 'backlinks'; path: string }
  | { kind: 'resolve-link'; target: string }
  | { kind: 'stats' }
  | { kind: 'close' }

export type IndexResponse =
  | { kind: 'opened'; migratedFrom: number; migratedTo: number }
  | { kind: 'reindexed'; indexed: number; removed: number; total: number }
  | { kind: 'note-changed-done' }
  | { kind: 'search-result'; hits: SearchHit[] }
  | { kind: 'backlinks-result'; links: Backlink[] }
  | { kind: 'resolve-link-result'; path: string | null }
  | { kind: 'stats-result'; notes: number; links: number; unresolved: number; tags: number }
  | { kind: 'closed' }
  | { kind: 'error'; message: string }
