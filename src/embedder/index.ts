import Database from 'better-sqlite3'
import { meanVector } from '../main/autolinks/score'
import { capped, centre, noteVector, vaultMean } from '../main/topics/vectors'
import { createEncoder, DIMS, type Encoder } from './encoder'
import type { EmbedRequest, EmbedResponse, Piece, StateRow } from './protocol'

/**
 * The embedder, in its own process.
 *
 * Off the indexer on purpose: a note's worth of inference is most of a second,
 * and search must never queue behind it. It is spawned when there is work,
 * runs on two threads, and exits after a minute with nothing to do - the model
 * costs ~250 MB resident and there is no reason to hold that all day.
 *
 * Never touches the network: `allowRemoteModels` is off, and the model is read
 * from the folder main downloaded it into.
 */

const IDLE_EXIT_MS = 60_000

let db: Database.Database | null = null
let modelDir = ''

let encoder: Promise<Encoder> | null = null

/** Every note's vectors, loaded once per process. */
type Vectors = { chunks: Float32Array[]; title: Float32Array | null }
let store: Map<string, Vectors> | null = null

function requireDb(): Database.Database {
  if (!db) throw new Error('embedder not open')
  return db
}

const toBlob = (v: Float32Array): Buffer => Buffer.from(v.buffer, v.byteOffset, v.byteLength)
const fromBlob = (b: Buffer): Float32Array => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))

function loadStore(): Map<string, Vectors> {
  if (store !== null) return store
  store = new Map()
  const rows = requireDb().prepare('SELECT path, idx, vec FROM autolink_chunks ORDER BY path, idx').all() as {
    path: string
    idx: number
    vec: Buffer
  }[]
  for (const row of rows) {
    let entry = store.get(row.path)
    if (entry === undefined) {
      entry = { chunks: [], title: null }
      store.set(row.path, entry)
    }
    if (row.idx < 0) entry.title = fromBlob(row.vec)
    else entry.chunks.push(fromBlob(row.vec))
  }
  return store
}

/** Bring one note's rows to exactly `pieces`, embedding only what is new. */
async function embed(path: string, pieces: Piece[]): Promise<{ mean: number[] | null; computed: number }> {
  const handle = requireDb()
  const old = handle.prepare('SELECT hash, vec FROM autolink_chunks WHERE path = ?').all(path) as {
    hash: string
    vec: Buffer
  }[]
  const known = new Map(old.map((r) => [r.hash, fromBlob(r.vec)]))
  const missing = pieces.filter((p) => !known.has(p.hash))
  if (missing.length > 0) {
    encoder ??= createEncoder(modelDir)
    const vecs = await (await encoder)(missing.map((p) => p.text))
    missing.forEach((p, i) => known.set(p.hash, vecs[i]!))
  }

  const entry: Vectors = { chunks: [], title: null }
  handle.transaction(() => {
    handle.prepare('DELETE FROM autolink_chunks WHERE path = ?').run(path)
    const insert = handle.prepare('INSERT INTO autolink_chunks (path, idx, hash, vec) VALUES (?, ?, ?, ?)')
    for (const piece of [...pieces].sort((a, b) => a.idx - b.idx)) {
      const vec = known.get(piece.hash)!
      insert.run(path, piece.idx, piece.hash, toBlob(vec))
      if (piece.idx < 0) entry.title = vec
      else entry.chunks.push(vec)
    }
  })()
  loadStore().set(path, entry)
  return { mean: entry.chunks.length === 0 ? null : [...meanVector(entry.chunks)], computed: missing.length }
}

/**
 * The vault's mean chunk, over the chunks note vectors use: a 500-chunk log
 * counts as one note here too, or it would be most of the mean.
 */
const meanChunk = (): Float32Array => vaultMean([...loadStore().values()].flatMap((v) => capped(v.chunks)), DIMS)

/**
 * Note vectors for topics: every chunk centred on the vault's mean chunk
 * vector, then averaged per note (at most 48 chunks, evenly spaced).
 */
function noteVectors(paths: string[]): Record<string, number[]> {
  const vectors = loadStore()
  const mean = meanChunk()
  const out: Record<string, number[]> = {}
  for (const p of paths) {
    const v = vectors.get(p)
    const note = v === undefined ? null : noteVector(v.chunks, mean)
    if (note !== null) out[p] = [...note]
  }
  return out
}

/** Candidate words for topic names: each embedded once per process, centred on the vault mean. */
const termCache = new Map<string, Float32Array>()

async function termVectors(terms: string[]): Promise<number[][]> {
  const missing = [...new Set(terms)].filter((t) => !termCache.has(t))
  if (missing.length > 0) {
    encoder ??= createEncoder(modelDir)
    const vecs = await (await encoder)(missing)
    missing.forEach((t, i) => termCache.set(t, vecs[i]!))
  }
  const mean = meanChunk()
  return terms.map((t) => [...centre(termCache.get(t)!, mean)])
}

type RawState = {
  path: string
  mean_vec: Buffer | null
  own_words: number | null
  evaluated_at: number | null
  embedded_mtime: number | null
}

