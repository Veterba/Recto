import { app, utilityProcess, type UtilityProcess } from 'electron'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { VAULT_STATE_DIR } from '../shared/ipc-contract'
import type { IndexRequest, IndexResponse } from '../indexer/protocol'
import { currentVault } from './vault'

/**
 * Spawns and talks to the indexer process.
 *
 * Requests are correlated by id, so several can be in flight; the caller just
 * awaits a promise. If the child dies, pending promises reject rather than
 * hanging forever - a silently stuck search is worse than a visible failure.
 */

const dirname = path.dirname(fileURLToPath(import.meta.url))

let child: UtilityProcess | null = null
let nextId = 1
const pending = new Map<
  number,
  { proc: UtilityProcess; resolve: (r: IndexResponse) => void; reject: (e: Error) => void }
>()

/**
 * The vault the index should be open on. A child that dies - or is replaced -
 * starts knowing nothing, so a new one is told this before anything else;
 * otherwise every later request fails with "index not open".
 */
let opening: Extract<IndexRequest, { kind: 'open' }> | null = null

/**
 * Native-module preflight.
 *
 * better-sqlite3 is compiled against a specific NODE_MODULE_VERSION. If it was
 * built for Node rather than Electron, the failure is a throw on first query,
 * deep inside the child, long after startup looked fine. Cabinet learned this
 * the hard way and added the same check; the point is to fail loudly and early,
 * with a message that names the fix.
 */
export function checkNativeModule(): { ok: true } | { ok: false; message: string } {
  try {
    const require = createRequire(import.meta.url)
    require('better-sqlite3')
    return { ok: true }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const mismatch = /NODE_MODULE_VERSION|was compiled against a different/i.test(detail)
    return {
      ok: false,
      message: mismatch
        ? 'The search index needs rebuilding for this version of the app. Run: npm run rebuild'
        : `The search index could not start: ${detail}`,
    }
  }
}

function spawn(): UtilityProcess {
  // Emitted as a second entry of the main (Node) build, so it lands beside
  // main's own bundle at out/main/indexer/index.js - not at out/indexer/.
  const entry = path.join(dirname, 'indexer', 'index.js')
  const proc = utilityProcess.fork(entry, [], { serviceName: 'indexer', stdio: 'inherit' })

  proc.on('message', (message: { id: number; response: IndexResponse }) => {
    const slot = pending.get(message.id)
    if (!slot) return
    pending.delete(message.id)
    if (message.response.kind === 'error') slot.reject(new Error(message.response.message))
    else slot.resolve(message.response)
  })

  proc.on('exit', (code) => {
    /**
     * Only clean up after THIS process.
     *
     * Switching vaults kills the old indexer and starts a new one at once, and
     * the old one's exit arrives a moment later. This handler used to clear
     * `child` and reject every pending request regardless - which dropped the
     * new indexer and failed its "open" and "reindex", so the vault switched to
     * never got indexed and its graph and search stayed empty.
     */
    if (child === proc) child = null
    const error = new Error(`indexer exited (code ${code})`)
    for (const [id, slot] of pending) {
      if (slot.proc !== proc) continue
      pending.delete(id)
      slot.reject(error)
    }
  })

  return proc
}

export function send(request: IndexRequest, timeoutMs = 120_000): Promise<IndexResponse> {
  if (!child) {
    child = spawn()
    // A fresh process has no index open. Messages are handled in order, so
    // queueing the open first is enough - unless this request IS the open.
    if (opening !== null && request.kind !== 'open') {
      void post(child, opening, timeoutMs).catch((err: unknown) => console.error('[indexer] reopen', err))
    }
  }
  if (request.kind === 'open') opening = request
  return post(child, request, timeoutMs)
}

function post(proc: UtilityProcess, request: IndexRequest, timeoutMs: number): Promise<IndexResponse> {
  const id = nextId++

  return new Promise<IndexResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`indexer timed out: ${request.kind}`))
    }, timeoutMs)

    pending.set(id, {
      proc,
      resolve: (response) => {
        clearTimeout(timer)
        resolve(response)
      },
      reject: (err) => {
        clearTimeout(timer)
        reject(err)
      },
    })

    proc.postMessage({ id, request })
  })
}

/** Open the index for the current vault and bring it up to date. */
export async function openIndexForVault(): Promise<void> {
  const vault = currentVault()
  if (!vault) return

  const preflight = checkNativeModule()
  if (!preflight.ok) {
    console.error('[indexer]', preflight.message)
    return
  }

  const opened = await send({
    kind: 'open',
    vaultPath: vault.path,
    dbPath: path.join(vault.path, VAULT_STATE_DIR, 'index.db'),
  })

  // A migration means existing rows are missing the new columns - and since
  // (mtime, size) have not changed, an ordinary reindex would skip every file
  // and the new data would stay empty until each note happened to be edited.
  const migrated = opened.kind === 'opened' && opened.migratedTo > opened.migratedFrom
  await send({ kind: 'reindex', force: migrated })
}

export function stopIndexer(): void {
  opening = null
  if (!child) return
  const proc = child
  child = null
  // Straight to this process: going through `send` after `child` is cleared
  // would spawn a brand-new indexer just to tell it to close.
  void post(proc, { kind: 'close' }, 5_000).catch(() => undefined)
  proc.kill()
}

app.on('will-quit', stopIndexer)
