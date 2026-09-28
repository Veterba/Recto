import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Splitting by dragging: a note from the file tree dropped on the right edge
 * of the pane makes two panes, and a tab drag cancelled with Esc changes
 * nothing. Runs with `npm run test:e2e`.
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

describe.skipIf(!RUN)('splitting by dragging', () => {
  let app: ChildProcess
  let vault = ''
  let userData = ''
  let cdp: Cdp
  const evaluate = async (expression: string): Promise<unknown> =>
    (await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
  const mouse = async (type: string, x: number, y: number): Promise<void> => {
    await cdp.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 })
  }
  const center = (selector: string): Promise<[number, number]> =>
    evaluate(`(() => { const r = ${selector}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`) as Promise<
      [number, number]
    >
  const row = (label: string): string =>
    `[...document.querySelectorAll('[role=treeitem]')].find((e) => e.querySelector('.tree__name')?.textContent === ${JSON.stringify(label)})`
  /** The panes on screen, by the notes in their tabs. */
  const panes = (): Promise<unknown> =>
    evaluate(
      "[...document.querySelectorAll('[data-tabs-id]')].map((p) => [...p.querySelectorAll('.tab__title')].map((t) => t.textContent))",
    )
  const saved = (): {
    sections: { data: { root: { kind: string; direction?: string; children: { children: { state: { path: string } }[] }[] } } }
  } => JSON.parse(fs.readFileSync(path.join(vault, '.recto', 'workspace.json'), 'utf8'))

  beforeAll(async () => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-split-'))
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-data-'))
    fs.writeFileSync(path.join(vault, 'Alpha.md'), '# Alpha\n\nThe first note.\n')
    fs.writeFileSync(path.join(vault, 'Beta.md'), '# Beta\n\nThe second note.\n')
    fs.writeFileSync(path.join(userData, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    fs.mkdirSync(path.join(vault, '.recto'))
    fs.writeFileSync(path.join(vault, '.recto', 'topics-settings.json'), JSON.stringify({ enabled: false }))
    app = spawn(ELECTRON, [ROOT, `--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`], {
      stdio: 'ignore',
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1' },
    })
    cdp = await connect()
    await sleep(2500)
    const [x, y] = await center(row('Alpha'))
    await mouse('mousePressed', x, y)
    await mouse('mouseReleased', x, y)
    await sleep(1000)
  }, 60_000)

  afterAll(() => {
    cdp?.close()
    app?.kill()
    fs.rmSync(vault, { recursive: true, force: true })
    fs.rmSync(userData, { recursive: true, force: true })
  })

  it('a note dragged from the tree to the right edge of the pane makes two panes', async () => {
    expect(await panes()).toEqual([['Alpha']])
    // The tree drags natively; CDP hands the drag over so it can be steered.
    await cdp.call('Input.setInterceptDrags', { enabled: true })
    const [sx, sy] = await center(row('Beta'))
    const intercepted = cdp.next('Input.dragIntercepted')
    await mouse('mousePressed', sx, sy)
    await mouse('mouseMoved', sx + 10, sy + 4)
    await mouse('mouseMoved', sx + 40, sy + 10)
    const { params } = await intercepted
    const data = params['data']

    const box = (await evaluate(
      "(() => { const r = document.querySelector('[data-tabs-id]').getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })()",
    )) as [number, number, number, number]
    const [tx, ty] = [box[0] + box[2] * 0.95, box[1] + box[3] * 0.5]
    await cdp.call('Input.dispatchDragEvent', { type: 'dragEnter', x: tx, y: ty, data })
    await cdp.call('Input.dispatchDragEvent', { type: 'dragOver', x: tx, y: ty, data })
    await sleep(300)
    // The preview shows the right half of the pane.
    const preview = (await evaluate(
      "(() => { const p = document.querySelector('.pane-drop__preview.is-shown'); if (!p) return null; const r = p.getBoundingClientRect(); return [r.x, r.width] })()",
    )) as [number, number] | null
    expect(preview).not.toBeNull()
    expect(preview![0]).toBeCloseTo(box[0] + box[2] / 2, -1)
    expect(preview![1]).toBeCloseTo(box[2] / 2, -1)

    await cdp.call('Input.dispatchDragEvent', { type: 'drop', x: tx, y: ty, data })
    await mouse('mouseReleased', tx, ty)
    await cdp.call('Input.setInterceptDrags', { enabled: false })
    await sleep(800)

    expect(await panes()).toEqual([['Alpha'], ['Beta']])
    expect(await evaluate("document.querySelectorAll('.split--vertical').length")).toBe(1)
    expect(await evaluate("document.querySelector('.pane-drop__preview.is-shown')")).toBeNull()
    // The drop did not paste the path into the note under it.
    expect(fs.readFileSync(path.join(vault, 'Alpha.md'), 'utf8')).toBe('# Alpha\n\nThe first note.\n')

    // And it is saved.
    await sleep(1200)
    const root = saved().sections.data.root
    expect(root.kind).toBe('split')
    expect(root.direction).toBe('vertical')
    expect(root.children.map((pane) => pane.children.map((leaf) => leaf.state.path))).toEqual([['Alpha.md'], ['Beta.md']])
  }, 30_000)

  it('a tab dragged over a pane and let go of after Esc changes nothing', async () => {
    const [tx, ty] = await center("[...document.querySelectorAll('.tab')].find((t) => t.textContent.includes('Beta'))")
    const box = (await evaluate(
      "(() => { const r = document.querySelectorAll('[data-tabs-id]')[0].getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })()",
    )) as [number, number, number, number]
    const [dx, dy] = [box[0] + box[2] * 0.5, box[1] + box[3] * 0.9]
    await mouse('mousePressed', tx, ty)
    await mouse('mouseMoved', tx - 20, ty + 20)
    await mouse('mouseMoved', dx, dy)
    await sleep(300)
    expect(await evaluate("document.querySelector('.pane-drop__preview.is-shown') !== null")).toBe(true)
    expect(await evaluate("document.querySelector('.pane-drop__label')?.textContent")).toBe('Beta')
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(200)
    expect(await evaluate("document.querySelector('.pane-drop__preview.is-shown')")).toBeNull()
    await mouse('mouseReleased', dx, dy)
    await sleep(500)
    expect(await panes()).toEqual([['Alpha'], ['Beta']])
  }, 30_000)

  it('the same tab dropped on the bottom of the other pane moves it there', async () => {
    const [tx, ty] = await center("[...document.querySelectorAll('.tab')].find((t) => t.textContent.includes('Beta'))")
    const box = (await evaluate(
      "(() => { const r = document.querySelectorAll('[data-tabs-id]')[0].getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })()",
    )) as [number, number, number, number]
    const [dx, dy] = [box[0] + box[2] * 0.5, box[1] + box[3] * 0.9]
    await mouse('mousePressed', tx, ty)
    await mouse('mouseMoved', tx - 20, ty + 20)
    await mouse('mouseMoved', dx, dy)
    await sleep(200)
    await mouse('mouseReleased', dx, dy)
    await sleep(500)
    // Beta's pane emptied and went; Alpha's pane is now Alpha over Beta.
    expect(await panes()).toEqual([['Alpha'], ['Beta']])
    expect(await evaluate("document.querySelectorAll('.split--horizontal').length")).toBe(1)
    expect(await evaluate("document.querySelectorAll('.split--vertical').length")).toBe(0)
  }, 30_000)
})
