/**
 * `recto-mcp`: the MCP server an AI client starts (Claude Code, Codex,
 * Claude Desktop, Cursor). It lists Recto's tools and forwards every call to
 * the running Recto over the bridge (bridge.ts); all reading, rules and
 * writing happen there. With Recto closed it still lists its tools, and
 * every call says to open Recto.
 *
 * Bundled into one self-contained file (out/mcp/recto-mcp.mjs) that runs on
 * Recto's own Electron as Node, or on Claude Desktop's Node from a .mcpb.
 *
 *   recto-mcp --data <Recto's user-data folder> [--client <id>] [--self-test]
 *             [--session <id> --tools <name,name,…>]
 *
 * `--session` and `--tools` are for Recto's own providers: a CLI that Recto
 * starts gets a session (what it may see and change) and only its tools.
 */

import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod'
import { imagesOf, renderBlocks, serverInstructions, VAULT_PROMPTS, VAULT_TOOLS, type ToolOutcome } from '../shared/vault-tools'
import { CLOSED_MESSAGE, DROPPED_MESSAGE, socketPath, TIMEOUT_MESSAGE, TOKEN_FILE, TOO_LARGE_MESSAGE, type BridgeRequest, type BridgeResponse } from './bridge'

declare const __RECTO_VERSION__: string | undefined
/** This Recto's version (set at build), as the server tells AI clients. */
const VERSION = typeof __RECTO_VERSION__ === 'string' ? __RECTO_VERSION__ : 'dev'

function arg(name: string): string | null {
  const at = process.argv.indexOf(name)
  return at === -1 ? null : (process.argv[at + 1] ?? null)
}

const data = arg('--data')
const client = arg('--client') ?? 'unknown'
const session = arg('--session') ?? undefined
const only = arg('--tools')?.split(',') ?? null

/** One request over a fresh connection: Recto may have restarted since the last one. */
type Request = BridgeRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never

/** Why no answer came: Recto is not running, it took too long, or it closed the connection after taking it. */
type NoAnswer = { failed: string }

/**
 * Longer than Recto's own limit on a call (60 s, vault-tools/read.ts): the bridge never gives up while Recto
 * may still finish - and write - what was asked; Recto answers first, with its own reason, when it cannot.
 */
const ANSWER_MS = 75_000

function ask(request: Request, timeoutMs = ANSWER_MS): Promise<BridgeResponse | NoAnswer> {
  return new Promise((resolve) => {
    if (data === null) return resolve({ failed: CLOSED_MESSAGE })
    let token: string
    try {
      token = fs.readFileSync(path.join(data, TOKEN_FILE), 'utf8').trim()
    } catch {
      return resolve({ failed: CLOSED_MESSAGE })
    }
    const socket = net.connect(socketPath(data))
    let buffer = ''
    let connected = false
    const done = (value: BridgeResponse | NoAnswer): void => {
      clearTimeout(timer)
      socket.destroy()
      resolve(value)
    }
    const timer = setTimeout(() => done({ failed: TIMEOUT_MESSAGE }), timeoutMs)
    socket.setEncoding('utf8')
    // Before the connection there is no Recto to talk to; after it, Recto was there and stopped answering.
    socket.on('error', () => done({ failed: connected ? DROPPED_MESSAGE : CLOSED_MESSAGE }))
    socket.on('connect', () => {
      connected = true
      socket.write(`${JSON.stringify({ token })}\n${JSON.stringify({ ...request, id: 1 })}\n`)
    })
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const at = buffer.indexOf('\n')
      if (at === -1) return
      try {
        done(JSON.parse(buffer.slice(0, at)) as BridgeResponse)
      } catch {
        done({ failed: 'Recto gave an answer this program could not read.' })
      }
    })
    socket.on('close', () => done({ failed: connected ? DROPPED_MESSAGE : CLOSED_MESSAGE }))
  })
}

