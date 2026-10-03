/**
 * Main <-> embedder messages. The embedder owns the model and the
 * note-vector tables (`autolink_*`, named before topics); main owns files,
 * settings and decisions.
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

/** A bot search piece (main/bots/chunks.ts): `input` is what is embedded, `text` what is read. */
export type BotPiece = { idx: number; hash: string; heading: string; text: string; input: string }

/** A piece found by its vector, best first. */
export type BotHit = { path: string; idx: number; heading: string; text: string; score: number }

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
  /** Bring one note's bot pieces to exactly `pieces`, embedding only new ones. */
  | { kind: 'bot-embed'; path: string; mtime: number; pieces: BotPiece[] }
  | { kind: 'bot-forget'; paths: string[] }
  /** Every note with bot pieces, and the mtime it was cut at. */
  | { kind: 'bot-mtimes' }
  /** The `k` pieces nearest a question, outside `exclude` (folder prefixes). */
  | { kind: 'bot-search'; query: string; k: number; exclude: string[]; only?: string[] }
  /** Plain vectors for texts, with one of the encoder's prompts ('classify' for the router). */
  | { kind: 'embed-texts'; texts: string[]; prompt: 'classify' | 'query' }

export type EmbedResponse =
  | { kind: 'ok' }
  | { kind: 'embedded'; mean: number[] | null; computed: number }
  | { kind: 'state'; rows: StateRow[] }
  | { kind: 'meta'; value: string | null }
  | { kind: 'note-vectors'; vectors: Record<string, number[]> }
  | { kind: 'term-vectors'; vectors: number[][] }
  | { kind: 'centroids'; rows: CentroidRow[] }
  | { kind: 'stats'; notes: number; chunks: number; rss: number }
  | { kind: 'bot-embedded'; computed: number }
  | { kind: 'bot-mtimes'; mtimes: Record<string, number> }
  | { kind: 'bot-hits'; hits: BotHit[] }
  | { kind: 'vectors'; vectors: number[][] }
  | { kind: 'error'; message: string }
