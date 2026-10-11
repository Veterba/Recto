import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ELECTRON, freePort, removeDir, stopProcess } from './helpers/app'

/**
 * Renaming from the file tree, driven like a person would.
 *
 * The dialog shows the whole name, extension included, with the part before
 * the extension selected. Typing a new name keeps the extension (once, a note
 * renamed without ".md" silently stopped being a note); changing it is asked
 * about first, and the file then opens as what it now is. "New file…" makes a
 * file of any type. Runs with `npm run test:e2e`.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
let PORT = 0
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
  const enter = async (): Promise<void> => {
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  }
  /** Type over the whole name (`all`), or over what the dialog selected - the part before the extension. */
  const typeAndEnter = async (text: string, all = true): Promise<void> => {
    await evaluate(
      `(() => { const i = document.querySelector('.dialog__input'); const [a, b] = [i.selectionStart, i.selectionEnd]; i.focus(); if (${all}) i.select(); else i.setSelectionRange(a, b); return 1 })()`,
    )
    await cdp.call('Input.insertText', { text })
    await enter()
    await sleep(1200)
  }
  const click = async ([x, y]: [number, number]): Promise<void> => {
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
    await sleep(800)
  }
  const menuOn = async (label: string, item: string): Promise<void> => {
    await evaluate(
      `(() => { const el = [...document.querySelectorAll('[role=treeitem]')].find((e) => e.querySelector('.tree__name')?.textContent === ${JSON.stringify(label)}); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })); return 1 })()`,
    )
    await sleep(300)
    await evaluate(
      `[...document.querySelectorAll('[role=menuitem]')].find((e) => e.textContent.includes(${JSON.stringify(item)}))?.click() ?? null`,
    )
    await sleep(300)
  }
  async function until(check: () => Promise<boolean>, ms = 10_000): Promise<void> {
    const started = Date.now()
    while (!(await check())) {
      if (Date.now() - started > ms) throw new Error('Timed out waiting.')
      await sleep(200)
    }
  }

  beforeAll(async () => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-rename-'))
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-data-'))
    // A folder with notes in it, and notes right below it at the same level.
    fs.mkdirSync(path.join(vault, 'Sources', 'summary'), { recursive: true })
    fs.mkdirSync(path.join(vault, 'Scripts'))
    for (let i = 1; i <= 6; i++) fs.writeFileSync(path.join(vault, 'Sources', 'summary', `0${i}-part.md`), `# Part ${i}\n`)
    fs.writeFileSync(path.join(vault, 'Sources', 'index.md'), '# Index\n\nThe sources.\n')
    fs.writeFileSync(path.join(vault, 'Sources', 'notes.md'), '# Notes\n')
    fs.writeFileSync(path.join(vault, 'Scripts', 'py.py.md'), 'print("hi")\n')
    fs.writeFileSync(path.join(vault, 'Scripts', 'todo.txt'), 'Ask about [[notes]] tomorrow.\n')
    fs.writeFileSync(path.join(userData, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    fs.mkdirSync(path.join(vault, '.recto'))
    fs.writeFileSync(path.join(vault, '.recto', 'topics-settings.json'), JSON.stringify({ enabled: false }))
    PORT = await freePort()
    app = spawn(
      ELECTRON,
      ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`],
      {
        stdio: 'ignore',
        // Its own process group, so stopping it stops everything it started.
        detached: true,
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

  afterAll(async () => {
    cdp?.close()
    await stopProcess(app)
    removeDir(vault)
    removeDir(userData)
  }, 30_000)

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

  it('a note renamed by typing a new name stays a note: the dialog shows .md and selects only the name', async () => {
    await doubleClick((await rowAt('index'))!)
    expect(await dialogPath()).toBe('Sources/index.md')
    expect(await evaluate("document.querySelector('.dialog__input').value")).toBe('index.md')
    expect(
      await evaluate("(() => { const i = document.querySelector('.dialog__input'); return [i.selectionStart, i.selectionEnd] })()"),
    ).toEqual([0, 5])
    await typeAndEnter('Overview', false)
    expect(fs.readdirSync(path.join(vault, 'Sources')).sort()).toEqual(['Overview.md', 'Summary notes', 'notes.md'])
    expect(fs.readFileSync(path.join(vault, 'Sources', 'Overview.md'), 'utf8')).toBe('# Index\n\nThe sources.\n')
  }, 30_000)

  it('py.py.md renamed to py.py asks first, then opens in the code editor', async () => {
    const scripts = await rowAt('Scripts')
    await click(scripts!)
    await doubleClick((await rowAt('py.py'))!)
    expect(await dialogPath()).toBe('Scripts/py.py.md')
    await typeAndEnter('py.py')
    // Not renamed yet: the question comes first.
    expect(fs.existsSync(path.join(vault, 'Scripts', 'py.py.md'))).toBe(true)
    expect(String(await evaluate("document.querySelector('[role=alertdialog]')?.textContent ?? ''"))).toContain('will stop being a note')
    await enter()
    await until(async () => fs.existsSync(path.join(vault, 'Scripts', 'py.py')))
    expect(fs.existsSync(path.join(vault, 'Scripts', 'py.py.md'))).toBe(false)
    await click((await rowAt('py.py'))!)
    await until(async () => (await evaluate("document.querySelector('.code-view') !== null")) === true)
    expect(await evaluate("document.querySelector('.code-view .cm-content')?.textContent ?? ''")).toContain('print("hi")')
  }, 30_000)

  it('todo.txt renamed to todo.md becomes a note: the index sees its link', async () => {
    await doubleClick((await rowAt('todo.txt'))!)
    expect(await evaluate("document.querySelector('.dialog__input').value")).toBe('todo.txt')
    await typeAndEnter('todo.md')
    expect(String(await evaluate("document.querySelector('[role=alertdialog]')?.textContent ?? ''"))).toContain('will become a note')
    await enter()
    await until(async () => fs.existsSync(path.join(vault, 'Scripts', 'todo.md')))
    // Its [[notes]] link reaches the index a moment later; then notes shows it as a linked mention.
    await until(async () =>
      JSON.stringify(await evaluate("window.api.invoke('index:backlinks', 'Sources/notes.md')")).includes('Scripts/todo.md'),
    )
    await click((await rowAt('notes'))!)
    await until(
      async () => String(await evaluate("document.querySelector('.backlinks__list')?.textContent ?? ''")).includes('todo'),
      15_000,
    )
  }, 30_000)

  it('New file "data.json" makes a JSON file and opens it as code', async () => {
    await menuOn('Scripts', 'New file')
    expect(await dialogPath()).toBe('Scripts/')
    await typeAndEnter('data.json')
    await until(async () => fs.existsSync(path.join(vault, 'Scripts', 'data.json')))
    await until(async () => (await evaluate("document.querySelector('.code-view') !== null")) === true)
    // A plain name is a note.
    await menuOn('Scripts', 'New file')
    await typeAndEnter('Plain')
    await until(async () => fs.existsSync(path.join(vault, 'Scripts', 'Plain.md')))
  }, 30_000)
})
