import { BrowserWindow } from 'electron'
import { MAX_ANSWER_TOKENS, UTILITY_MODEL, type AiMessage } from '../../shared/ai'
import { AI_ACCESS_STATE, coerceAiAccess } from '../../shared/ai-access'
import { readState } from '../state'
import * as vaultFs from '../vault-fs'
import { buildScope } from '../vault-tools/scope'
import { readKey } from '../secrets'
import { DirectProvider, type AiProvider } from './provider'
import { IPC_EVENT } from '../../shared/ipc'
import type { IpcEvents } from '../../shared/ipc'
import { sendEvent } from '../events'

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

function send<C extends typeof IPC_EVENT.aiDelta | typeof IPC_EVENT.aiDone | typeof IPC_EVENT.aiError>(
  channel: C,
  ...args: Parameters<IpcEvents[C]>
): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (window === undefined || window.isDestroyed()) return
  sendEvent(window, channel, ...args)
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

/** How much of a note a summary reads. */
const SUMMARY_INPUT_CHARS = 24_000
const SUMMARY_SYSTEM =
  "Summarise the user's note in two or three plain sentences: what it is about and what matters in it. No preamble, no bullet points, no markdown."

/**
 * "Summarize with Claude" in a note's preview card. Only the note's path comes
 * from the renderer; the text, the instructions and the model are main's. It
 * is a cloud call like any other: refused while Cloud is off for the vault,
 * and for a note excluded from AI (or a chat), whose text never leaves.
 */
export async function summarize(id: string, notePath: string): Promise<{ ok: boolean; error?: string }> {
  if (!coerceAiAccess(readState(AI_ACCESS_STATE)).cloud)
    return { ok: false, error: 'Cloud providers are off for this vault. Turn them on in Settings → AI → Providers.' }
  let hidden: boolean
  try {
    hidden = buildScope('recto').hidden(notePath)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (hidden) return { ok: false, error: 'This note is in a folder excluded from AI, so it is not sent anywhere.' }
  const read = await vaultFs.readFile(notePath)
  if (!read.ok) return { ok: false, error: read.error }
  return startStream({ id, model: UTILITY_MODEL, system: SUMMARY_SYSTEM, messages: [{ role: 'user', content: read.content.slice(0, SUMMARY_INPUT_CHARS) }] })
}

function startStream(request: { id: string; model: string; system: string; messages: AiMessage[] }): {
  ok: boolean
  error?: string
} {
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
      { model: request.model, system: request.system, messages: request.messages, maxTokens: MAX_ANSWER_TOKENS },
      {
        onDelta: (text) => send(IPC_EVENT.aiDelta, { id: request.id, text }),
        onDone: (info) => {
          running.delete(request.id)
          send(IPC_EVENT.aiDone, { id: request.id, ...info })
        },
        onError: (message) => {
          running.delete(request.id)
          send(IPC_EVENT.aiError, { id: request.id, message })
        },
      },
      controller.signal,
    )
    .catch((err: unknown) => {
      // The provider reports its own failures through onError; this is the
      // belt-and-braces case where the provider itself throws, and it must
      // still produce a terminal event or the UI waits forever.
      running.delete(request.id)
      send(IPC_EVENT.aiError, { id: request.id, message: err instanceof Error ? err.message : String(err) })
    })

  return { ok: true }
}
