import path from 'node:path'
import { BOTS_FOLDER, CHATS_FOLDER } from '../../shared/bots'
import type { BotHit } from '../../shared/embedder-protocol'
import { VAULT_STATE_DIR } from '../../shared/vault'
import { send as indexer } from '../index-client'
import { ask, openedDb } from '../topics/embedder-client'
import { modelPresent } from '../topics/model'
import { modelRoot } from '../topics/service'
import { currentVault } from '../vault'
import * as vaultFs from '../vault-fs'
import { chunkInput, chunkNote } from './chunks'
import { isExcluded } from './context'

/**
 * Chunk vectors for the bots: every note cut into search pieces
 * (chunks.ts) and embedded with EmbeddingGemma, in index.db beside the topic
 * vectors. Incremental like topics - a note whose mtime has not changed is
 * not read again, and inside a changed note only new pieces are embedded.
 * Chats and the bots' excluded folders are never indexed.
 *
 * The vectors find what the words don't: a Russian question and an English
 * note, a note that says the same thing in other words.
 */

/** Whether the embedding model is on this Mac; without it the bots search by words only. */
export const vectorsAvailable = (): boolean => modelPresent(modelRoot())

let syncing: Promise<SyncResult> | null = null

export type SyncResult = { notes: number; embedded: number; removed: number; ms: number }

/** The embedder on this vault's index.db - topics may have opened it already. */
async function open(vault: string): Promise<void> {
  const dbPath = path.join(vault, VAULT_STATE_DIR, 'index.db')
  if (openedDb() !== dbPath) await ask({ kind: 'open', dbPath, modelDir: modelRoot() }, 'ok')
}

/**
 * Bring the chunk vectors up to date with the vault. One run at a time; a
 * call during a run waits for that run. `exclude`: folders no bot may read.
 */
export function syncVectors(exclude: readonly string[] = []): Promise<SyncResult> {
  syncing ??= run(exclude).finally(() => (syncing = null))
  return syncing
}

async function run(exclude: readonly string[]): Promise<SyncResult> {
  const started = performance.now()
  const vault = currentVault()
  const none = { notes: 0, embedded: 0, removed: 0, ms: 0 }
  if (vault === null || !vectorsAvailable()) return none
  await open(vault.path)
  const graph = await indexer({ kind: 'topics-graph' }, 30_000)
  if (graph.kind !== 'topics-graph-result') return none
  const skip = [CHATS_FOLDER, path.dirname(BOTS_FOLDER), ...exclude]
  const notes = graph.graph.notes.filter((n) => !isExcluded(n.path, skip))
  const known = (await ask({ kind: 'bot-mtimes' }, 'bot-mtimes')).mtimes
  const keep = new Set(notes.map((n) => n.path))
  const gone = Object.keys(known).filter((p) => !keep.has(p))
  if (gone.length > 0) await ask({ kind: 'bot-forget', paths: gone }, 'ok')
  let embedded = 0
  for (const note of notes) {
    if (known[note.path] === note.mtime) continue
    const read = await vaultFs.readFile(note.path)
    if (!read.ok) continue
    const title = path.basename(note.path).replace(/\.md$/i, '')
    const pieces = chunkNote(title, read.content).map((c) => ({
      idx: c.idx,
      hash: c.hash,
      heading: c.path.join(' > '),
      text: c.text,
      input: chunkInput(title, c),
    }))
    embedded += (await ask({ kind: 'bot-embed', path: note.path, mtime: note.mtime, pieces }, 'bot-embedded', 300_000)).computed
  }
  return { notes: notes.length, embedded, removed: gone.length, ms: performance.now() - started }
}

/** The pieces nearest the question by meaning, best first; empty when there are no vectors. */
export async function searchVectors(query: string, k: number, exclude: readonly string[], only?: readonly string[]): Promise<BotHit[]> {
  const vault = currentVault()
  if (vault === null || !vectorsAvailable()) return []
  try {
    await open(vault.path)
    const request = { kind: 'bot-search' as const, query, k, exclude: [CHATS_FOLDER, path.dirname(BOTS_FOLDER), ...exclude] }
    return (await ask(only === undefined ? request : { ...request, only: [...only] }, 'bot-hits', 30_000)).hits
  } catch {
    return []
  }
}

/** Vectors for short texts (the router's example questions), with the classification prompt. */
export async function embedTexts(texts: string[], prompt: 'classify' | 'query' = 'classify'): Promise<number[][] | null> {
  const vault = currentVault()
  if (vault === null || !vectorsAvailable() || texts.length === 0) return null
  try {
    await open(vault.path)
    return (await ask({ kind: 'embed-texts', texts, prompt }, 'vectors', 60_000)).vectors
  } catch {
    return null
  }
}
