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
 */

import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod'
import { renderBlocks, SERVER_INSTRUCTIONS, VAULT_PROMPTS, VAULT_TOOLS, type ToolOutcome } from '../shared/vault-tools'
import { CLOSED_MESSAGE, socketPath, TOKEN_FILE, type BridgeRequest, type BridgeResponse } from './bridge'

const VERSION = '1'

function arg(name: string): string | null {
  const at = process.argv.indexOf(name)
  return at === -1 ? null : (process.argv[at + 1] ?? null)
}

const data = arg('--data')
const client = arg('--client') ?? 'unknown'

/** One request over a fresh connection: Recto may have restarted since the last one. */
type Request = BridgeRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never

function ask(request: Request, timeoutMs = 55_000): Promise<BridgeResponse | null> {
  return new Promise((resolve) => {
    if (data === null) return resolve(null)
    let token: string
    try {
      token = fs.readFileSync(path.join(data, TOKEN_FILE), 'utf8').trim()
    } catch {
      return resolve(null)
    }
    const socket = net.connect(socketPath(data))
    let buffer = ''
    const done = (value: BridgeResponse | null): void => {
      clearTimeout(timer)
      socket.destroy()
      resolve(value)
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    socket.setEncoding('utf8')
    socket.on('error', () => done(null))
    socket.on('connect', () => socket.write(`${JSON.stringify({ token })}\n${JSON.stringify({ ...request, id: 1 })}\n`))
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const at = buffer.indexOf('\n')
      if (at === -1) return
      try {
        done(JSON.parse(buffer.slice(0, at)) as BridgeResponse)
      } catch {
        done(null)
      }
    })
    socket.on('close', () => done(null))
  })
}

async function call(tool: string, args: unknown): Promise<ToolOutcome> {
  const response = await ask({ method: 'call', tool, args, client })
  if (response === null) return { ok: false, error: CLOSED_MESSAGE }
  if ('error' in response)
    return {
      ok: false,
      error: 'Recto refused the connection: this program has a stale token. Reconnect this client in Recto (Settings → AI).',
    }
  if (!('outcome' in response)) return { ok: false, error: 'Recto gave an unexpected answer.' }
  return response.outcome
}

const asText = (outcome: ToolOutcome): string => (outcome.ok ? renderBlocks(outcome.blocks).join('\n\n') : outcome.error)

function server(): McpServer {
  const mcp = new McpServer({ name: 'recto', version: VERSION }, { instructions: SERVER_INSTRUCTIONS })
  for (const def of VAULT_TOOLS) {
    mcp.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.input,
        annotations: def.write
          ? { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
          : { readOnlyHint: true, openWorldHint: false },
      },
      async (args: unknown) => {
        const outcome = await call(def.name, args)
        return outcome.ok
          ? { content: renderBlocks(outcome.blocks).map((text) => ({ type: 'text' as const, text })) }
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
    const pong = response !== null && 'pong' in response ? response.pong : null
    process.stdout.write(
      `${JSON.stringify(pong === null ? { ok: false, error: response !== null && 'error' in response ? 'bad token' : CLOSED_MESSAGE } : { ok: true, ...pong })}\n`,
    )
    process.exit(pong === null ? 1 : 0)
  })
} else {
  serveStdio(server)
}
