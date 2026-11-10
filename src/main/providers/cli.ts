import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AiMessage } from '../../shared/ai'
import type { ProviderProblem } from '../../shared/providers'
import type { CliName } from './detect'
import { claudeLimits } from './limits'
import { Channel, ProviderError, toolsOf, type RunEvent, type Runner } from './run'

/**
 * Codex and Claude Code, run by Recto as agents whose only tools are Recto's.
 *
 * Each answer starts the CLI once, in an empty temp folder, with Recto's MCP
 * server as its one server and everything of its own that touches files or
 * runs commands switched off:
 *
 * - Claude Code: `--tools ""` (no built-in tools), only `mcp__recto` allowed,
 *   `--strict-mcp-config` (no other MCP servers), `dontAsk` (anything not
 *   allowed is refused, nothing waits for a prompt), no session kept.
 * - Codex: read-only sandbox, its shell and other built-in tools turned off,
 *   the person's config and rules not loaded, nothing kept (`--ephemeral`).
 *
 * The conversation goes in as text each time, so switching providers in the
 * middle of a topic needs nothing special. Recto's server gets this run's
 * session (`--session`), so what the CLI may see and change is decided by
 * Recto, call by call, the same as for every other provider.
 */

export type CliDeps = {
  /** The CLI's path, or null when it is not installed (detect.ts). */
  find: (name: CliName) => Promise<string | null>
  /** The PATH it runs with. */
  path: () => Promise<string>
  /** Recto's MCP launcher (vault-tools/launcher.ts). */
  launcher: () => string
}

export const INSTALL_URL: Record<CliName, string> = {
  codex: 'https://developers.openai.com/codex/cli',
  claude: 'https://code.claude.com/docs/en/setup',
}

const NAME: Record<CliName, string> = { codex: 'Codex', claude: 'Claude Code' }

/** Codex features that reach outside Recto's tools. */
const CODEX_OFF = ['shell_tool', 'unified_exec', 'view_image', 'apps', 'plugins', 'browser_use', 'computer_use', 'in_app_browser', 'hooks']

/** How long a stopped CLI gets to exit before it is killed. */
const KILL_AFTER_MS = 2000

/** The conversation as one prompt: earlier turns, then the question. */
export function transcript(messages: AiMessage[]): string {
  const last = messages.at(-1)
  const earlier = messages.slice(0, -1)
  if (earlier.length === 0) return last?.content ?? ''
  // A message that quotes the tags themselves (a note, an earlier answer) cannot open a turn or a record of its own.
  const inert = (text: string): string => text.replace(/<(\/?)(person|you)>/gi, '‹$1$2›')
  const turns = earlier.map((m) => `<${m.role === 'user' ? 'person' : 'you'}>\n${inert(m.content)}\n</${m.role === 'user' ? 'person' : 'you'}>`)
  return `The conversation so far:\n\n${turns.join('\n\n')}\n\nThe person now says:\n\n${last?.content ?? ''}`
}

const toml = (s: string): string => JSON.stringify(s)

/**
 * Where Claude Code finds its system prompt: a file in the run's own temp folder, not the command line.
 * The prompt holds the person's AI guide - their words - and a command line can be read by any process
 * (`ps`), and is capped in length.
 */
export const SYSTEM_FILE = 'recto-system.md'

