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

/** `dev`: a development build, whose launcher must never end up in the person's real AI apps. */
/** `version`: this Recto's, which an installed Claude Desktop extension must match - it carries its own copy of the program. */
/** `claudeConfigDir`, `codexHome`: where the person moved those apps' settings (CLAUDE_CONFIG_DIR, CODEX_HOME). */
export type ClientEnv = { home: string; launcher: string; backups: string; dev?: boolean; version?: string; claudeConfigDir?: string; codexHome?: string }

const DEV_REFUSED = 'A development build of Recto does not change your AI apps’ settings: it would point them at this build. Connect from the installed Recto.'

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

/** Each app's settings file - where the app itself looks, its own folder variable followed. */
const files = (env: Pick<ClientEnv, 'home' | 'claudeConfigDir' | 'codexHome'>): Record<ClientId, string> => ({
  'claude-code': path.join(env.claudeConfigDir ?? env.home, '.claude.json'),
  codex: path.join(env.codexHome ?? path.join(env.home, '.codex'), 'config.toml'),
  'claude-desktop': path.join(env.home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
  cursor: path.join(env.home, '.cursor', 'mcp.json'),
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

function installed(id: ClientId, env: ClientEnv): boolean {
  const home = env.home
  if (id === 'claude-code') return binaryIn(home, 'claude') !== null
  if (id === 'codex') return exists(path.dirname(files(env).codex)) || binaryIn(home, 'codex') !== null
  if (id === 'claude-desktop')
    return (
      exists('/Applications/Claude.app') ||
      exists(path.join(home, 'Applications', 'Claude.app')) ||
      exists(path.dirname(files(env)['claude-desktop']))
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

/** Recto's table however it is written - `[mcp_servers.recto]`, `[ mcp_servers."recto" ]` - and its sub-tables. */
const RECTO_KEY = `\\s*mcp_servers\\s*\\.\\s*(?:recto|"recto"|'recto')\\s*`
const CODEX_HEADER = new RegExp(`^\\s*\\[${RECTO_KEY}\\]\\s*(?:#.*)?$`)
const CODEX_SUB = new RegExp(`^\\s*\\[${RECTO_KEY}\\.`)

function codexBlock(launcher: string, id: ClientId): string {
  return [
    `[mcp_servers.recto]`,
    `command = ${JSON.stringify(launcher)}`,
    `args = ${JSON.stringify(entryArgs(id))}`,
    `startup_timeout_sec = 20`,
    // Longer than Recto's own limit on a call, so Codex does not give up on one Recto is still finishing.
    `tool_timeout_sec = 90`,
  ].join('\n')
}

/** The line ranges of Recto's tables (each with its own sub-tables), in order: a hand-edited file may hold two. */
function codexRanges(lines: readonly string[]): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = []
  for (let start = 0; start < lines.length; start++) {
    if (!CODEX_HEADER.test(lines[start]!)) continue
    let end = start + 1
    while (end < lines.length && !(/^\s*\[/.test(lines[end]!) && !CODEX_SUB.test(lines[end]!))) end++
    ranges.push({ start, end })
    start = end - 1
  }
  return ranges
}
const codexRange = (lines: readonly string[]): { start: number; end: number } | null => codexRanges(lines)[0] ?? null

/** Every one of Recto's tables taken out, the blank lines where each was joined. */
function withoutRecto(lines: readonly string[]): string {
  let out = [...lines]
  for (const range of codexRanges(out).reverse()) {
    const before = out.slice(0, range.start)
    const after = out.slice(range.end)
    // Only the blank lines where Recto's table was are joined: elsewhere - inside a multi-line string - they are the person's.
    while (before.at(-1) === '' && (after.length === 0 || after[0] === '')) before.pop()
    out = [...before, ...after]
  }
  return out.join('\n').replace(/\n+$/, '')
}

/** The command of a "recto" server that is not Recto's own launcher (the person's), or null when there is none. */
function ownRecto(id: ClientId, file: string, launcher: string): string | null {
  if (id === 'codex') {
    const command = exists(file) ? codexCommand(fs.readFileSync(file, 'utf8')) : null
    return command === null || command === launcher ? null : command
  }
  const read = readJson(file)
  const entry = read.ok ? servers(read.value)['recto'] : undefined
  if (entry === undefined) return null
  const command = (entry as { command?: unknown } | null)?.command
  return command === launcher ? null : typeof command === 'string' ? command : ''
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

/** The Recto version an installed extension was built by, from its manifest; null when it cannot be read. */
function extensionVersion(home: string, folder: string): string | null {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(home, 'Library', 'Application Support', 'Claude', 'Claude Extensions', folder, 'manifest.json'), 'utf8'),
    ) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    return null
  }
}

export function clientStatus(id: ClientId, env: ClientEnv): ClientStatus {
  const base = { id, name: NAMES[id], url: URLS[id], installed: installed(id, env) }
  const file = files(env)[id]
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
    const extension = id === 'claude-desktop' ? desktopExtension(env.home) : null
    if (extension !== null) {
      const built = extensionVersion(env.home, extension)
      // Made by an older Recto, it runs that Recto's program against this one: said, with the way to fix it.
      if (env.version !== undefined && built !== null && built !== env.version)
        return { ...base, state: 'broken', detail: `The Claude Desktop extension is from Recto ${built}. Install it again from here (Install extension).` }
      return { ...base, state: 'connected', detail: 'As a Claude Desktop extension.' }
    }
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
  const file = files(env)[id]
  // A "recto" server there now that is not Recto's (the person's own, by that name): said before it is replaced.
  const theirs = action === 'connect' ? ownRecto(id, file, env.launcher) : null
  const replacing = theirs === null ? '' : ` It replaces the “recto” server there now, which runs ${theirs === '' ? 'nothing' : theirs}.`
  const entry = { command: env.launcher, args: entryArgs(id) }
  if (id === 'claude-code') {
    const bin = binaryIn(env.home, 'claude')
    if (bin === null) return { ok: false, error: 'Claude Code’s claude command was not found.' }
    const args = action === 'connect' ? claudeArgs(env) : ['mcp', 'remove', 'recto', '--scope', 'user']
    return {
      ok: true,
      file,
      lines: `claude ${args.map((a) => (/[\s'"]/.test(a) ? JSON.stringify(a) : a)).join(' ')}`,
      note: `Recto runs this command; Claude Code writes the entry to ${file}.${replacing}`,
    }
  }
  if (id === 'codex') {
    if (action === 'connect') return { ok: true, file, lines: codexBlock(env.launcher, id), note: `Added at the end of ${file}.${replacing}` }
    const text = exists(file) ? fs.readFileSync(file, 'utf8') : ''
    const range = codexRange(text.split('\n'))
    if (range === null) return { ok: false, error: 'Codex has no Recto entry.' }
    return { ok: true, file, lines: text.split('\n').slice(range.start, range.end).join('\n').trimEnd(), note: `Removed from ${file}.` }
  }
  const read = readJson(file)
  if (!read.ok) return { ok: false, error: read.error }
  const restart = id === 'claude-desktop' ? 'Quit and reopen Claude Desktop for it to take effect.' : null
  if (action === 'connect')
    return { ok: true, file, lines: JSON.stringify({ mcpServers: { recto: entry } }, null, 2), note: replacing === '' ? restart : `${replacing.trim()}${restart === null ? '' : ` ${restart}`}` }
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

/**
 * A client's config, written whole or not at all: through a temporary file
 * beside the real one, renamed over it. A config that is a symlink (kept in
 * a dotfiles folder) stays one - the file it points at is what changes - and
 * its permissions stay as they were.
 */
function writeText(file: string, text: string): void {
  const real = exists(file) ? fs.realpathSync(file) : file
  const mode = exists(real) ? fs.statSync(real).mode & 0o777 : 0o644
  fs.mkdirSync(path.dirname(real), { recursive: true })
  const tmp = `${real}.recto-tmp`
  fs.writeFileSync(tmp, text, { mode })
  fs.chmodSync(tmp, mode)
  fs.renameSync(tmp, real)
}

const writeJson = (file: string, value: unknown): void => writeText(file, `${JSON.stringify(value, null, 2)}\n`)

export async function connectClient(id: ClientId, env: ClientEnv): Promise<{ ok: true } | { ok: false; error: string }> {
  if (env.dev === true) return { ok: false, error: DEV_REFUSED }
  const plan = clientPlan(id, 'connect', env)
  if (!plan.ok) return plan
  backup(plan.file, env)
  if (id === 'claude-code') {
    const claude = binaryIn(env.home, 'claude')!
    // An old or broken entry first: `mcp add` refuses a name that exists. Kept, to be put back if the add fails.
    const old = (() => {
      const read = readJson(plan.file)
      return read.ok ? servers(read.value)['recto'] : undefined
    })()
    if (old !== undefined) await run(claude, ['mcp', 'remove', 'recto', '--scope', 'user']).catch(() => undefined)
    try {
      await run(claude, claudeArgs(env), { timeout: 30_000 })
    } catch (err) {
      if (old !== undefined)
        await run(claude, ['mcp', 'add-json', 'recto', JSON.stringify(old), '--scope', 'user'], { timeout: 30_000 }).catch(() => undefined)
      return {
        ok: false,
        error: `claude mcp add failed: ${(err as { stderr?: string }).stderr?.trim() || (err instanceof Error ? err.message : String(err))}`,
      }
    }
    return { ok: true }
  }
  if (id === 'codex') {
    const text = exists(plan.file) ? fs.readFileSync(plan.file, 'utf8') : ''
    // Every table of Recto's out first, however written: a second would make Codex refuse the file.
    const body = withoutRecto(text.split('\n'))
    writeText(plan.file, `${body === '' ? '' : `${body}\n\n`}${codexBlock(env.launcher, id)}\n`)
    return { ok: true }
  }
  const read = readJson(plan.file)
  if (!read.ok) return read
  const config = read.value ?? {}
  writeJson(plan.file, { ...config, mcpServers: { ...servers(config), recto: { command: env.launcher, args: entryArgs(id) } } })
  return { ok: true }
}

export async function disconnectClient(id: ClientId, env: ClientEnv): Promise<{ ok: true } | { ok: false; error: string }> {
  if (env.dev === true) return { ok: false, error: DEV_REFUSED }
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
    const kept = withoutRecto(fs.readFileSync(plan.file, 'utf8').split('\n'))
    writeText(plan.file, kept === '' ? '' : `${kept}\n`)
    return { ok: true }
  }
  const read = readJson(plan.file)
  if (!read.ok) return read
  const config = read.value ?? {}
  const { recto: _gone, ...others } = servers(config)
  writeJson(plan.file, { ...config, mcpServers: others })
  return { ok: true }
}
