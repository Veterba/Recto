import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Find in the open note, driven from the keyboard: ⌘F, type, Enter, Esc.
 * Runs with `npm run test:e2e`.
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

/** CDP modifier bits. */
const META = 4
const SHIFT = 8

describe.skipIf(!RUN)('find in note', () => {
  let app: ChildProcess
  let vault = ''
  let userData = ''
  let cdp: Cdp
  const evaluate = async (expression: string): Promise<unknown> =>
    (await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
  const press = async (key: string, code: string, keyCode: number, modifiers = 0, text?: string): Promise<void> => {
    await cdp.call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      modifiers,
      ...(text ? { text } : {}),
    })
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers })
    await sleep(150)
  }
  /** The editor's main selection, read through the back-reference CodeMirror keeps on its DOM. */
  const selection = (): Promise<unknown> =>
    evaluate("(() => { const s = document.querySelector('.cm-content').cmTile.view.state.selection.main; return [s.from, s.to] })()")
  const count = (): Promise<unknown> => evaluate("document.querySelector('.find__count')?.textContent ?? null")
  const focused = (): Promise<unknown> => evaluate("document.activeElement?.className ?? ''")

  beforeAll(async () => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-find-'))
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-data-'))
    fs.writeFileSync(path.join(vault, 'Fruit.md'), 'Apples\n\nOne apple, two apples.\nNo pears.\nA last apple.\n')
    const filler = Array.from({ length: 300 }, (_, i) => `Line ${i}.`)
    filler[5] = 'A needle near the top.'
    filler[299] = 'A needle on the very last line.'
    fs.writeFileSync(path.join(vault, 'Long.md'), `${filler.join('\n')}\n`)
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
    const row = (await evaluate(
      "(() => { const el = [...document.querySelectorAll('[role=treeitem]')].find((e) => e.querySelector('.tree__name')?.textContent === 'Fruit'); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()",
    )) as [number, number]
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp.call('Input.dispatchMouseEvent', { type, x: row[0], y: row[1], button: 'left', clickCount: 1 })
    await sleep(1000)
    await evaluate(
      "(() => { const v = document.querySelector('.cm-content').cmTile.view; v.focus(); v.dispatch({ selection: { anchor: 0 } }); return 1 })()",
    )
  }, 60_000)

  afterAll(() => {
    cdp?.close()
    app?.kill()
    fs.rmSync(vault, { recursive: true, force: true })
    fs.rmSync(userData, { recursive: true, force: true })
  })

  it('⌘F opens the bar with the keyboard in it', async () => {
    await press('f', 'KeyF', 70, META)
    expect(await evaluate("document.querySelectorAll('.cm-panels-bottom .find').length")).toBe(1)
    expect(await focused()).toContain('find__input--find')
    expect(await evaluate("document.querySelector('.find .find__row--replace').hidden")).toBe(true)
  })

  it('typing searches live and selects the first match', async () => {
    await cdp.call('Input.insertText', { text: 'apple' })
    await sleep(200)
    // "Apples" in the first line counts: match case is off.
    expect(await count()).toBe('1 / 4')
    expect(await selection()).toEqual([0, 5])
    expect(await evaluate("document.querySelectorAll('.cm-searchMatch').length")).toBe(4)
    expect(await evaluate("document.querySelectorAll('.cm-searchMatch-selected').length")).toBe(1)
    // One tick per line with a match: two share the second line. Drawn on the
    // next animation frame, which a window in the background can hold back.
    let ticks: unknown = 0
    for (let i = 0; i < 20 && ticks !== 3; i++) {
      await sleep(100)
      ticks = await evaluate("document.querySelectorAll('.find-marks__tick').length")
    }
    expect(ticks).toBe(3)
  })

  it('Enter goes to the next match and ⇧Enter back', async () => {
    await press('Enter', 'Enter', 13, 0, '\r')
    expect(await count()).toBe('2 / 4')
    expect(await selection()).toEqual([12, 17])
    await press('Enter', 'Enter', 13, 0, '\r')
    expect(await count()).toBe('3 / 4')
    await press('Enter', 'Enter', 13, SHIFT, '\r')
    expect(await count()).toBe('2 / 4')
    // The note itself is untouched by any of it.
    expect(await evaluate("document.querySelector('.cm-content').cmTile.view.state.doc.toString()")).toBe(
      'Apples\n\nOne apple, two apples.\nNo pears.\nA last apple.\n',
    )
  })

  it('Esc closes the card and leaves the cursor on the match', async () => {
    await press('Escape', 'Escape', 27)
    // The card plays its exit before it is removed; the keyboard is back at once.
    expect(await focused()).toContain('cm-content')
    await sleep(200)
    expect(await evaluate("document.querySelectorAll('.find').length")).toBe(0)
    expect(await focused()).toContain('cm-content')
    expect(await selection()).toEqual([12, 17])
    expect(await evaluate("document.querySelectorAll('.cm-searchMatch').length")).toBe(0)
  })

  it('⌘⌥F opens replace, and replace all is undone in one step', async () => {
    await press('f', 'KeyF', 70, META | 1)
    expect(await evaluate("document.querySelector('.find .find__row--replace').hidden")).toBe(false)
    // The selection ("apple") was taken as the query, so the replace field has the keyboard.
    expect(await focused()).toContain('find__input--replace')
    await cdp.call('Input.insertText', { text: 'pear' })
    await evaluate("document.querySelector('.find__secondary').click()")
    await sleep(200)
    const doc = "document.querySelector('.cm-content').cmTile.view.state.doc.toString()"
    expect(await evaluate(doc)).toBe('pears\n\nOne pear, two pears.\nNo pears.\nA last pear.\n')
    await press('Escape', 'Escape', 27)
    await press('z', 'KeyZ', 90, META)
    expect(await evaluate(doc)).toBe('Apples\n\nOne apple, two apples.\nNo pears.\nA last apple.\n')
  })

  it('the current match scrolls into view above the card, not behind it', async () => {
    await press('Escape', 'Escape', 27)
    await sleep(200)
    const row = (await evaluate(
      "(() => { const el = [...document.querySelectorAll('[role=treeitem]')].find((e) => e.querySelector('.tree__name')?.textContent === 'Long'); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()",
    )) as [number, number]
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp.call('Input.dispatchMouseEvent', { type, x: row[0], y: row[1], button: 'left', clickCount: 1 })
    await sleep(1000)
    await evaluate(
      "(() => { const v = document.querySelector('.cm-content').cmTile.view; v.focus(); v.dispatch({ selection: { anchor: 0 } }); return 1 })()",
    )
    await press('f', 'KeyF', 70, META)
    await cdp.call('Input.insertText', { text: 'needle' })
    await sleep(200)
    await press('Enter', 'Enter', 13, 0, '\r')
    expect(await count()).toBe('2 / 2')
    await sleep(300)
    const [matchBottom, cardTop] = (await evaluate(
      "[document.querySelector('.cm-searchMatch-selected').getBoundingClientRect().bottom, document.querySelector('.find').getBoundingClientRect().top]",
    )) as [number, number]
    expect(matchBottom).toBeLessThan(cardTop)
  })
})
