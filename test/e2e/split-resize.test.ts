import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Resizing split panes by their divider: the pane follows the pointer
 * exactly, stops at its minimum, and works nested and with the sidebar
 * collapsed. Runs with `npm run test:e2e`.
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

describe.skipIf(!RUN)('resizing split panes', () => {
  let app: ChildProcess
  let vault = ''
  let userData = ''
  let cdp: Cdp
  const evaluate = async (expression: string): Promise<unknown> =>
    (await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
  const mouse = async (type: string, x: number, y: number): Promise<void> => {
    await cdp.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 })
  }
  const key = async (key: string, code: string, keyCode: number, modifiers = 0): Promise<void> => {
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers })
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers })
    await sleep(300)
  }
  /** Every pane's box, in document order. */
  const panes = (): Promise<[number, number, number, number][]> =>
    evaluate(
      "[...document.querySelectorAll('[data-tabs-id]')].map((p) => { const r = p.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })",
    ) as Promise<[number, number, number, number][]>
  /** The centre of the n-th divider of the given kind. */
  const divider = (kind: 'vertical' | 'horizontal', n = 0): Promise<[number, number]> =>
    evaluate(
      `(() => { const d = document.querySelectorAll('.split--${kind} > .split__pane > .split__divider')[${n}]; const r = d.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`,
    ) as Promise<[number, number]>
  /** Press, move in `steps` equal steps, release. */
  const drag = async ([x, y]: [number, number], dx: number, dy: number, steps = 10): Promise<void> => {
    await mouse('mouseMoved', x, y)
    await mouse('mousePressed', x, y)
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', x + (dx * i) / steps, y + (dy * i) / steps)
      await sleep(20)
    }
    await mouse('mouseReleased', x + dx, y + dy)
    await sleep(300)
  }
  const focusEditor = (): Promise<unknown> => evaluate("document.querySelector('.cm-content').focus()")

  beforeAll(async () => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-resize-'))
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-data-'))
    fs.writeFileSync(path.join(vault, 'Alpha.md'), `# Alpha\n\n${'Words in a paragraph long enough to wrap. '.repeat(20)}\n`)
    fs.writeFileSync(path.join(userData, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    fs.mkdirSync(path.join(vault, '.recto'))
    fs.writeFileSync(path.join(vault, '.recto', 'topics-settings.json'), JSON.stringify({ enabled: false }))
    app = spawn(ELECTRON, [ROOT, `--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`], {
      stdio: 'ignore',
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1' },
    })
    cdp = await connect()
    await sleep(2500)
    const [x, y] = (await evaluate(
      "(() => { const el = [...document.querySelectorAll('[role=treeitem]')].find((e) => e.querySelector('.tree__name')?.textContent === 'Alpha'); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()",
    )) as [number, number]
    await mouse('mousePressed', x, y)
    await mouse('mouseReleased', x, y)
    await sleep(1000)
    // Split right: two panes side by side.
    await focusEditor()
    await key('ArrowRight', 'ArrowRight', 39, 4 | 1)
    await sleep(500)
  }, 60_000)

  afterAll(() => {
    cdp?.close()
    app?.kill()
    fs.rmSync(vault, { recursive: true, force: true })
    fs.rmSync(userData, { recursive: true, force: true })
  })

  it('dragging the divider 100px right grows the left pane by 100px, and nothing collapses', async () => {
    const before = await panes()
    expect(before).toHaveLength(2)
    await drag(await divider('vertical'), 100, 0)
    const after = await panes()
    expect(after[0]![2] - before[0]![2]).toBeGreaterThanOrEqual(98)
    expect(after[0]![2] - before[0]![2]).toBeLessThanOrEqual(102)
    expect(after[1]![2]).toBeGreaterThanOrEqual(280)
    // And back again, just as exactly.
    await drag(await divider('vertical'), -100, 0)
    const back = await panes()
    expect(Math.abs(back[0]![2] - before[0]![2])).toBeLessThanOrEqual(2)
  }, 30_000)

  it('flung past the edge, the divider stops at the minimum', async () => {
    await drag(await divider('vertical'), 3000, 0, 4)
    const right = await panes()
    expect(Math.round(right[1]![2])).toBeGreaterThanOrEqual(279)
    expect(Math.round(right[1]![2])).toBeLessThanOrEqual(284)
    await drag(await divider('vertical'), -3000, 0, 4)
    const left = await panes()
    expect(Math.round(left[0]![2])).toBeGreaterThanOrEqual(279)
    expect(Math.round(left[0]![2])).toBeLessThanOrEqual(284)
  }, 30_000)

  it('double-click evens it; arrow keys move it', async () => {
    const [x, y] = await divider('vertical')
    await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
    await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 2 })
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 2 })
    await sleep(300)
    const even = await panes()
    expect(Math.abs(even[0]![2] - even[1]![2])).toBeLessThanOrEqual(2)
    await evaluate("document.querySelector('.split--vertical > .split__pane > .split__divider').focus()")
    await key('ArrowRight', 'ArrowRight', 39)
    const nudged = await panes()
    expect(Math.round(nudged[0]![2] - even[0]![2])).toBe(16)
  }, 30_000)

  it('a nested split resizes the same way', async () => {
    // Split the right pane down: a stacked pair inside the row.
    await evaluate("document.querySelectorAll('.cm-content')[1].focus()")
    await key('ArrowDown', 'ArrowDown', 40, 4 | 1)
    await sleep(500)
    const before = await panes()
    expect(before).toHaveLength(3)
    // Stacked panes are short in a test window: a move that leaves both above the minimum.
    await drag(await divider('horizontal'), 0, -30)
    const after = await panes()
    expect(after[1]![3] - before[1]![3]).toBeGreaterThanOrEqual(-32)
    expect(after[1]![3] - before[1]![3]).toBeLessThanOrEqual(-28)
    // And pushed past the minimum, it stops there.
    await drag(await divider('horizontal'), 0, 2000, 4)
    const stopped = await panes()
    expect(Math.round(stopped[2]![3])).toBeGreaterThanOrEqual(279)
    // The row's own divider is unaffected by the inner one.
    expect(Math.abs(after[0]![2] - before[0]![2])).toBeLessThanOrEqual(1)
  }, 30_000)

  it('with the sidebar collapsed, the divider still follows the pointer', async () => {
    await evaluate(`document.querySelector('[aria-label="Hide sidebar"]')?.click() ?? null`)
    await sleep(600)
    const collapsed = (await evaluate("document.querySelector('.sidebar') === null")) as boolean
    const before = await panes()
    await drag(await divider('vertical'), 100, 0)
    const after = await panes()
    expect(collapsed).toBe(true)
    expect(after[0]![2] - before[0]![2]).toBeGreaterThanOrEqual(98)
    expect(after[0]![2] - before[0]![2]).toBeLessThanOrEqual(102)
  }, 30_000)
})