/** The command line for one answer. */
export function cliArgs(
  name: CliName,
  o: { model: string; system: string; cwd: string; server: { command: string; args: string[] } },
): string[] {
  if (name === 'claude')
    return [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--strict-mcp-config',
      '--mcp-config',
      JSON.stringify({ mcpServers: { recto: { type: 'stdio', command: o.server.command, args: o.server.args } } }),
      '--tools',
      '',
      '--allowedTools',
      'mcp__recto',
      '--permission-mode',
      'dontAsk',
      '--no-session-persistence',
      // Only settings from the run's empty temp folder: not the person's own (~/.claude) hooks, plugins
      // and permissions, which would run their commands on Recto's answers. Sign-in is not a setting.
      '--setting-sources',
      'project,local',
      '--system-prompt-file',
      path.join(o.cwd, SYSTEM_FILE),
      ...(o.model === '' ? [] : ['--model', o.model]),
    ]
  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox',
    'read-only',
    '-C',
    o.cwd,
    '-c',
    'approval_policy="never"',
    '-c',
    `mcp_servers.recto.command=${toml(o.server.command)}`,
    '-c',
    `mcp_servers.recto.args=[${o.server.args.map(toml).join(', ')}]`,
    ...CODEX_OFF.flatMap((f) => ['--disable', f]),
    ...(o.model === '' ? [] : ['--model', o.model]),
    '-',
  ]
}

/** One line of a CLI's JSON output: text, a failure, the tokens used, the plan's limits. */
export function parseLine(name: CliName, line: string): { text?: string; error?: string; tokens?: number; limits?: unknown } {
  let event: Record<string, unknown>
  try {
    event = JSON.parse(line) as Record<string, unknown>
  } catch {
    return {}
  }
  if (name === 'claude') {
    if (event['type'] === 'stream_event') {
      const inner = event['event'] as { type?: string; delta?: { type?: string; text?: string } } | undefined
      if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta' && typeof inner.delta.text === 'string') return { text: inner.delta.text }
    }
    if (event['type'] === 'rate_limit_event') return { limits: event['rate_limit_info'] }
    if (event['type'] === 'result' && event['is_error'] === true)
      return { error: typeof event['result'] === 'string' && event['result'] !== '' ? event['result'] : String(event['subtype'] ?? 'failed') }
    if (event['type'] === 'result') return tokensOf(event['usage'])
    return {}
  }
  if (event['type'] === 'turn.completed') return tokensOf(event['usage'])
  // Codex: the answer arrives whole, as one agent message; tool calls are seen by Recto itself.
  const item = event['item'] as { type?: string; text?: string } | undefined
  if (event['type'] === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') return { text: item.text }
  if (event['type'] === 'turn.failed') return { error: String((event['error'] as { message?: string } | undefined)?.message ?? 'failed') }
  if (event['type'] === 'error') return { error: String(event['message'] ?? 'failed') }
  return {}
}

/** Input and output tokens from a CLI's usage object. */
function tokensOf(usage: unknown): { tokens?: number } {
  const u = (usage ?? {}) as { input_tokens?: unknown; output_tokens?: unknown }
  const n = (typeof u.input_tokens === 'number' ? u.input_tokens : 0) + (typeof u.output_tokens === 'number' ? u.output_tokens : 0)
  return n > 0 ? { tokens: n } : {}
}

/** What went wrong, from what the CLI said. */
export function problemFrom(name: CliName, text: string): ProviderProblem {
  const who = NAME[name]
  const said = text.trim().split('\n').filter((l) => l.trim() !== '').at(-1) ?? ''
  if (/not (logged|signed) in|log ?in required|please (log|sign) ?in|unauthori[sz]ed|\b401\b|invalid api key|authentication/i.test(text))
    return { kind: 'signed-out', message: `${who} is not signed in. Run \`${name === 'codex' ? 'codex login' : 'claude'}\` in a terminal and sign in.` }
  if (/usage limit|rate limit|quota|\b429\b|limit reached|too many requests/i.test(text))
    return { kind: 'limit', message: `${who} has reached its usage limit. ${said}`.trim() }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|\b50[234]\b|overloaded|unavailable/i.test(text))
    return { kind: 'down', message: `${who} could not reach its service. Try again in a moment.` }
  return { kind: 'failed', message: said === '' ? `${who} stopped without an answer.` : `${who}: ${said}` }
}

const authCache = new Map<string, { at: number; ok: boolean }>()

