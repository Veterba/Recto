import { BrowserWindow } from 'electron'
import type { AiMessage } from '../../shared/ipc-contract'
import { readKey } from '../secrets'
import { DirectProvider, type AiProvider } from './provider'

/**
 * The AI side of the IPC boundary.
 *
 * Everything here runs in main, which is the point: the key is read here, the
 * HTTPS connection is opened here, and the renderer only ever sees text coming
 * back. A renderer that is compromised by a markdown bug cannot read the key,
 * because the key was never in its process.
 */

/** One provider per key, rebuilt when the key changes. */
let provider: AiProvider | null = null
let providerKey: string | null = null

function current(): AiProvider | null {
  const key = readKey()
  if (key === null) {
    provider = null
    providerKey = null
    return null
  }
  if (provider === null || providerKey !== key) {
    provider = new DirectProvider(key)
    providerKey = key
  }
  return provider
}

/** Called when the stored key changes, so the next request builds a new client. */
export function resetProvider(): void {
  provider = null
  providerKey = null
}

/** In-flight streams, so a Stop button has something to stop. */
const running = new Map<string, AbortController>()

function send(channel: 'ai:delta' | 'ai:done' | 'ai:error', payload: unknown): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (window === undefined || window.isDestroyed()) return
  window.webContents.send(channel, payload)
}

export async function test(model: string): Promise<{ ok: boolean; error?: string }> {
  const client = current()
  if (client === null) return { ok: false, error: 'No API key saved yet.' }
  const result = await client.test(model)
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}

export function cancel(id: string): { ok: boolean } {
  const controller = running.get(id)
  if (controller === undefined) return { ok: false }
  controller.abort()
  running.delete(id)
  return { ok: true }
}

const MAX_TOKENS = 4096

export function startStream(request: {
  id: string
  model: string
  system: string
  messages: AiMessage[]
}): { ok: boolean; error?: string } {
  const client = current()
  if (client === null) {
    return { ok: false, error: 'Add your Anthropic API key in Settings → AI first.' }
  }
  if (running.has(request.id)) return { ok: false, error: 'That conversation is already waiting for a reply.' }

  const controller = new AbortController()
  running.set(request.id, controller)

  // Deliberately not awaited: `ai:send` resolves once the request is accepted,
  // and the reply arrives on the push channels. Awaiting it here would make the
  // renderer's `invoke` hang for the length of the answer.
  void client
    .stream(
      { model: request.model, system: request.system, messages: request.messages, maxTokens: MAX_TOKENS },
      {
        onDelta: (text) => send('ai:delta', { id: request.id, text }),
        onDone: (info) => {
          running.delete(request.id)
          send('ai:done', { id: request.id, ...info })
        },
        onError: (message) => {
          running.delete(request.id)
          send('ai:error', { id: request.id, message })
        },
      },
      controller.signal,
    )
    .catch((err: unknown) => {
      // The provider reports its own failures through onError; this is the
      // belt-and-braces case where the provider itself throws, and it must
      // still produce a terminal event or the UI waits forever.
      running.delete(request.id)
      send('ai:error', { id: request.id, message: err instanceof Error ? err.message : String(err) })
    })

  return { ok: true }
}
