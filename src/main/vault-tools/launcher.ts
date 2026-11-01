import { app } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { VAULT_TOOLS } from '../../shared/vault-tools'

/**
 * The stable command AI clients are configured with:
 * `<user data>/bin/recto-mcp`, a shell script rewritten on every start with
 * this Recto's absolute paths. Updating Recto or moving Recto.app changes the
 * script, never the clients' configs.
 *
 * It runs `out/mcp/recto-mcp.mjs` on Recto's own Electron binary as Node, so
 * no separate Node install is needed. In a packaged app the program sits
 * unpacked beside app.asar (electron-builder.yml), where any Node can read it.
 */

const run = promisify(execFile)

/** A shell word that means exactly `value`. */
const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

export const programPath = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'out', 'mcp', 'recto-mcp.mjs')
    : path.join(app.getAppPath(), 'out', 'mcp', 'recto-mcp.mjs')

export const launcherPath = (userData = app.getPath('userData')): string => path.join(userData, 'bin', 'recto-mcp')

export function launcherText(execPath: string, program: string, userData: string): string {
  return [
    '#!/bin/sh',
    '# Written by Recto on every start: runs Recto’s MCP server on Recto’s own runtime.',
    '# AI clients run this file; edits to it are overwritten.',
    `ELECTRON_RUN_AS_NODE=1 exec ${quote(execPath)} ${quote(program)} --data ${quote(userData)} "$@"`,
    '',
  ].join('\n')
}

export function writeLauncher(userData = app.getPath('userData')): string {
  const target = launcherPath(userData)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const text = launcherText(process.execPath, programPath(), userData)
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null
  if (current !== text) fs.writeFileSync(target, text, { mode: 0o755 })
  fs.chmodSync(target, 0o755)
  return target
}

/**
 * A Claude Desktop extension (.mcpb): the same program, run by Desktop's own
 * Node, told where Recto's user data is. Rebuilt each time it is asked for,
 * so it always carries this Recto's program.
 */
export async function buildMcpb(userData = app.getPath('userData')): Promise<string> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-mcpb-'))
  try {
    fs.mkdirSync(path.join(work, 'server'))
    fs.copyFileSync(programPath(), path.join(work, 'server', 'recto-mcp.mjs'))
    const manifest = {
      manifest_version: '0.3',
      name: 'recto',
      display_name: 'Recto',
      version: app.getVersion(),
      description: 'Your Recto vault: search and read notes, and suggest edits you review in Recto. Recto must be open.',
      author: { name: 'Recto' },
      server: {
        type: 'node',
        entry_point: 'server/recto-mcp.mjs',
        mcp_config: { command: 'node', args: ['${__dirname}/server/recto-mcp.mjs', '--data', userData, '--client', 'claude-desktop'] },
      },
      tools: VAULT_TOOLS.map((t) => ({ name: t.name, description: t.description })),
      compatibility: { platforms: ['darwin'] },
    }
    fs.writeFileSync(path.join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    const out = path.join(userData, 'bin', 'Recto.mcpb')
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.rmSync(out, { force: true })
    await run('/usr/bin/zip', ['-q', '-r', '-X', out, 'manifest.json', 'server'], { cwd: work })
    return out
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

/** Settings → AI → Test connection: the launcher itself, pinging Recto over the socket with the token. */
export async function selfTest(userData = app.getPath('userData')): Promise<{ ok: boolean; message: string }> {
  try {
    const { stdout } = await run(launcherPath(userData), ['--self-test'], { timeout: 15_000 })
    const result = JSON.parse(stdout.trim()) as { ok: boolean; vault?: string | null; error?: string }
    return result.ok
      ? { ok: true, message: `Connected${result.vault ? ` to “${result.vault}”` : ' (no vault open)'}.` }
      : { ok: false, message: result.error ?? 'No answer.' }
  } catch (err) {
    const out = (err as { stdout?: string }).stdout
    try {
      const parsed = JSON.parse(String(out).trim()) as { error?: string }
      return { ok: false, message: parsed.error ?? 'The test failed.' }
    } catch {
      return { ok: false, message: `The launcher did not run: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
}