/** Signed in? `codex login status` / `claude auth status`, remembered for a minute. Spends nothing. */
export function signedIn(name: CliName, file: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const known = authCache.get(file)
  if (known !== undefined && Date.now() - known.at < 60_000) return Promise.resolve(known.ok)
  const args = name === 'codex' ? ['login', 'status'] : ['auth', 'status']
  return new Promise((resolve) =>
    execFile(file, args, { env, timeout: 10_000 }, (err, stdout, stderr) => {
      const said = `${stdout}${stderr}`
      const ok = err === null && !/not (logged|signed) in/i.test(said)
      authCache.set(file, { at: Date.now(), ok })
      resolve(ok)
    }),
  )
}

export const forgetAuth = (): void => authCache.clear()

export function cliRunner(name: CliName, deps: CliDeps): Runner {
  return (request) => {
    const channel = new Channel<RunEvent>()
    void (async () => {
      const file = await deps.find(name)
      if (file === null)
        throw new ProviderError({
          kind: 'cli-missing',
          message: `${NAME[name]} is not installed, or Recto cannot find it.`,
          url: INSTALL_URL[name],
        })
      const env = { ...process.env, PATH: await deps.path() }
      if (!(await signedIn(name, file, env))) throw new ProviderError(problemFrom(name, 'not logged in'))
      if (request.signal.aborted) return

      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-agent-'))
      const tools = toolsOf(request.session).map((t) => t.name)
      const server = {
        command: deps.launcher(),
        args: ['--client', `recto-${name}`, '--session', request.session.id, '--tools', tools.join(',')],
      }
      const model = request.model.includes(':') ? request.model.slice(request.model.indexOf(':') + 1) : ''
      const prompt = name === 'claude' ? transcript(request.messages) : `${request.system}\n\n---\n\n${transcript(request.messages)}`
      try {
        await new Promise<void>((resolve, reject) => {
          // This user's only (0600), in a folder of the run's own, gone when the run is.
          if (name === 'claude') fs.writeFileSync(path.join(cwd, SYSTEM_FILE), request.system, { mode: 0o600 })
          const child = spawn(file, cliArgs(name, { model, system: request.system, cwd, server }), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
          let stderr = ''
          let failure = ''
          let pending = ''
          const stop = (): void => {
            child.kill('SIGINT')
            setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), KILL_AFTER_MS).unref()
          }
          request.signal.addEventListener('abort', stop, { once: true })
          child.stdout.setEncoding('utf8')
          child.stdout.on('data', (chunk: string) => {
            pending += chunk
            let at = pending.indexOf('\n')
            while (at !== -1) {
              const parsed = parseLine(name, pending.slice(0, at).trim())
              pending = pending.slice(at + 1)
              at = pending.indexOf('\n')
              if (parsed.text !== undefined) channel.push({ type: 'text', text: parsed.text })
              if (parsed.tokens !== undefined) channel.push({ type: 'usage', tokens: parsed.tokens })
              if (parsed.limits !== undefined) {
                const limits = claudeLimits(parsed.limits)
                if (limits !== null) channel.push({ type: 'limits', limits })
              }
              if (parsed.error !== undefined) failure = parsed.error
            }
          })
          child.stderr.setEncoding('utf8')
          child.stderr.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-4000)))
          child.on('error', (err) => reject(new ProviderError({ kind: 'cli-missing', message: `${NAME[name]} could not start: ${err.message}`, url: INSTALL_URL[name] })))
          child.on('close', (code) => {
            request.signal.removeEventListener('abort', stop)
            if (request.signal.aborted) resolve()
            else if (failure !== '' || code !== 0) reject(new ProviderError(problemFrom(name, `${failure}\n${stderr}`)))
            else resolve()
          })
          // A CLI that exits before it has read the whole prompt (a flag it no longer knows, a sign-in gone) closes the
          // pipe under a long write: EPIPE on stdin, unhandled, was an uncaught exception in main. The exit says why.
          child.stdin.on('error', () => undefined)
          child.stdin.end(prompt)
        })
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true })
      }
    })().then(
      () => channel.end(),
      (err: unknown) => channel.end(err),
    )
    return channel
  }
}
