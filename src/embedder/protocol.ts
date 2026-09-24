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
  suggested: { target: string; score: number; reason: string }[]
}

export type Match = { path: string; sem: number; bestChunk: number }

export type EmbedRequest =
  | { kind: 'open'; dbPath: string; modelDir: string }
  | { kind: 'embed'; path: string; pieces: Piece[] }
  | { kind: 'forget'; paths: string[] }
  | { kind: 'state-all' }
  | { kind: 'state-put'; rows: (Partial<StateRow> & { path: string })[] }
  | { kind: 'meta-get'; key: string }
  | { kind: 'meta-set'; key: string; value: string | null }
  /** Targets for `path`, from `allowed`, best first; `include` always comes back. */
  | { kind: 'similar'; path: string; allowed: string[]; include: string[]; top: number }
  /** Sources that `path` would suit, from `allowed`: sem(source -> path). */
  | { kind: 'reverse'; path: string; allowed: string[]; top: number }
  /** sem for each [source, target] pair: the vault's chance similarity. */
  | { kind: 'sample'; pairs: [string, string][] }
  /** Mean chunk vector per note, for spotting near-duplicates. */
  | { kind: 'means'; paths: string[] }
  | { kind: 'stats' }

export type EmbedResponse =
  | { kind: 'ok' }
  | { kind: 'embedded'; mean: number[] | null; computed: number }
  | { kind: 'state'; rows: StateRow[] }
  | { kind: 'meta'; value: string | null }
  | { kind: 'matches'; matches: Match[] }
  | { kind: 'sems'; sems: number[] }
  | { kind: 'means'; means: Record<string, number[]> }
  | { kind: 'stats'; notes: number; chunks: number; rss: number }
  | { kind: 'error'; message: string }