function stateAll(): StateRow[] {
  return (requireDb().prepare('SELECT * FROM autolink_state').all() as RawState[]).map((r) => ({
    path: r.path,
    meanVec: r.mean_vec === null ? null : [...fromBlob(r.mean_vec)],
    ownWords: r.own_words ?? 0,
    evaluatedAt: r.evaluated_at,
    embeddedMtime: r.embedded_mtime,
  }))
}

function statePut(rows: (Partial<StateRow> & { path: string })[]): void {
  const handle = requireDb()
  const columns: Record<string, (row: Partial<StateRow>) => unknown> = {
    mean_vec: (r) => (r.meanVec === undefined ? undefined : r.meanVec === null ? null : toBlob(Float32Array.from(r.meanVec))),
    own_words: (r) => r.ownWords,
    evaluated_at: (r) => r.evaluatedAt,
    embedded_mtime: (r) => r.embeddedMtime,
  }
  handle.transaction(() => {
    for (const row of rows) {
      handle.prepare('INSERT OR IGNORE INTO autolink_state (path) VALUES (?)').run(row.path)
      for (const [column, get] of Object.entries(columns)) {
        const value = get(row)
        if (value !== undefined) handle.prepare(`UPDATE autolink_state SET ${column} = ? WHERE path = ?`).run(value, row.path)
      }
    }
  })()
}

function forget(paths: string[]): void {
  const handle = requireDb()
  handle.transaction(() => {
    for (const p of paths) {
      handle.prepare('DELETE FROM autolink_chunks WHERE path = ?').run(p)
      handle.prepare('DELETE FROM autolink_state WHERE path = ?').run(p)
      store?.delete(p)
    }
  })()
}

async function run(request: EmbedRequest): Promise<EmbedResponse> {
  switch (request.kind) {
    case 'open': {
      db?.close()
      db = new Database(request.dbPath)
      db.pragma('journal_mode = WAL')
      // The indexer writes to the same file; wait for it rather than failing.
      db.pragma('busy_timeout = 5000')
      db.pragma('synchronous = NORMAL')
      modelDir = request.modelDir
      store = null
      termCache.clear()
      return { kind: 'ok' }
    }
    case 'embed':
      return { kind: 'embedded', ...(await embed(request.path, request.pieces)) }
    case 'forget':
      forget(request.paths)
      return { kind: 'ok' }
    case 'state-all':
      return { kind: 'state', rows: stateAll() }
    case 'state-put':
      statePut(request.rows)
      return { kind: 'ok' }
    case 'meta-get': {
      const row = requireDb().prepare('SELECT value FROM autolink_meta WHERE key = ?').get(request.key) as
        | { value: string | null }
        | undefined
      return { kind: 'meta', value: row?.value ?? null }
    }
    case 'meta-set':
      if (request.value === null) requireDb().prepare('DELETE FROM autolink_meta WHERE key = ?').run(request.key)
      else requireDb().prepare('INSERT OR REPLACE INTO autolink_meta (key, value) VALUES (?, ?)').run(request.key, request.value)
      return { kind: 'ok' }
    case 'note-vectors':
      return { kind: 'note-vectors', vectors: noteVectors(request.paths) }
    case 'term-vectors':
      return { kind: 'term-vectors', vectors: await termVectors(request.terms) }
    case 'centroids-get': {
      const rows = requireDb().prepare('SELECT id, members, vec FROM topic_centroids').all() as {
        id: string
        members: string
        vec: Buffer
      }[]
      return { kind: 'centroids', rows: rows.map((r) => ({ id: r.id, members: r.members, vector: [...fromBlob(r.vec)] })) }
    }
    case 'centroids-put': {
      const handle = requireDb()
      handle.transaction(() => {
        handle.prepare('DELETE FROM topic_centroids').run()
        const insert = handle.prepare('INSERT INTO topic_centroids (id, members, vec) VALUES (?, ?, ?)')
        for (const r of request.rows) insert.run(r.id, r.members, toBlob(Float32Array.from(r.vector)))
      })()
      return { kind: 'ok' }
    }
    case 'stats': {
      const handle = requireDb()
      const notes = (handle.prepare('SELECT COUNT(DISTINCT path) AS n FROM autolink_chunks').get() as { n: number }).n
      const chunks = (handle.prepare('SELECT COUNT(*) AS n FROM autolink_chunks WHERE idx >= 0').get() as { n: number }).n
      return { kind: 'stats', notes, chunks, rss: process.memoryUsage().rss }
    }
  }
}

/**
 * Requests are run one at a time, in order. Inference is the slow part and it
 * is single-flight anyway; serialising everything keeps the store and the
 * tables from interleaving.
 */
let queue: Promise<unknown> = Promise.resolve()
let busy = 0
let idleTimer: NodeJS.Timeout | null = null

function armIdle(): void {
  if (idleTimer !== null) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (busy > 0) return armIdle()
    db?.close()
    process.exit(0)
  }, IDLE_EXIT_MS)
}

process.parentPort?.on('message', (event) => {
  const { id, request } = event.data as { id: number; request: EmbedRequest }
  const reply = (response: EmbedResponse): void => process.parentPort?.postMessage({ id, response })
  busy++
  queue = queue
    .then(() => run(request))
    .then(reply, (err: unknown) => reply({ kind: 'error', message: err instanceof Error ? err.message : String(err) }))
    .finally(() => {
      busy--
      armIdle()
    })
})
armIdle()
