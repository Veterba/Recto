import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Open a note, move the cursor, close the tab: the file must not be written.
 * Not its bytes, not its mtime - the mtime is what sync compares and what the
 * auto-links quiet period counts from.
 *
 * Drives the real app over the DevTools protocol, against the built output,
 * so it runs only with `npm run test:e2e` (which builds first).
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const ELECTRON = path.join(ROOT, 'node_modules/.bin/electron')
const PORT = 9420 + Math.floor(Math.random() * 400)
const OLD = new Date('2026-01-01T00:00:00Z')

/** The shape of the note that was once rewritten: frontmatter, Cyrillic, a list, no newline at the end. */
const NOTE = '---\ntags: []\nlinks:\n---\n# Слепой набор\n- https://monkeytype.com - тренажёр на скорость\n- https://rata-type.com - тренажёр для рук'

type Cdp = { call: (method: string, params?: object) => Promise<{ result?: { result?: { value?: unknown } } }>; close: () => void }

async function connect(): Promise<Cdp> {
  let targets: { type: string; webSocketDebuggerUrl: string }[] = []
  for (let i = 0; i < 60 && targets.length === 0; i++) {
    try {
      targets = ((await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()) as typeof targets).filter((t) => t.type === 'page')
    } catch {
      await sleep(500)
    }
  }
  const ws = new WebSocket(targets[0]!.webSocketDebuggerUrl)
  await new Promise((resolve) => (ws.onopen = resolve))
  let id = 0
  const pending = new Map<number, (value: never) => void>()
  ws.onmessage = (m) => {
    const data = JSON.parse(String(m.data)) as { id?: number }
    if (data.id !== undefined) pending.get(data.id)?.(data as never)
  }
  return {
    call: (method, params = {}) =>
      new Promise((resolve) => {
        const n = ++id
        pending.set(n, resolve)
        ws.send(JSON.stringify({ id: n, method, params }))
      }),
    close: () => ws.close(),
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!RUN)('closing a note it did not change', () => {
  let app: ChildProcess
  let vault = ''
  let userData = ''
  let cdp: Cdp
  const snapshot = (): Record<string, [string, number]> => {
    const out: Record<string, [string, number]> = {}
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else out[path.relative(vault, p)] = [fs.readFileSync(p, 'utf8'), fs.statSync(p).mtimeMs]
      }
    }
    walk(vault)
    return out
  }
  const evaluate = async (expression: string): Promise<unknown> =>
    (await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value

  beforeAll(async () => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-vault-'))
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-data-'))
    fs.mkdirSync(path.join(vault, 'Notes'))
    fs.writeFileSync(path.join(vault, 'Notes', 'Слепой набор.md'), NOTE)
    fs.writeFileSync(path.join(vault, 'Other.md'), '# Other\n\nSomething else.')
    for (const f of ['Notes/Слепой набор.md', 'Other.md']) fs.utimesSync(path.join(vault, f), OLD, OLD)
    fs.writeFileSync(path.join(userData, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    // Auto-links off: this is about the editor alone.
    fs.mkdirSync(path.join(vault, '.recto'))
    fs.writeFileSync(path.join(vault, '.recto', 'autolinks-settings.json'), JSON.stringify({ mode: 'off' }))
    app = spawn(ELECTRON, [ROOT, `--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`], { stdio: 'ignore' })
    cdp = await connect()
    await sleep(2500)
  }, 60_000)

  afterAll(() => {
    cdp?.close()
    app?.kill()
    fs.rmSync(vault, { recursive: true, force: true })
    fs.rmSync(userData, { recursive: true, force: true })
  })

  it('leaves the bytes and the mtime of every note alone', async () => {
    const before = snapshot()

    // Open it with the quick switcher, as a person would.
    await cdp.call('Page.bringToFront')
    for (const type of ['keyDown', 'keyUp']) await cdp.call('Input.dispatchKeyEvent', { type, modifiers: 4, key: 'o', code: 'KeyO', windowsVirtualKeyCode: 79 })
    await sleep(300)
    await cdp.call('Input.insertText', { text: 'Слепой набор' })
    await sleep(300)
    for (const type of ['keyDown', 'keyUp']) await cdp.call('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(1000)
    expect(await evaluate("document.querySelector('.md__path')?.textContent")).toBe('Notes/Слепой набор.md')

    // Click into the text and walk the cursor to the end of the last line.
    const [x, y] = (await evaluate(
      "(() => { const r = document.querySelector('.cm-content').getBoundingClientRect(); return [r.x + 40, r.y + 20] })()",
    )) as [number, number]
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
    for (let i = 0; i < 8; i++) {
      for (const type of ['keyDown', 'keyUp']) await cdp.call('Input.dispatchKeyEvent', { type, key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
    }
    for (const type of ['keyDown', 'keyUp']) await cdp.call('Input.dispatchKeyEvent', { type, key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
    await sleep(1200)

    // Close the tab.
    expect(await evaluate("(() => { const b = document.querySelector('button[aria-label=\"Close Слепой набор\"]'); b?.click(); return b !== null })()")).toBe(true)
    await sleep(1500)

    expect(snapshot()).toEqual(before)
  }, 60_000)
})
