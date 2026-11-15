import { app } from 'electron'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { MAX_REQUEST_CHARS, socketPath, TOKEN_FILE, type BridgeRequest, type BridgeResponse } from '../../mcp/bridge'
import { currentVault } from '../vault'
import { callTool } from '.'

/**
 * The socket `recto-mcp` reaches Recto through (src/mcp/bridge.ts). Only this
 * user can open it (0600), and a connection is served only after it sends
 * the per-install token, which only this user can read.
 */

let server: net.Server | null = null

/** The token, made once per install. */
export function mcpToken(userData = app.getPath('userData')): string {
  const file = path.join(userData, TOKEN_FILE)
  try {
    const existing = fs.readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f]{64}$/.test(existing)) return existing
  } catch {
    // None yet.
  }
  const token = randomBytes(32).toString('hex')
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
  return token
}

/**
 * Compared as digests, always 32 bytes each: compared as they came, a 64-letter
 * token with a non-ASCII letter was longer in bytes than in letters, and
 * timingSafeEqual threw - uncaught, it took Recto down.
 */
const digest = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest()
const same = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b))

/** How long a connection has to send the token before it is closed. */
const AUTH_MS = 5000

function serve(socket: net.Socket, token: string): void {
  let buffer = ''
  let authed = false
  const reply = (response: BridgeResponse): void => void socket.write(`${JSON.stringify(response)}\n`)
  socket.setEncoding('utf8')
  socket.on('error', () => undefined)
  const deadline = setTimeout(() => socket.destroy(), AUTH_MS)
  socket.on('close', () => clearTimeout(deadline))
  socket.on('data', (chunk: string) => {
    // Whatever a client sends, it must not throw out of here: an uncaught error ends Recto.
    try {
      read(chunk)
    } catch (err) {
      console.error('[mcp socket]', err)
      socket.destroy()
    }
  })
  const read = (chunk: string): void => {
    // Refused and closing: the rest of what it sends is not read.
    if (socket.writableEnded) return
    buffer += chunk
    // A client that never sends a newline does not get to fill memory - told why, not just cut off.
    if (buffer.length > MAX_REQUEST_CHARS) {
      buffer = ''
      reply({ id: 0, error: 'too-large' })
      socket.end()
      return
    }
    let at: number
    while ((at = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, at)
      buffer = buffer.slice(at + 1)
      if (!authed) {
        let sent = ''
        try {
          sent = String((JSON.parse(line) as { token?: unknown }).token ?? '')
        } catch {
          // Not JSON: not the token either.
        }
        if (!same(sent, token)) {
          reply({ id: 0, error: 'bad-token' })
          socket.end()
          return
        }
        authed = true
        clearTimeout(deadline)
        continue
      }
      let request: BridgeRequest
      try {
        request = JSON.parse(line) as BridgeRequest
      } catch {
        continue
      }
      // `null`, a number, a list: valid JSON, but no request - reading `.method` off it threw in main.
      if (typeof request !== 'object' || request === null || Array.isArray(request)) continue
      if (request.method === 'ping') reply({ id: request.id, pong: { vault: currentVault()?.name ?? null, version: app.getVersion() } })
      else
        void callTool(
          request.tool,
          request.args,
          typeof request.client === 'string' ? request.client.slice(0, 40) : 'unknown',
          typeof request.session === 'string' ? request.session : undefined,
        ).then(
          (outcome) => reply({ id: request.id, outcome }),
          (err: unknown) => {
            console.error('[mcp socket]', err)
            reply({ id: request.id, outcome: { ok: false, error: 'Recto could not do that.' } })
          },
        )
    }
  }
}

export function startMcpSocket(userData = app.getPath('userData')): Promise<string> {
  const token = mcpToken(userData)
  const where = socketPath(userData)
  // A socket file left by a crashed Recto would refuse the listen. Only one Recto runs per user-data folder.
  fs.rmSync(where, { force: true })
  server = net.createServer((socket) => serve(socket, token))
  return new Promise((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(where, () => {
      fs.chmodSync(where, 0o600)
      resolve(where)
    })
  })
}

export function stopMcpSocket(): void {
  server?.close()
  server = null
}
