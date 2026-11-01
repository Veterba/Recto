import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { ToolOutcome } from '../shared/vault-tools'

/**
 * The bridge between `recto-mcp` and the running Recto: a Unix socket in
 * Recto's user-data folder, and a per-install token beside it. Both ends
 * import this file; the MCP program imports nothing else of Recto's but the
 * shared tool catalogue.
 *
 * Messages are JSON, one per line. The first line a client sends is the
 * token; a wrong one ends the connection.
 */

export const TOKEN_FILE = 'mcp-token'

/** macOS allows 104 bytes for a socket path; a longer user-data path gets one in the temp folder, named by it. */
export function socketPath(userData: string): string {
  const inside = path.join(userData, 'recto.sock')
  if (Buffer.byteLength(inside) < 100) return inside
  return path.join(os.tmpdir(), `recto-${createHash('sha1').update(userData).digest('hex').slice(0, 12)}.sock`)
}

export type BridgeRequest = { id: number; method: 'call'; tool: string; args: unknown; client: string } | { id: number; method: 'ping' }

export type BridgeResponse =
  { id: number; outcome: ToolOutcome } | { id: number; pong: { vault: string | null; version: string } } | { id: 0; error: 'bad-token' }

export const CLOSED_MESSAGE = "Recto isn't running. Open Recto, then try again."
