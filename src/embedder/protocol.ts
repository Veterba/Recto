/**
 * Main <-> embedder messages. The embedder owns the model and the
 * `autolink_*` tables; main owns files, settings and decisions.
 */

/** One thing to embed. idx -1 is the note's title vector. */
export type Piece = { idx: number; hash: string; text: string }

export type StateRow = {
  path: string
  meanVec: number[] | null
  ownWords: number
  evaluatedAt: number | null
  embeddedMtime: number | null
}

/** A topic centroid, cached with a key of its membership so a change invalidates it. */
export type CentroidRow = { id: string; members: string; vector: number[] }

export type EmbedRequest =
  | { kind: 'open'; dbPath: string; modelDir: string }
  | { kind: 'embed'; path: string; pieces: Piece[] }
  | { kind: 'forget'; paths: string[] }
  | { kind: 'state-all' }
  | { kind: 'state-put'; rows: (Partial<StateRow> & { path: string })[] }
  | { kind: 'meta-get'; key: string }
  | { kind: 'meta-set'; key: string; value: string | null }
  /** Centred note vectors (see topics/vectors), for the notes that have chunks. */
  | { kind: 'note-vectors'; paths: string[] }
  /** Words embedded like a chunk and centred the same way, to compare with note vectors. */
  | { kind: 'term-vectors'; terms: string[] }
  | { kind: 'centroids-get' }
  /** Replaces the whole cache. */
  | { kind: 'centroids-put'; rows: CentroidRow[] }
  | { kind: 'stats' }

export type EmbedResponse =
  | { kind: 'ok' }
  | { kind: 'embedded'; mean: number[] | null; computed: number }
  | { kind: 'state'; rows: StateRow[] }
  | { kind: 'meta'; value: string | null }
  | { kind: 'note-vectors'; vectors: Record<string, number[]> }
  | { kind: 'term-vectors'; vectors: number[][] }
  | { kind: 'centroids'; rows: CentroidRow[] }
  | { kind: 'stats'; notes: number; chunks: number; rss: number }
  | { kind: 'error'; message: string }
