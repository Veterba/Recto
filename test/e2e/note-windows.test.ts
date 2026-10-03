import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Floating note windows: hover a link, click its preview, get a read-only
 * window of the note - saved with the layout - and ⌘Esc closes it. Runs with
 * `npm run test:e2e`.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const ELECTRON = path.join(ROOT, 'node_modules/.bin/electron')
const PORT = 9420 + Math.floor(Math.random() * 400)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

type Cdp = {
  call: (method: string, params?: object) => Promise<{ result?: { result?: { value?: unknown } } }>
  close: () => void
  /** The next event of this name the page sends. */
  next: (method: string) => Promise<{ params: Record<string, unknown> }>
}

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
  const waiting = new Map<string, (value: never) => void>()
  ws.onmessage = (m) => {
    const data = JSON.parse(String(m.data)) as { id?: number; method?: string }
    if (data.id !== undefined) pending.get(data.id)?.(data as never)
    if (data.method !== undefined) waiting.get(data.method)?.(data as never)
  }
  return {
    call: (method, params = {}) =>
      new Promise((resolve) => {
        const n = ++id
        pending.set(n, resolve)
        ws.send(JSON.stringify({ id: n, method, params }))
      }),
    close: () => ws.close(),
    next: (method) => new Promise((resolve) => waiting.set(method, resolve)),
  }
}

describe.skipIf(!RUN)('floating note windows', () => {
  let app: ChildProcess
  let vault = ''
  let userData = ''
  let cdp: Cdp
  const evaluate = async (expression: string): Promise<unknown> =>
    (await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
  const mouse = async (type: string, x: number, y: number): Promise<void> => {
    await cdp.call('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: type === 'mouseMoved' ? 'none' : 'left',
      buttons: type === 'mousePressed' ? 1 : 0,
      clickCount: 1,
    })
  }
  const click = async (x: number, y: number): Promise<void> => {
    await mouse('mouseMoved', x, y)
    await mouse('mousePressed', x, y)
    await mouse('mouseReleased', x, y)
  }
  const center = (selector: string): Promise<[number, number]> =>
    evaluate(`(() => { const r = ${selector}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`) as Promise<
      [number, number]
    >
  const saved = (): { noteWindows?: { path: string; width: number }[] } =>
    JSON.parse(fs.readFileSync(path.join(vault, '.recto', 'workspace.json'), 'utf8'))
  const waitFor = async (expression: string, ms = 5000): Promise<unknown> => {
    const end = Date.now() + ms
    let value: unknown = null
    while (Date.now() < end) {
      value = await evaluate(expression)
      if (value) return value
      await sleep(100)
    }
    return value
  }

  beforeAll(async () => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-windows-'))
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-data-'))
    fs.writeFileSync(path.join(vault, 'Alpha.md'), '# Alpha\n\nSee [[Beta]] for the rest.\n')
    fs.writeFileSync(path.join(vault, 'Beta.md'), '# Beta\n\nThe second note, **in bold**.\n')
    fs.writeFileSync(path.join(userData, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    fs.mkdirSync(path.join(vault, '.recto'))
    fs.writeFileSync(path.join(vault, '.recto', 'topics-settings.json'), JSON.stringify({ enabled: false }))
    // The shortest preview delay the setting allows.
    fs.writeFileSync(path.join(vault, '.recto', 'appearance.json'), JSON.stringify({ previewDelay: 0.5 }))
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
    const [x, y] = await center(
      "[...document.querySelectorAll('[role=treeitem]')].find((e) => e.querySelector('.tree__name')?.textContent === 'Alpha')",
    )
    await click(x, y)
    await sleep(1000)
  }, 60_000)

  afterAll(() => {
    cdp?.close()
    app?.kill()
    fs.rmSync(vault, { recursive: true, force: true })
    fs.rmSync(userData, { recursive: true, force: true })
  })

  it('hovering a link shows its preview', async () => {
    const [x, y] = await center("document.querySelector('.cm-wikilink')")
    await mouse('mouseMoved', x - 2, y)
    await mouse('mouseMoved', x, y)
    expect(await waitFor("document.querySelector('.note-peek .note-peek__title')?.textContent ?? null")).toBe('Beta')
  }, 15_000)

  it('clicking the preview pins the note as a read-only window', async () => {
    // Anywhere on the card but its buttons: its bottom-left corner.
    const [x, y] = (await evaluate(
      "(() => { const r = document.querySelector('.note-peek').getBoundingClientRect(); return [r.left + 6, r.bottom - 6] })()",
    )) as [number, number]
    await click(x, y)
    expect(await waitFor("document.querySelector('.note-window .note-window__title')?.textContent ?? null")).toBe('Beta')
    expect(await evaluate("document.querySelector('.note-peek')")).toBeNull()
    expect(await waitFor("document.querySelector('.note-window .cm-content')?.textContent.includes('The second note') ?? false")).toBe(true)
    // Rendered, and not editable.
    expect(await evaluate("document.querySelector('.note-window .cm-content').getAttribute('contenteditable')")).toBe('false')
    expect(
      await evaluate(
        "document.querySelector('.note-window .cm-strong, .note-window strong') !== null || document.querySelector('.note-window .cm-content').textContent.includes('**') === false",
      ),
    ).toBe(true)
    expect(await evaluate("[...document.querySelectorAll('.note-window button')].some((b) => b.textContent === 'Open in editor')")).toBe(
      true,
    )
    await sleep(1200)
    expect(saved().noteWindows?.map((w) => w.path)).toEqual(['Beta.md'])
  }, 15_000)

  it('⌘Esc closes it', async () => {
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, modifiers: 4 })
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, modifiers: 4 })
    expect(await waitFor("document.querySelector('.note-window') === null", 2000)).toBe(true)
    await sleep(1200)
    expect(saved().noteWindows).toEqual([])
  }, 15_000)
})
