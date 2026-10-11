import { type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import type { ElectronApplication } from 'playwright'

/**
 * Starting and stopping the app in e2e tests, so one test file's app never
 * outlives it.
 *
 * Two things made the full run flaky:
 * - `node_modules/.bin/electron` is a node wrapper that starts the real
 *   Electron as its child. Killing the wrapper left the app running - once 24
 *   of them - still writing into the test's vault while it was deleted
 *   (ENOTEMPTY in .recto/bots) and still holding its debugging port.
 * - The port was picked at random from 400, so a later file could connect to
 *   an old app that was never stopped, and its setup failed.
 * So: the real binary, in its own process group, stopped as a group and
 * waited for; a port the OS says is free; and deleting retries while the last
 * writes land.
 */

const ROOT = path.resolve(__dirname, '../../..')

/** The Electron binary itself, not the node wrapper in node_modules/.bin. */
export const ELECTRON = createRequire(path.join(ROOT, 'package.json'))('electron') as string

/** A TCP port nothing is listening on right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })
}

const exited = (child: ChildProcess): boolean => child.exitCode !== null || child.signalCode !== null

function waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
  if (exited(child)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(exited(child)), ms)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

/** Signal a process's whole group (it was spawned `detached`), or just it. */
function signal(child: ChildProcess, sig: NodeJS.Signals): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, sig)
  } catch {
    try {
      child.kill(sig)
    } catch {
      // Already gone.
    }
  }
}

/** Stop an app spawned with `detached: true`: asked to quit, then killed, and waited for. */
export async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined) return
  if (!exited(child)) {
    signal(child, 'SIGTERM')
    if (!(await waitForExit(child, 8000))) {
      signal(child, 'SIGKILL')
      await waitForExit(child, 5000)
    }
  }
  // Its helpers (renderer, GPU, the indexer) share the group: make sure none is left.
  signal(child, 'SIGKILL')
}

/** Stop an app started with Playwright's `_electron.launch`, and wait until it is gone. */
export async function quitApp(app: ElectronApplication | undefined): Promise<void> {
  if (app === undefined) return
  const child = app.process()
  await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))])
  if (!exited(child)) {
    child.kill('SIGKILL')
    await waitForExit(child, 5000)
  }
}

/** Delete a test folder, retrying while the last writes of a stopped app land. */
export function removeDir(dir: string): void {
  if (dir === '') return
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
