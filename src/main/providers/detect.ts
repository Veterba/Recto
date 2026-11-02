import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Finding a CLI the way a terminal would.
 *
 * Recto started from Finder or the Dock does not get the shell's PATH: it has
 * /usr/bin:/bin and little else, so Homebrew, npm's global folder and nvm are
 * all missing and `which codex` from inside the app finds nothing even when
 * the terminal does. So a CLI is looked for in, in order: the login shell's
 * PATH (asked once), the app's own PATH, and the places installers put it -
 * including inside an app bundle (ChatGPT.app ships the Codex CLI).
 */

export type CliName = 'codex' | 'claude'

export type FindOptions = {
  home: string
  /** The app's own PATH. */
  envPath: string
  /** The login shell's PATH, or null when it could not be asked. */
  loginPath: string | null
  /** Prefixed to every absolute place below: tests put a fake `/opt/homebrew/bin` in a temp folder. */
  root?: string
}

/** Where installers put each CLI, besides the PATH. `~` is the home folder. */
const PLACES: Record<CliName, readonly string[]> = {
  codex: [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '~/.local/bin',
    '~/.npm-global/bin',
    '~/.bun/bin',
    '~/.volta/bin',
    '~/Library/pnpm',
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin',
    '/Applications/Codex.app/Contents/Resources/codex-cli/bin',
    '~/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin',
  ],
  claude: [
    '~/.claude/local',
    '~/.local/bin',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '~/.npm-global/bin',
    '~/.bun/bin',
    '~/.volta/bin',
    '~/Library/pnpm',
  ],
}

const executable = (file: string): boolean => {
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile()) return false
    fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Every nvm-installed Node's bin folder, newest first. */
function nvmBins(home: string): string[] {
  const root = path.join(home, '.nvm/versions/node')
  try {
    return fs
      .readdirSync(root)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((v) => path.join(root, v, 'bin'))
  } catch {
    return []
  }
}

/** The folders searched for `name`, in order, without duplicates. */
export function searchDirs(name: CliName, o: FindOptions): string[] {
  const root = o.root ?? ''
  const fromPath = (p: string | null): string[] => (p ?? '').split(':').filter((d) => d !== '')
  const places = PLACES[name].map((p) => (p.startsWith('~/') ? path.join(o.home, p.slice(2)) : `${root}${p}`))
  const dirs = [...fromPath(o.loginPath), ...fromPath(o.envPath), ...places, ...nvmBins(o.home)]
  return [...new Set(dirs)]
}

export function findCli(name: CliName, o: FindOptions): string | null {
  for (const dir of searchDirs(name, o)) {
    const file = path.join(dir, name)
    if (executable(file)) return file
  }
  return null
}

let loginPathCache: Promise<string | null> | null = null

/**
 * The PATH a login shell sets up, asked once per run: `$SHELL -lic` prints it
 * between markers, so a noisy profile (a greeting, a version manager's
 * message) cannot get mixed into it. Null after 5 s or on any failure.
 */
export function loginShellPath(shell = process.env['SHELL'] ?? '/bin/zsh'): Promise<string | null> {
  loginPathCache ??= new Promise((resolve) => {
    execFile(shell, ['-lic', 'printf "__RECTO_PATH__%s__RECTO_PATH__" "$PATH"'], { timeout: 5000 }, (err, stdout) => {
      const match = /__RECTO_PATH__(.*?)__RECTO_PATH__/s.exec(stdout ?? '')
      resolve(err !== null && match === null ? null : (match?.[1] ?? null))
    })
  })
  return loginPathCache
}

/** The PATH a CLI runs with: the login shell's, then the app's, so whatever it starts in turn is found too. */
export function runPath(loginPath: string | null, envPath: string): string {
  return [...new Set([...(loginPath ?? '').split(':'), ...envPath.split(':')].filter((d) => d !== ''))].join(':')
}
