import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Renaming from the file tree, driven like a person would.
 *
 * Regression: a note renamed without typing ".md" stopped being a note - it
 * left the notes, and an extension-less file appeared in its place. Runs with
 * `npm run test:e2e`.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const ELECTRON = path.join(ROOT, 'node_modules/.bin/electron')
const PORT = 9420 + Math.floor(Math.random() * 400)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

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

describe.skipIf(!RUN)('renaming from the file tree', () => {
  let app: ChildProcess
  let vault = ''
  let userData = ''
  let cdp: Cdp
  const evaluate = async (expression: string): Promise<unknown> =>
    (await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
  const rowAt = (label: string): Promise<[number, number] | null> =>
    evaluate(
      `(() => { const el = [...document.querySelectorAll('[role=treeitem]')].find((e) => e.querySelector('.tree__name')?.textContent === ${JSON.stringify(label)}); if (!el) return null; const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`,
    ) as Promise<[number, number] | null>
  const doubleClick = async ([x, y]: [number, number]): Promise<void> => {
    for (const clickCount of [1, 2]) {
      for (const type of ['mousePressed', 'mouseReleased'])
        await cdp.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount })
      // Long enough for the folder to open and the rows below it to move.
      await sleep(120)
    }
    await sleep(400)
  }
  const dialogPath = (): Promise<unknown> => evaluate("document.querySelector('.dialog__path')?.textContent ?? null")
  const typeAndEnter = async (text: string): Promise<void> => {
    await evaluate("(() => { const i = document.querySelector('.dialog__input'); i.focus(); i.select(); return 1 })()")
    await cdp.call('Input.insertText', { text })
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(1200)
  }

  beforeAll(async () => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-rename-'))
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-data-'))
    // A folder with notes in it, and notes right below it at the same level.
    fs.mkdirSync(path.join(vault, 'Sources', 'summary'), { recursive: true })
    for (let i = 1; i <= 6; i++) fs.writeFileSync(path.join(vault, 'Sources', 'summary', `0${i}-part.md`), `# Part ${i}\n`)
    fs.writeFileSync(path.join(vault, 'Sources', 'index.md'), '# Index\n\nThe sources.\n')
    fs.writeFileSync(path.join(vault, 'Sources', 'notes.md'), '# Notes\n')
    fs.writeFileSync(path.join(userData, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    fs.mkdirSync(path.join(vault, '.recto'))
    fs.writeFileSync(path.join(vault, '.recto', 'topics-settings.json'), JSON.stringify({ enabled: false }))
    app = spawn(
      ELECTRON,
      ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`],
      {
        stdio: 'ignore',
        env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1' },
      },
    )
    cdp = await connect()
    await sleep(2500)
    // Open "Sources" so "summary" (collapsed) sits right above index and notes.
    const sources = await rowAt('Sources')
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp.call('Input.dispatchMouseEvent', { type, x: sources![0], y: sources![1], button: 'left', clickCount: 1 })
    await sleep(500)
  }, 60_000)

  afterAll(() => {
    cdp?.close()
    app?.kill()
    fs.rmSync(vault, { recursive: true, force: true })
    fs.rmSync(userData, { recursive: true, force: true })
  })

  it('renames a folder from its own dialog', async () => {
    // Open the dialog from the row's menu, on the folder itself.
    await evaluate(
      "(() => { const el = [...document.querySelectorAll('[role=treeitem]')].find((e) => e.querySelector('.tree__name')?.textContent === 'summary'); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })); return 1 })()",
    )
    await sleep(300)
    await evaluate("[...document.querySelectorAll('[role=menuitem]')].find((e) => e.textContent.includes('Rename'))?.click() ?? null")
    await sleep(300)
    expect(await dialogPath()).toBe('Sources/summary')
    await typeAndEnter('Summary notes')
    const entries = fs.readdirSync(path.join(vault, 'Sources')).sort()
    expect(entries).toEqual(['Summary notes', 'index.md', 'notes.md'])
    expect(fs.statSync(path.join(vault, 'Sources', 'Summary notes')).isDirectory()).toBe(true)
  }, 30_000)

  it('a note renamed without typing .md stays a note', async () => {
    await doubleClick((await rowAt('index'))!)
    expect(await dialogPath()).toBe('Sources/index.md')
    expect(await evaluate("document.querySelector('.dialog__input').value")).toBe('index')
    await typeAndEnter('Overview')
    expect(fs.readdirSync(path.join(vault, 'Sources')).sort()).toEqual(['Overview.md', 'Summary notes', 'notes.md'])
    expect(fs.readFileSync(path.join(vault, 'Sources', 'Overview.md'), 'utf8')).toBe('# Index\n\nThe sources.\n')
  }, 30_000)
})
