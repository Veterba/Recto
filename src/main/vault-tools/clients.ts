import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ClientId, ClientPlan, ClientStatus } from '../../shared/ai-access'

/**
 * Connecting AI clients to Recto: each one's config gets a `recto` entry that
 * runs the launcher (launcher.ts). Before anything is written the exact lines
 * are shown, the file is backed up, and only Recto's own entry is ever
 * added or removed - other servers' entries are left as they are.
 *
 * Everything takes `home`, so tests run on a temporary home folder.
 */

const run = promisify(execFile)

export type ClientEnv = { home: string; launcher: string; backups: string }

const NAMES: Record<ClientId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex CLI',
  'claude-desktop': 'Claude Desktop',
  cursor: 'Cursor',
}
const URLS: Record<ClientId, string> = {
  'claude-code': 'https://docs.anthropic.com/en/docs/claude-code',
  codex: 'https://github.com/openai/codex',
  'claude-desktop': 'https://claude.ai/download',
  cursor: 'https://cursor.com',
}
export const CLIENT_IDS: readonly ClientId[] = ['claude-code', 'codex', 'claude-desktop', 'cursor']

const files = (home: string): Record<ClientId, string> => ({
  'claude-code': path.join(home, '.claude.json'),
  codex: path.join(home, '.codex', 'config.toml'),
  'claude-desktop': path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
  cursor: path.join(home, '.cursor', 'mcp.json'),
})

/** A GUI app's PATH is minimal, so the CLIs are looked for where their installers put them. */
const binaryIn = (home: string, name: string): string | null =>
  [
    path.join(home, '.local', 'bin', name),
    path.join(home, '.claude', 'local', name),
    path.join(home, '.npm-global', 'bin', name),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ].find((p) => fs.existsSync(p)) ?? null

const exists = (p: string): boolean => fs.existsSync(p)

function installed(id: ClientId, home: string): boolean {
  if (id === 'claude-code') return binaryIn(home, 'claude') !== null
  if (id === 'codex') return exists(path.join(home, '.codex')) || binaryIn(home, 'codex') !== null
  if (id === 'claude-desktop')
    return (
      exists('/Applications/Claude.app') ||
      exists(path.join(home, 'Applications', 'Claude.app')) ||
      exists(path.dirname(files(home)['claude-desktop']))
    )
  return exists(path.join(home, '.cursor')) || exists('/Applications/Cursor.app')
}

const entryArgs = (id: ClientId): string[] => ['--client', id]

// ---------------------------------------------------------------------------
// JSON configs: Claude Desktop, Cursor - and reading Claude Code's

type JsonRead = { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string }

function readJson(file: string): JsonRead {
  if (!exists(file)) return { ok: true, value: null }
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: `${file} is not a JSON object.` }
    return { ok: true, value: value as Record<string, unknown> }
  } catch (err) {
    return {
      ok: false,
      error: `${file} is not valid JSON (${err instanceof Error ? err.message : String(err)}); Recto will not write to it.`,
    }
  }
}

const servers = (config: Record<string, unknown> | null): Record<string, unknown> => {
  const s = config?.['mcpServers']
  return s !== null && typeof s === 'object' && !Array.isArray(s) ? (s as Record<string, unknown>) : {}
}

/** An entry's command, or why it is no good. */
function entryState(entry: unknown, launcher: string): ClientStatus['state'] | 'missing' {
  if (entry === undefined) return 'missing'
  const command = (entry as { command?: unknown } | null)?.command
  return command === launcher && exists(launcher) ? 'connected' : 'broken'
}

// ---------------------------------------------------------------------------
// Codex: TOML, edited as text so comments and order survive

const CODEX_HEADER = /^\s*\[mcp_servers\.recto\]\s*$/

function codexBlock(launcher: string, id: ClientId): string {
  return [
    `[mcp_servers.recto]`,
    `command = ${JSON.stringify(launcher)}`,
    `args = ${JSON.stringify(entryArgs(id))}`,
    `startup_timeout_sec = 20`,
  ].join('\n')
}

