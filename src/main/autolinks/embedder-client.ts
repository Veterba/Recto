import { utilityProcess, type UtilityProcess } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EmbedRequest, EmbedResponse } from '../../embedder/protocol'

/**
 * Spawns the embedder on demand and talks to it.
 *
 * The child exits by itself after a minute idle, so "not running" is the
 * normal state: the next request starts a new one and re-opens the database
 * before anything else, the same way the index client recovers its child.
 */

const dirname = path.dirname(fileURLToPath(import.meta.url))

let child: UtilityProcess | null = null
let nextId = 1
let opening: Extract<EmbedRequest, { kind: 'open' }> | null = null
const pending = new Map<number, { proc: UtilityProcess; resolve: (r: EmbedResponse) => void; reject: (e: Error) => void }>()

function spawn(): UtilityProcess {
  // A second entry of the main build, beside the indexer: out/main/embedder/index.js.
  const proc = utilityProcess.fork(path.join(dirname, 'embedder', 'index.js'), [], {
    serviceName: 'embedder',
    stdio: 'inherit',
  })
  proc.on('message', (message: { id: number; response: EmbedResponse }) => {
    const slot = pending.get(message.id)
    if (!slot) return
    pending.delete(message.id)
    if (message.response.kind === 'error') slot.reject(new Error(message.response.message))
    else slot.resolve(message.response)
  })
  proc.on('exit', (code) => {
    if (child === proc) child = null
    for (const [id, slot] of pending) {
      if (slot.proc !== proc) continue
      pending.delete(id)
      slot.reject(new Error(`embedder exited (code ${code})`))
    }
  })
  return proc
}

function post(proc: UtilityProcess, request: EmbedRequest, timeoutMs: number): Promise<EmbedResponse> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`embedder timed out: ${request.kind}`))
    }, timeoutMs)
    pending.set(id, {
      proc,
      resolve: (r) => {
        clearTimeout(timer)
        resolve(r)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      },
    })
    proc.postMessage({ id, request })
  })
}

export function embedder(request: EmbedRequest, timeoutMs = 120_000): Promise<EmbedResponse> {
  if (request.kind === 'open') opening = request
  if (!child) {
    child = spawn()
    if (opening !== null && request.kind !== 'open') void post(child, opening, timeoutMs).catch(() => undefined)
  }
  return post(child, request, timeoutMs)
}

/** Typed shorthand: send and insist on one kind of answer. */
export async function ask<K extends EmbedResponse['kind']>(
  request: EmbedRequest,
  kind: K,
  timeoutMs?: number,
): Promise<Extract<EmbedResponse, { kind: K }>> {
  const response = await embedder(request, timeoutMs)
  if (response.kind !== kind) throw new Error(`embedder: expected ${kind}, got ${response.kind}`)
  return response as Extract<EmbedResponse, { kind: K }>
}

export function stopEmbedder(): void {
  opening = null
  child?.kill()
  child = null
}

export const embedderRunning = (): boolean => child !== null