async function call(tool: string, args: unknown): Promise<ToolOutcome> {
  const response = await ask({ method: 'call', tool, args, client, ...(session === undefined ? {} : { session }) })
  if ('failed' in response) return { ok: false, error: response.failed }
  if ('error' in response)
    return {
      ok: false,
      error:
        response.error === 'too-large'
          ? TOO_LARGE_MESSAGE
          : 'Recto refused the connection: this program has a stale token. Reconnect this client in Recto (Settings → AI).',
    }
  if (!('outcome' in response)) return { ok: false, error: 'Recto gave an unexpected answer.' }
  return response.outcome
}

const asText = (outcome: ToolOutcome): string => (outcome.ok ? renderBlocks(outcome.blocks).join('\n\n') : outcome.error)

function server(): McpServer {
  const mcp = new McpServer({ name: 'recto', version: VERSION }, { instructions: serverInstructions(only) })
  for (const def of VAULT_TOOLS) {
    if (only !== null && !only.includes(def.name)) continue
    mcp.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.input,
        // A write suggests (or, in Write directly, writes after a backup; a delete goes to the archive): not
        // destructive. Taking back a suggestion changes Recto's own state, not a file.
        annotations: def.write
          ? { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
          : def.changes === true
            ? { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
            : { readOnlyHint: true, openWorldHint: false },
      },
      async (args: unknown) => {
        const outcome = await call(def.name, args)
        // Text for every block, and a picture as an image the client's model can look at.
        return outcome.ok
          ? {
              content: [
                ...renderBlocks(outcome.blocks).map((text) => ({ type: 'text' as const, text })),
                ...imagesOf(outcome.blocks).map((i) => ({ type: 'image' as const, data: i.data, mimeType: i.mime })),
              ],
            }
          : { content: [{ type: 'text' as const, text: outcome.error }], isError: true }
      },
    )
  }
  for (const prompt of VAULT_PROMPTS) {
    const shape = Object.fromEntries(
      prompt.args.map((a) => [a.name, a.required ? z.string().describe(a.description) : z.string().optional().describe(a.description)]),
    )
    const messages = (args: Record<string, string>): { messages: { role: 'user'; content: { type: 'text'; text: string } }[] } => ({
      messages: [{ role: 'user', content: { type: 'text', text: prompt.text(args) } }],
    })
    if (prompt.args.length === 0)
      mcp.registerPrompt(prompt.name, { title: prompt.title, description: prompt.description }, () => messages({}))
    else
      mcp.registerPrompt(prompt.name, { title: prompt.title, description: prompt.description, argsSchema: z.object(shape) }, (args) =>
        messages(args as Record<string, string>),
      )
  }
  mcp.registerResource(
    'guide',
    'recto://guide',
    { title: 'AI guide', description: "The person's instructions for AI in this vault.", mimeType: 'text/plain' },
    async (uri) => ({
      contents: [{ uri: uri.href, text: asText(await call('get_ai_guide', {})) }],
    }),
  )
  mcp.registerResource(
    'profile',
    'recto://profile',
    { title: 'Vault profile', description: 'How this vault is organised.', mimeType: 'application/json' },
    async (uri) => ({
      contents: [{ uri: uri.href, text: asText(await call('get_vault_profile', {})) }],
    }),
  )
  return mcp
}

if (process.argv.includes('--self-test')) {
  // Settings → AI → Test connection: this launcher, this socket, this token.
  void ask({ method: 'ping' }, 5000).then((response) => {
    const pong = 'pong' in response ? response.pong : null
    const error = 'failed' in response ? response.failed : 'error' in response ? 'bad token' : 'Recto gave an unexpected answer.'
    process.stdout.write(`${JSON.stringify(pong === null ? { ok: false, error } : { ok: true, ...pong })}\n`)
    process.exit(pong === null ? 1 : 0)
  })
} else {
  serveStdio(server)
}
