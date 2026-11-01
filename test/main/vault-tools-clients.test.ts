import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clientPlan, clientStatus, connectClient, disconnectClient, type ClientEnv } from '../../src/main/vault-tools/clients'

/**
 * Connecting AI clients, on a temporary home folder: Recto's entry is
 * written, backed up first, found again, and removed - and every other
 * server's entry, comment and setting in the file is left exactly as it was.
 * A file that does not parse is never written.
 */

let home = ''
let env: ClientEnv
const file = (rel: string): string => path.join(home, rel)
const put = (rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(file(rel)), { recursive: true })
  fs.writeFileSync(file(rel), text)
}
const read = (rel: string): string => fs.readFileSync(file(rel), 'utf8')
const backups = (): string[] =>
  fs.existsSync(env.backups) ? fs.readdirSync(env.backups).flatMap((d) => fs.readdirSync(path.join(env.backups, d))) : []

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-clients-'))
  env = { home, launcher: file('Recto/bin/recto-mcp'), backups: file('Recto/backup/clients') }
  put('Recto/bin/recto-mcp', '#!/bin/sh\n')
})
afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

describe('Cursor (and Claude Desktop’s config file): JSON', () => {
  const CURSOR = '.cursor/mcp.json'

  it('adds only Recto’s entry, backs the file up, and Disconnect removes only it', async () => {
    const original = { mcpServers: { other: { command: 'other-server', args: ['x'] } }, theme: 'dark' }
    put(CURSOR, JSON.stringify(original))
    expect(clientStatus('cursor', env)).toMatchObject({ installed: true, state: 'not-connected' })

    const plan = clientPlan('cursor', 'connect', env)
    expect(plan).toMatchObject({ ok: true, file: file(CURSOR) })
    expect(plan.ok && plan.lines).toContain(env.launcher)

    expect(await connectClient('cursor', env)).toEqual({ ok: true })
    const written = JSON.parse(read(CURSOR)) as typeof original & { mcpServers: Record<string, unknown> }
    expect(written.mcpServers['other']).toEqual(original.mcpServers.other)
    expect(written.theme).toBe('dark')
    expect(written.mcpServers['recto']).toEqual({ command: env.launcher, args: ['--client', 'cursor'] })
    expect(backups()).toEqual(['mcp.json'])
    expect(clientStatus('cursor', env).state).toBe('connected')

    expect(await disconnectClient('cursor', env)).toEqual({ ok: true })
    expect(JSON.parse(read(CURSOR))).toEqual(original)
  })

  it('an entry that runs something else is “Broken config”; a file that does not parse is never written', async () => {
    put(CURSOR, JSON.stringify({ mcpServers: { recto: { command: '/old/place/recto-mcp' } } }))
    expect(clientStatus('cursor', env).state).toBe('broken')
    expect(await connectClient('cursor', env)).toEqual({ ok: true })
    expect(clientStatus('cursor', env).state).toBe('connected')

    put(CURSOR, '{ "mcpServers": { oops ')
    expect(clientStatus('cursor', env).state).toBe('broken')
    expect(await connectClient('cursor', env)).toMatchObject({ ok: false })
    expect(read(CURSOR)).toBe('{ "mcpServers": { oops ')
  })

  it('Claude Desktop: a missing config file is made, and the plan says to restart Desktop', async () => {
    fs.mkdirSync(file('Library/Application Support/Claude'), { recursive: true })
    const plan = clientPlan('claude-desktop', 'connect', env)
    expect(plan.ok && plan.note).toMatch(/Quit and reopen Claude Desktop/)
    expect(await connectClient('claude-desktop', env)).toEqual({ ok: true })
    expect(clientStatus('claude-desktop', env).state).toBe('connected')
  })
})

describe('Codex: TOML, edited as text', () => {
  const CODEX = '.codex/config.toml'
  const ORIGINAL = '# my settings\nmodel = "o5"\n\n[mcp_servers.other]\ncommand = "other"\n# keep me\n'

  it('appends Recto’s table, and removing it gives the file back byte for byte', async () => {
    put(CODEX, ORIGINAL)
    expect(await connectClient('codex', env)).toEqual({ ok: true })
    expect(read(CODEX)).toBe(
      `${ORIGINAL}\n[mcp_servers.recto]\ncommand = ${JSON.stringify(env.launcher)}\nargs = ["--client","codex"]\nstartup_timeout_sec = 20\n`,
    )
    expect(clientStatus('codex', env).state).toBe('connected')
    expect(backups()).toEqual(['config.toml'])

    expect(await disconnectClient('codex', env)).toEqual({ ok: true })
    expect(read(CODEX)).toBe(ORIGINAL)
  })

  it('Recto’s table between others: only it goes', async () => {
    put(CODEX, `[mcp_servers.recto]\ncommand = "/old"\n\n[mcp_servers.recto.env]\nX = "1"\n\n[mcp_servers.other]\ncommand = "other"\n`)
    expect(clientStatus('codex', env)).toMatchObject({ state: 'broken' })
    expect(await disconnectClient('codex', env)).toEqual({ ok: true })
    expect(read(CODEX)).toBe('[mcp_servers.other]\ncommand = "other"\n')
  })
})

describe('Claude Code: through its own CLI', () => {
  it('runs claude mcp add / remove with user scope', async () => {
    // A stand-in `claude` that records its arguments and writes the entry the way the real one does.
    const log = file('claude-args.txt')
    put(
      '.local/bin/claude',
      `#!/bin/sh\necho "$@" >> '${log}'\ncase "$2" in\n  add) printf '{"mcpServers":{"recto":{"type":"stdio","command":"%s","args":["--client","claude-code"]}}}' "${env.launcher}" > '${file('.claude.json')}' ;;\n  remove) printf '{"mcpServers":{}}' > '${file('.claude.json')}' ;;\nesac\n`,
    )
    fs.chmodSync(file('.local/bin/claude'), 0o755)
    expect(clientStatus('claude-code', env)).toMatchObject({ installed: true, state: 'not-connected' })
    expect(await connectClient('claude-code', env)).toEqual({ ok: true })
    expect(read('claude-args.txt')).toBe(`mcp add --transport stdio --scope user recto -- ${env.launcher} --client claude-code\n`)
    expect(clientStatus('claude-code', env).state).toBe('connected')
    expect(await disconnectClient('claude-code', env)).toEqual({ ok: true })
    expect(read('claude-args.txt')).toMatch(/mcp remove recto --scope user\n$/)
    expect(clientStatus('claude-code', env).state).toBe('not-connected')
  })

  it('not installed: said, with nothing to run', () => {
    expect(clientStatus('claude-code', env).installed).toBe(
      fs.existsSync('/opt/homebrew/bin/claude') || fs.existsSync('/usr/local/bin/claude'),
    )
  })
})
