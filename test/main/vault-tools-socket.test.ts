import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { socketPath, TOKEN_FILE } from '../../src/mcp/bridge'

/**
 * The socket recto-mcp talks to: only this user can open it or read the
 * token, a connection without the right token gets nothing, and one with it
 * reaches the tool layer.
 */

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test', getPath: () => os.tmpdir() } }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: '/nowhere', name: 'Test vault' }) }))
vi.mock('../../src/main/vault-tools/index', () => ({
  callTool: async (tool: string, args: unknown, client: string) => ({ ok: true, blocks: [{ kind: 'data', data: { tool, args, client } }] }),
}))

const { startMcpSocket, stopMcpSocket } = await import('../../src/main/vault-tools/socket')

let dir = ''
let token = ''

/** Send lines, collect the reply lines until the server closes or `want` arrive. */
function talk(lines: string[], want: number): Promise<unknown[]> {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath(dir))
    const got: unknown[] = []
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(lines.map((l) => `${l}\n`).join('')))
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let at: number
      while ((at = buffer.indexOf('\n')) !== -1) {
        got.push(JSON.parse(buffer.slice(0, at)))
        buffer = buffer.slice(at + 1)
      }
      if (got.length >= want) socket.end()
    })
    socket.on('close', () => resolve(got))
  })
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-sock-'))
  await startMcpSocket(dir)
  token = fs.readFileSync(path.join(dir, TOKEN_FILE), 'utf8').trim()
})
afterAll(() => {
  stopMcpSocket()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('the MCP socket', () => {
  it('the token and the socket are this user’s only', () => {
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(fs.statSync(path.join(dir, TOKEN_FILE)).mode & 0o777).toBe(0o600)
    expect(fs.statSync(socketPath(dir)).mode & 0o777).toBe(0o600)
  })

  it('a wrong or missing token: refused, and no tool runs', async () => {
    expect(await talk([JSON.stringify({ token: 'nope' }), JSON.stringify({ id: 1, method: 'ping' })], 2)).toEqual([
      { id: 0, error: 'bad-token' },
    ])
    expect(await talk(['not json', JSON.stringify({ id: 1, method: 'ping' })], 2)).toEqual([{ id: 0, error: 'bad-token' }])
  })

  it('the right token: ping, then a call that reaches the tool layer', async () => {
    const replies = await talk(
      [
        JSON.stringify({ token }),
        JSON.stringify({ id: 1, method: 'ping' }),
        JSON.stringify({ id: 2, method: 'call', tool: 'list_tags', args: { limit: 3 }, client: 'codex' }),
      ],
      2,
    )
    expect(replies).toEqual([
      { id: 1, pong: { vault: 'Test vault', version: '0.0.0-test' } },
      { id: 2, outcome: { ok: true, blocks: [{ kind: 'data', data: { tool: 'list_tags', args: { limit: 3 }, client: 'codex' } }] } },
    ])
  })

  it('the token is made once and kept', async () => {
    stopMcpSocket()
    await startMcpSocket(dir)
    expect(fs.readFileSync(path.join(dir, TOKEN_FILE), 'utf8').trim()).toBe(token)
  })
})