/** The line range of Recto's table (with its own sub-tables), or null. */
function codexRange(lines: readonly string[]): { start: number; end: number } | null {
  const start = lines.findIndex((l) => CODEX_HEADER.test(l))
  if (start === -1) return null
  let end = start + 1
  while (end < lines.length && !(/^\s*\[/.test(lines[end]!) && !/^\s*\[mcp_servers\.recto\./.test(lines[end]!))) end++
  return { start, end }
}

function codexCommand(text: string): string | null {
  const lines = text.split('\n')
  const range = codexRange(lines)
  if (range === null) return null
  for (const line of lines.slice(range.start, range.end)) {
    const m = /^\s*command\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(line)
    if (m !== null) return JSON.parse(`"${m[1]}"`) as string
  }
  return ''
}

// ---------------------------------------------------------------------------

/** Claude Desktop extensions: an installed one has a folder named for it. Read only. */
function desktopExtension(home: string): string | null {
  const dir = path.join(home, 'Library', 'Application Support', 'Claude', 'Claude Extensions')
  try {
    return fs.readdirSync(dir).find((d) => /(^|[^a-z])recto([^a-z]|$)/i.test(d)) ?? null
  } catch {
    return null
  }
}

export function clientStatus(id: ClientId, env: ClientEnv): ClientStatus {
  const base = { id, name: NAMES[id], url: URLS[id], installed: installed(id, env.home) }
  const file = files(env.home)[id]
  if (id === 'codex') {
    const text = exists(file) ? fs.readFileSync(file, 'utf8') : ''
    const command = codexCommand(text)
    if (command === null) return { ...base, state: 'not-connected', detail: null }
    return command === env.launcher && exists(env.launcher)
      ? { ...base, state: 'connected', detail: file }
      : { ...base, state: 'broken', detail: `Its entry in ${file} runs ${command === '' ? 'nothing' : command}, not Recto’s launcher.` }
  }
  const read = readJson(file)
  if (!read.ok) return { ...base, state: 'broken', detail: read.error }
  const state = entryState(servers(read.value)['recto'], env.launcher)
  if (state === 'missing') {
    if (id === 'claude-desktop' && desktopExtension(env.home) !== null)
      return { ...base, state: 'connected', detail: 'As a Claude Desktop extension.' }
    return { ...base, state: 'not-connected', detail: null }
  }
  return state === 'connected'
    ? { ...base, state, detail: file }
    : { ...base, state, detail: `Its “recto” entry in ${file} does not run Recto’s launcher.` }
}

export const allStatuses = (env: ClientEnv): ClientStatus[] => CLIENT_IDS.map((id) => clientStatus(id, env))

const claudeArgs = (env: ClientEnv): string[] => [
  'mcp',
  'add',
  '--transport',
  'stdio',
  '--scope',
  'user',
  'recto',
  '--',
  env.launcher,
  ...entryArgs('claude-code'),
]

/** What Connect or Disconnect will do, as it will be done. */
export function clientPlan(id: ClientId, action: 'connect' | 'disconnect', env: ClientEnv): ClientPlan {
  const file = files(env.home)[id]
  const entry = { command: env.launcher, args: entryArgs(id) }
  if (id === 'claude-code') {
    const bin = binaryIn(env.home, 'claude')
    if (bin === null) return { ok: false, error: 'Claude Code’s claude command was not found.' }
    const args = action === 'connect' ? claudeArgs(env) : ['mcp', 'remove', 'recto', '--scope', 'user']
    return {
      ok: true,
      file,
      lines: `claude ${args.map((a) => (/[\s'"]/.test(a) ? JSON.stringify(a) : a)).join(' ')}`,
      note: `Recto runs this command; Claude Code writes the entry to ${file}.`,
    }
  }
  if (id === 'codex') {
    if (action === 'connect') return { ok: true, file, lines: codexBlock(env.launcher, id), note: `Added at the end of ${file}.` }
    const text = exists(file) ? fs.readFileSync(file, 'utf8') : ''
    const range = codexRange(text.split('\n'))
    if (range === null) return { ok: false, error: 'Codex has no Recto entry.' }
    return { ok: true, file, lines: text.split('\n').slice(range.start, range.end).join('\n').trimEnd(), note: `Removed from ${file}.` }
  }
  const read = readJson(file)
  if (!read.ok) return { ok: false, error: read.error }
  const restart = id === 'claude-desktop' ? 'Quit and reopen Claude Desktop for it to take effect.' : null
  if (action === 'connect') return { ok: true, file, lines: JSON.stringify({ mcpServers: { recto: entry } }, null, 2), note: restart }
  if (servers(read.value)['recto'] === undefined)
    return id === 'claude-desktop' && desktopExtension(env.home) !== null
      ? { ok: false, error: 'Recto is installed as a Claude Desktop extension: remove it in Claude Desktop → Settings → Extensions.' }
      : { ok: false, error: `${NAMES[id]} has no Recto entry.` }
  return { ok: true, file, lines: JSON.stringify({ mcpServers: { recto: servers(read.value)['recto'] } }, null, 2), note: restart }
}

function backup(file: string, env: ClientEnv): void {
  if (!exists(file)) return
  const dir = path.join(env.backups, new Date().toISOString().replace(/[:.]/g, '-'))
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(file, path.join(dir, path.basename(file)))
}

const writeJson = (file: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.recto-tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

export async function connectClient(id: ClientId, env: ClientEnv): Promise<{ ok: true } | { ok: false; error: string }> {
  const plan = clientPlan(id, 'connect', env)
  if (!plan.ok) return plan
  backup(plan.file, env)
  if (id === 'claude-code') {
    // An old or broken entry first: `mcp add` refuses a name that exists.
    if (clientStatus(id, env).state !== 'not-connected')
      await run(binaryIn(env.home, 'claude')!, ['mcp', 'remove', 'recto', '--scope', 'user']).catch(() => undefined)
    try {
      await run(binaryIn(env.home, 'claude')!, claudeArgs(env), { timeout: 30_000 })
    } catch (err) {
      return {
        ok: false,
        error: `claude mcp add failed: ${(err as { stderr?: string }).stderr?.trim() || (err instanceof Error ? err.message : String(err))}`,
      }
    }
    return { ok: true }
  }
  if (id === 'codex') {
    const text = exists(plan.file) ? fs.readFileSync(plan.file, 'utf8') : ''
    const lines = text.split('\n')
    const range = codexRange(lines)
    const rest = range === null ? lines : [...lines.slice(0, range.start), ...lines.slice(range.end)]
    const body = rest.join('\n').replace(/\n+$/, '')
    fs.mkdirSync(path.dirname(plan.file), { recursive: true })
    fs.writeFileSync(plan.file, `${body === '' ? '' : `${body}\n\n`}${codexBlock(env.launcher, id)}\n`)
    return { ok: true }
  }
  const read = readJson(plan.file)
  if (!read.ok) return read
  const config = read.value ?? {}
  writeJson(plan.file, { ...config, mcpServers: { ...servers(config), recto: { command: env.launcher, args: entryArgs(id) } } })
  return { ok: true }
}

export async function disconnectClient(id: ClientId, env: ClientEnv): Promise<{ ok: true } | { ok: false; error: string }> {
  const plan = clientPlan(id, 'disconnect', env)
  if (!plan.ok) return plan
  backup(plan.file, env)
  if (id === 'claude-code') {
    try {
      await run(binaryIn(env.home, 'claude')!, ['mcp', 'remove', 'recto', '--scope', 'user'], { timeout: 30_000 })
    } catch (err) {
      return {
        ok: false,
        error: `claude mcp remove failed: ${(err as { stderr?: string }).stderr?.trim() || (err instanceof Error ? err.message : String(err))}`,
      }
    }
    return { ok: true }
  }
  if (id === 'codex') {
    const lines = fs.readFileSync(plan.file, 'utf8').split('\n')
    const range = codexRange(lines)!
    const kept = [...lines.slice(0, range.start), ...lines.slice(range.end)]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\n+$/, '')
    fs.writeFileSync(plan.file, kept === '' ? '' : `${kept}\n`)
    return { ok: true }
  }
  const read = readJson(plan.file)
  if (!read.ok) return read
  const config = read.value ?? {}
  const { recto: _gone, ...others } = servers(config)
  writeJson(plan.file, { ...config, mcpServers: others })
  return { ok: true }
}
