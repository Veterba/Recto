import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseTableSource } from '../../src/renderer/features/editor/table-model'

/**
 * Tables edited like a spreadsheet: inserted from the toolbar, typed into
 * with Tab, rows and columns added, deleted and moved from their handles, TSV
 * pasted into a cell - and every one of those steps undone, one at a time.
 * Runs with `npm run test:e2e`; the window is never shown.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!RUN)('editing tables', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let note = ''
  /** The note after each step, to undo back through. */
  const states: string[] = []
  const read = (): string => fs.readFileSync(note, 'utf8')
  /** Wait for the next save, and remember it. */
  const saved = async (check: (text: string) => boolean): Promise<string> => {
    await expect.poll(() => check(read()), { timeout: 5000 }).toBe(true)
    states.push(read())
    return read()
  }
  /** The note's table, header row first, as cells. */
  const body = (text: string): string[][] =>
    parseTableSource(
      text
        .split('\n')
        .filter((l) => l.startsWith('|'))
        .join('\n'),
    )?.rows ?? []
  const menu = async (kind: 'row' | 'col', index: number, label: string): Promise<void> => {
    const grip = page.locator(`.cm-tbl-grip--${kind}`).nth(index)
    await grip.hover()
    await grip.click()
    // An icon button (by its label) or a text item in the table menu.
    await page
      .locator(`.tmenu [aria-label="${label}"]`)
      .or(page.locator('.tmenu .tmenu__item', { hasText: label }))
      .first()
      .click()
    await sleep(300)
  }

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-tbl-'))
    const vault = path.join(base, 'Table vault')
    fs.mkdirSync(path.join(vault, '.recto'), { recursive: true })
    note = path.join(vault, 'Blank.md')
    fs.writeFileSync(note, '# Blank\n\nText.\n')
    fs.writeFileSync(path.join(vault, 'Data.md'), '# Data\n\n| Item | N |\n|---|---|\n| b | 10 |\n| a | 9 |\n| c | 100 |\n\nAfter.\n')
    const big = Array.from(
      { length: 201 },
      (_, r) => `| ${Array.from({ length: 10 }, (_, c) => (r === 0 ? `col ${c}` : `${r}.${c}`)).join(' | ')} |`,
    )
    big.splice(1, 0, `|${' --- |'.repeat(10)}`)
    fs.writeFileSync(path.join(vault, 'End.md'), '# End\n\nLast line.')
    const head = Array.from({ length: 13 }, (_, c) => `Column number ${c + 1}`)
    const row = Array.from({ length: 13 }, (_, c) => (c === 0 ? 'First' : `value ${c} with some words`))
    fs.writeFileSync(
      path.join(vault, 'Wide.md'),
      `# Wide\n\n| ${head.join(' | ')} |\n|${' --- |'.repeat(13)}\n| ${row.join(' | ')} |\n\nAfter.\n`,
    )
    fs.writeFileSync(path.join(vault, 'Big.md'), `# Big\n\n${big.join('\n')}\n`)
    fs.writeFileSync(path.join(vault, '.recto', 'topics-settings.json'), JSON.stringify({ enabled: false }))
    fs.mkdirSync(path.join(base, 'profile'))
    fs.writeFileSync(path.join(base, 'profile', 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${path.join(base, 'profile')}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1' },
    })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    await page.locator('[role=treeitem]', { hasText: 'Blank' }).click()
    await page.waitForSelector('.cm-content')
    states.push(read())
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    fs.rmSync(base, { recursive: true, force: true })
  })

  it('inserts a 3 × 4 table from the toolbar, keyboard in the first header cell', async () => {
    await page.locator('.cm-line', { hasText: 'Text.' }).click()
    await page.keyboard.press('End')
    await page.locator('.formatbar__btn[aria-label="Table"]').dispatchEvent('mousedown')
    await page.waitForSelector('.table-picker')
    await page.locator('.table-picker__cell[aria-label="3 × 4"]').hover()
    expect(await page.locator('.table-picker__size').textContent()).toBe('3 × 4')
    await page.locator('.table-picker__cell[aria-label="3 × 4"]').dispatchEvent('mousedown')
    const text = await saved((t) => t.includes('| Column 1 | Column 2 | Column 3 |'))
    expect(body(text)).toEqual([
      ['Column 1', 'Column 2', 'Column 3'],
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ])
    expect(text.startsWith('# Blank\n\nText.\n\n| Column 1')).toBe(true)
    await page.waitForSelector('.cm-tbl th.is-editing')
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Column 1')
  })

  it('Tab moves through the cells, writing each one', async () => {
    for (const word of ['Fruit', 'Qty', 'Note', 'Apples', '10']) {
      await page.keyboard.type(word)
      await page.keyboard.press('Tab')
      await saved((t) => t.includes(word))
      await sleep(150)
    }
    expect(body(read()).slice(0, 2)).toEqual([
      ['Fruit', 'Qty', 'Note'],
      ['Apples', '10', ''],
    ])
  })

  it('Tab in the last cell adds a row', async () => {
    await page.keyboard.press('Escape')
    await sleep(300)
    await page.locator('.cm-tbl td[data-row="3"][data-col="2"]').click()
    await page.keyboard.type('end')
    await page.keyboard.press('Tab')
    await saved((t) => body(t).length === 5)
    expect(body(read())[3]![2]).toBe('end')
  })

  it('adds, moves and deletes rows from their handles', async () => {
    await page.keyboard.press('Escape')
    await menu('row', 1, 'Insert row below')
    await saved((t) => body(t).length === 6)
    await menu('row', 1, 'Move row down')
    await saved((t) => body(t)[2]![0] === 'Apples')
    await menu('row', 2, 'Delete row')
    await saved((t) => body(t).length === 5 && !t.includes('Apples'))
  })

  it('adds, moves and deletes columns from their handles', async () => {
    await menu('col', 0, 'Insert column right')
    await saved((t) => body(t)[0]!.length === 4)
    await menu('col', 2, 'Move column right')
    await saved((t) => body(t)[0]![3] === 'Qty')
    await menu('col', 1, 'Delete column')
    await saved((t) => body(t)[0]!.length === 3)
    expect(body(read())[0]).toEqual(['Fruit', 'Note', 'Qty'])
  })

  it('pastes TSV into a cell, growing the table', async () => {
    await app.evaluate(({ clipboard }) => clipboard.writeText('x\ty\nz\tw\nlast\trow'))
    const rows = body(read()).length
    await page.locator(`.cm-tbl td[data-row="${rows - 1}"][data-col="2"]`).click()
    await page.keyboard.press('Meta+V')
    await saved((t) => body(t).length === rows + 2 && body(t)[0]!.length === 4)
    const after = body(read())
    expect(after[rows - 1]!.slice(2)).toEqual(['x', 'y'])
    expect(after[rows]!.slice(2)).toEqual(['z', 'w'])
    expect(after[rows + 1]!.slice(2)).toEqual(['last', 'row'])
  })

  it('undoes every step, one at a time, back to the note without a table', async () => {
    await page.keyboard.press('Escape')
    await page.locator('.cm-tbl td[data-row="1"][data-col="0"]').click()
    for (let i = states.length - 2; i >= 0; i--) {
      await page.keyboard.press('Meta+Z')
      await expect.poll(read, { timeout: 5000 }).toBe(states[i])
      await sleep(150)
    }
    expect(read()).toBe('# Blank\n\nText.\n')
  }, 60_000)

  describe('on a table already in a note', () => {
    const data = (): string => fs.readFileSync(path.join(path.dirname(note), 'Data.md'), 'utf8')
    const cell = (row: number, col: number): ReturnType<Page['locator']> => page.locator(`.cm-tbl [data-row="${row}"][data-col="${col}"]`)

    beforeAll(async () => {
      await page.locator('[role=treeitem]', { hasText: 'Data' }).click()
      await page.waitForSelector('.cm-tbl')
    })

    it('sorts a column of numbers as numbers, header on top', async () => {
      await menu('col', 1, 'Sort A → Z')
      await expect.poll(() => body(data()).map((r) => r[0])).toEqual(['Item', 'a', 'b', 'c'])
      await page.keyboard.press('Meta+Z')
      await expect.poll(() => body(data()).map((r) => r[0])).toEqual(['Item', 'b', 'a', 'c'])
    })

    it('selects a rectangle with shift+click, copies it as TSV and markdown, and Delete clears it', async () => {
      await cell(1, 0).click()
      await cell(2, 1).click({ modifiers: ['Shift'] })
      expect(await page.locator('.cm-tbl .is-sel').count()).toBe(4)
      const copied = await page.evaluate(() => {
        const data = new DataTransfer()
        const event = new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true })
        document.activeElement?.dispatchEvent(event)
        return { tsv: data.getData('text/plain'), md: data.getData('text/markdown') }
      })
      expect(copied.tsv).toBe('b\t10\na\t9')
      expect(copied.md).toBe('| b   | 10  |\n| --- | --- |\n| a   | 9   |')
      await page.keyboard.press('Delete')
      await expect
        .poll(() => body(data()).slice(1, 3))
        .toEqual([
          ['', ''],
          ['', ''],
        ])
      await page.keyboard.press('Meta+Z')
      await expect.poll(() => body(data())[1]).toEqual(['b', '10'])
    })

    it('shift+arrows extend a selection from the cell being edited', async () => {
      await cell(1, 0).click()
      await page.keyboard.press('Shift+ArrowRight')
      await page.keyboard.press('Shift+ArrowDown')
      expect(await page.locator('.cm-tbl .is-sel').count()).toBe(4)
      await page.keyboard.press('Escape')
    })

    it('Shift+Enter writes a <br>; Enter goes down; arrows cross cell edges', async () => {
      await cell(1, 0).click()
      await page.keyboard.press('Shift+Enter')
      await page.keyboard.type('two')
      await page.keyboard.press('Enter')
      await expect.poll(() => body(data())[1]![0]).toBe('b<br>two')
      // Enter lands with the cell's text selected; an arrow then moves on.
      await page.waitForSelector('.cm-tbl [data-row="2"][data-col="0"].is-editing')
      await page.keyboard.press('ArrowRight')
      await page.waitForSelector('.cm-tbl [data-row="2"][data-col="1"].is-editing')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Meta+Z')
      await expect.poll(() => body(data())[1]![0]).toBe('b')
    })

    it('drags a row by its handle to a new place', async () => {
      const grip = page.locator('.cm-tbl-grip--row').nth(1)
      await grip.hover()
      const from = (await grip.boundingBox())!
      const to = (await cell(3, 0).boundingBox())!
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await page.mouse.down()
      await page.mouse.move(from.x + 2, from.y + 20, { steps: 4 })
      await page.mouse.move(from.x + 2, to.y + to.height - 2, { steps: 6 })
      await page.mouse.up()
      await expect.poll(() => body(data()).map((r) => r[0])).toEqual(['Item', 'a', 'c', 'b'])
    })

    it('offers "Paste as table" for TSV pasted outside a table', async () => {
      await page.keyboard.press('Escape')
      await page.locator('.cm-line', { hasText: 'After.' }).click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await app.evaluate(({ clipboard }) => clipboard.writeText('City\tPop\nOslo\t700\n'))
      await page.keyboard.press('Meta+V')
      await page.waitForSelector('.cm-tbl-chip__btn')
      await page.locator('.cm-tbl-chip__btn').dispatchEvent('mousedown')
      await expect.poll(() => data().includes('| City | Pop |')).toBe(true)
      expect(data()).toContain('After.\n\n| City | Pop |\n| ---- | --- |\n| Oslo | 700 |\n')
    })

    it('keeps a 200 × 10 table responsive: a cell edit is written and redrawn quickly', async () => {
      await page.locator('[role=treeitem]', { hasText: 'Big' }).click()
      await page.waitForSelector('.cm-tbl [data-row="200"]')
      const big = path.join(path.dirname(note), 'Big.md')
      await cell(100, 5).click()
      await page.keyboard.press('Meta+A')
      await page.keyboard.type('X')
      const started = Date.now()
      await page.keyboard.press('Tab')
      await page.waitForSelector('.cm-tbl [data-row="100"][data-col="6"].is-editing')
      const elapsed = Date.now() - started
      expect(elapsed).toBeLessThan(400)
      await expect.poll(() => fs.readFileSync(big, 'utf8').includes('| 100.4 | X     | 100.6 |')).toBe(true)
    })
  })

  describe('the line under a table, and its width', () => {
    it('inserted at the end of a note, Esc, then typing: a paragraph, not a row', async () => {
      const end = path.join(path.dirname(note), 'End.md')
      await page.locator('[role=treeitem]', { hasText: 'End' }).click()
      await page.locator('.cm-line', { hasText: 'Last line.' }).click()
      await page.keyboard.press('End')
      await page.locator('.formatbar__btn[aria-label="Table"]').dispatchEvent('mousedown')
      await page.waitForSelector('.table-picker')
      await page.keyboard.press('Enter')
      await page.waitForSelector('.cm-tbl th.is-editing')
      await page.keyboard.press('Escape')
      await page.keyboard.type('A paragraph.')
      await expect.poll(() => fs.readFileSync(end, 'utf8').endsWith('|\n\nA paragraph.')).toBe(true)
      const text = fs.readFileSync(end, 'utf8')
      expect(body(text).flat()).not.toContain('A paragraph.')
      expect(await page.locator('.cm-tbl').count()).toBe(1)
    })

    it('a click on the blank line right under a table puts the caret in a paragraph after it, not in a new row', async () => {
      const wide = path.join(path.dirname(note), 'Wide.md')
      await page.locator('[role=treeitem]', { hasText: 'Wide' }).click()
      await page.waitForSelector('.cm-tbl')
      const box = (await page.locator('.cm-tbl').boundingBox())!
      await page.mouse.click(box.x + 40, box.y + box.height + 12)
      await page.keyboard.type('Typed.')
      await expect.poll(() => fs.readFileSync(wide, 'utf8').includes('Typed.')).toBe(true)
      const text = fs.readFileSync(wide, 'utf8')
      expect(body(text).flat()).not.toContain('Typed.')
      expect(text).toMatch(/\|\n\nTyped\.\n\nAfter\.\n$/)
    })

    it('a 13-column table stays in the text column and scrolls inside its box as one piece; the "+" controls hold still', async () => {
      const wide = path.join(path.dirname(note), 'Wide.md')
      await page.locator('[role=treeitem]', { hasText: 'Wide' }).click()
      await page.waitForSelector('.cm-tbl [data-col="12"]')
      type Spot = Record<
        | 'trackLeft'
        | 'trackRight'
        | 'boxLeft'
        | 'rowRight'
        | 'scrolls'
        | 'boxRight'
        | 'contentRight'
        | 'lineLeft'
        | 'first'
        | 'colX'
        | 'colY'
        | 'rowX'
        | 'rowY'
        | 'rowW'
        | 'boxW',
        number
      >
      const at = async (scroll: 'start' | 'middle' | 'end'): Promise<Spot> =>
        page.evaluate((where) => {
          const box = document.querySelector('.cm-tbl .cm-table-scroll') as HTMLElement
          const max = box.scrollWidth - box.clientWidth
          box.scrollLeft = where === 'start' ? 0 : where === 'middle' ? max / 2 : max
          const r = (sel: string): DOMRect => document.querySelector(sel)!.getBoundingClientRect()
          const sb = box.getBoundingClientRect()
          return {
            trackLeft: sb.left + box.clientLeft,
            trackRight: sb.left + box.clientLeft + box.clientWidth,
            boxLeft: sb.left,
            scrolls: max > 0 ? 1 : 0,
            boxRight: r('.cm-tbl .cm-table-scroll').right,
            contentRight: r('.cm-content').right,
            lineLeft: r('.cm-line').left,
            first: r('.cm-tbl td[data-col="0"]').left,
            colX: r('.cm-tbl-add-col').left,
            colY: r('.cm-tbl-add-col').top,
            rowX: r('.cm-tbl-add-row').left,
            rowY: r('.cm-tbl-add-row').top,
            rowW: r('.cm-tbl-add-row').width,
            rowRight: r('.cm-tbl-add-row').right,
            boxW: r('.cm-tbl .cm-table-scroll').width,
          }
        }, scroll)
      const start = await at('start')
      const middle = await at('middle')
      const end = await at('end')
      expect(start.scrolls).toBe(1)
      // In the text column: the cells start at its edge, the box ends inside it.
      expect(Math.abs(start.first - start.lineLeft)).toBeLessThan(2)
      expect(start.boxRight).toBeLessThanOrEqual(start.contentRight + 1)
      // The whole table moves; nothing is held.
      expect(start.first - end.first).toBeGreaterThan(300)
      // The "+" controls stay where they are, and the bar is as wide as the box.
      for (const p of [middle, end]) {
        expect([p.colX, p.colY, p.rowX, p.rowY]).toEqual([start.colX, start.colY, start.rowX, start.rowY])
      }
      // At every scroll position the bar and the scrollbar share the box's left and right edges.
      for (const p of [start, middle, end]) {
        expect(Math.abs(p.rowX - p.boxLeft)).toBeLessThanOrEqual(1)
        expect(Math.abs(p.rowRight - p.boxRight)).toBeLessThanOrEqual(1)
        expect(Math.abs(p.trackLeft - p.boxLeft)).toBeLessThanOrEqual(1)
        expect(Math.abs(p.trackRight - p.boxRight)).toBeLessThanOrEqual(1)
      }
      // And they work, scrolled to the end.
      await page.locator('.cm-tbl td[data-col="12"]').first().hover()
      await page.locator('.cm-tbl-add-col').click()
      await expect.poll(() => body(fs.readFileSync(wide, 'utf8'))[0]!.length).toBe(14)
      await page.keyboard.press('Escape')
      await at('middle')
      await page.locator('.cm-tbl-add-row').click()
      await expect.poll(() => body(fs.readFileSync(wide, 'utf8')).length).toBe(3)
      await page.keyboard.press('Escape')
    })
  })

  describe('typing next to a table', () => {
    const dir = (): string => path.dirname(note)
    /** Type key by key, checking after each one that the table is still drawn and no markdown of it shows. */
    const typeWatching = async (text: string): Promise<void> => {
      for (const key of text) {
        await page.keyboard.type(key)
        await sleep(60)
        expect(await page.locator('.cm-tbl').count()).toBe(1)
        expect(await page.locator('.cm-line', { hasText: '| ---' }).count()).toBe(0)
      }
    }

    beforeAll(() => {
      fs.writeFileSync(path.join(dir(), 'Ends.md'), '# Ends\n\n| Fruit | Qty |\n| ----- | --- |\n| Plum  | 3   |')
      fs.writeFileSync(path.join(dir(), 'Down.md'), '# Down\n\n| Fruit | Qty |\n| ----- | --- |\n| Plum  | 3   |\n')
      fs.writeFileSync(
        path.join(dir(), 'Middle.md'),
        '# Middle\n\nBefore.\n\n| Fruit | Qty |\n| ----- | --- |\n| Plum  | 3   |\n\nAfter.\n',
      )
    })

    it('dragging the row 2 handle to row 4 moves the row; only that handle is lit while dragging', async () => {
      const file = path.join(dir(), 'Five.md')
      fs.writeFileSync(file, '# Five\n\n| N   |\n| --- |\n| r1  |\n| r2  |\n| r3  |\n| r4  |\n| r5  |\n')
      await page.locator('[role=treeitem]', { hasText: 'Five' }).click()
      await page.waitForFunction(() => document.querySelector('.md__path')?.textContent === 'Five.md')
      await page.waitForSelector('.cm-tbl')
      await sleep(300)
      const grip = page.locator('.cm-tbl-grip--row[data-index="2"]')
      await page.locator('.cm-tbl td[data-row="2"]').hover()
      await grip.hover()
      const from = (await grip.boundingBox())!
      const target = (await page.locator('.cm-tbl td[data-row="4"]').boundingBox())!
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await page.mouse.down()
      await page.mouse.move(from.x + 2, from.y + 12, { steps: 4 })
      await page.mouse.move(from.x + 2, target.y + target.height - 3, { steps: 8 })
      const lit = await page.evaluate(
        () => [...document.querySelectorAll('.cm-tbl-grip')].filter((g) => Number(getComputedStyle(g).opacity) > 0.1).length,
      )
      expect(await page.locator('.cm-tbl-grip.is-dragged').count()).toBe(1)
      expect(lit).toBe(1)
      expect(await page.locator('.cm-tbl-drop--row').count()).toBe(1)
      await page.mouse.up()
      await expect.poll(() => body(fs.readFileSync(file, 'utf8')).map((r) => r[0])).toEqual(['N', 'r1', 'r3', 'r4', 'r2', 'r5'])
      expect(await page.locator('.cm-tbl-grip.is-dragged').count()).toBe(0)
    })

    it('a note ending with a table: click below it, type - a paragraph after a blank line, never raw source; one undo takes it back', async () => {
      const file = path.join(dir(), 'Ends.md')
      await page.locator('[role=treeitem]', { hasText: 'Ends' }).click()
      await page.waitForFunction(() => document.querySelector('.md__path')?.textContent === 'Ends.md')
      await page.waitForSelector('.cm-tbl')
      await sleep(300)
      const box = (await page.locator('.cm-tbl').boundingBox())!
      await page.mouse.click(box.x + 60, box.y + box.height + 40)
      await typeWatching('abc')
      await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('# Ends\n\n| Fruit | Qty |\n| ----- | --- |\n| Plum  | 3   |\n\nabc')
      expect(body(fs.readFileSync(file, 'utf8')).flat()).not.toContain('abc')
      // One undo per key; the first takes its blank line with it. The note keeps
      // the line break the caret needed after the table (not an edit).
      for (let i = 0; i < 3; i++) await page.keyboard.press('Meta+Z')
      await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('# Ends\n\n| Fruit | Qty |\n| ----- | --- |\n| Plum  | 3   |\n')
    })

    it('arrow down from the last row, type - the same', async () => {
      const file = path.join(dir(), 'Down.md')
      await page.locator('[role=treeitem]', { hasText: 'Down' }).click()
      await page.waitForFunction(() => document.querySelector('.md__path')?.textContent === 'Down.md')
      await page.waitForSelector('.cm-tbl')
      await sleep(300)
      await page.locator('.cm-tbl td[data-row="1"][data-col="0"]').click()
      await page.keyboard.press('ArrowDown')
      await typeWatching('abc')
      await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('# Down\n\n| Fruit | Qty |\n| ----- | --- |\n| Plum  | 3   |\n\nabc')
    })

    it('a table in the middle of a note: click the line under it, type - its own paragraph, the next one untouched', async () => {
      const file = path.join(dir(), 'Middle.md')
      await page.locator('[role=treeitem]', { hasText: 'Middle' }).click()
      await page.waitForFunction(() => document.querySelector('.md__path')?.textContent === 'Middle.md')
      await page.waitForSelector('.cm-tbl')
      await sleep(300)
      const box = (await page.locator('.cm-tbl').boundingBox())!
      await page.mouse.click(box.x + 60, box.y + box.height + 8)
      await typeWatching('abc')
      await expect
        .poll(() => fs.readFileSync(file, 'utf8'))
        .toBe('# Middle\n\nBefore.\n\n| Fruit | Qty |\n| ----- | --- |\n| Plum  | 3   |\n\nabc\n\nAfter.\n')
    })
  })

  describe('table menus', () => {
    const file = (): string => path.join(path.dirname(note), 'Menus.md')
    const read = (): string => fs.readFileSync(file(), 'utf8')
    const grip = (kind: 'row' | 'col', index: number) => page.locator(`.cm-tbl-grip--${kind}[data-index="${index}"]`)
    const openGrip = async (kind: 'row' | 'col', index: number): Promise<void> => {
      await page.locator(`.cm-tbl [data-row="${kind === 'row' ? index : 1}"][data-col="${kind === 'col' ? index : 0}"]`).hover()
      await grip(kind, index).hover()
      await grip(kind, index).click()
      await page.waitForSelector('.tmenu')
    }
    // Esc closes a table menu wherever the focus is.
    const close = async (): Promise<void> => {
      await page.keyboard.press('Escape')
      await expect.poll(() => page.locator('.tmenu').count()).toBe(0)
    }

    beforeAll(async () => {
      fs.writeFileSync(
        file(),
        '# Menus\n\n| A   | B   | C   |\n| --- | --- | --- |\n| 1   | x   | p   |\n| 2   | y   | q   |\n| 3   | z   | r   |\n',
      )
      await page.locator('[role=treeitem]', { hasText: 'Menus' }).click()
      await page.waitForFunction(() => document.querySelector('.md__path')?.textContent === 'Menus.md')
      await page.waitForSelector('.cm-tbl')
      await sleep(300)
    })

    it('a row handle opens the row menu only, marks its row, and previews inserts and deletes', async () => {
      await openGrip('row', 2)
      expect(await page.locator('.tmenu .tmenu__item', { hasText: 'column' }).count()).toBe(0)
      expect(await page.locator('.tmenu [aria-label="Insert row above"]').count()).toBe(1)
      expect(await page.locator('.cm-tbl-mark.is-target').count()).toBe(1)
      await page.locator('.tmenu [aria-label="Insert row below"]').hover()
      expect(await page.locator('.cm-tbl-mark.is-after').count()).toBe(1)
      await page.locator('.tmenu .tmenu__item', { hasText: 'Delete row' }).hover()
      expect(await page.locator('.cm-tbl-mark.is-delete').count()).toBe(1)
      expect(await page.locator('.tmenu .tmenu__item', { hasText: 'Move row down' }).locator('.tmenu__shortcut').textContent()).toBe('⌥↓')
      await close()
      expect(await page.locator('.cm-tbl-mark').count()).toBe(0)
    })

    it('a column handle opens the column menu; the active alignment clicked again goes back to default', async () => {
      await openGrip('col', 1)
      expect(await page.locator('.tmenu .tmenu__item', { hasText: 'row' }).count()).toBe(0)
      await page.locator('.tmenu [aria-label="Align right"]').click()
      await expect.poll(() => read().includes('| --: |')).toBe(true)
      await openGrip('col', 1)
      expect(await page.locator('.tmenu [aria-label="Align right"]').getAttribute('aria-checked')).toBe('true')
      await page.locator('.tmenu [aria-label="Align right"]').click()
      await expect.poll(() => read().includes('| --: |')).toBe(false)
    })

    it('the corner handle opens the table menu', async () => {
      await page.locator('.cm-tbl td[data-row="1"]').first().hover()
      await page.locator('.cm-tbl-corner').click()
      await page.waitForSelector('.tmenu')
      expect(await page.locator('.tmenu .tmenu__item').allTextContents()).toEqual([
        'Copy as Markdown',
        'Copy as TSV',
        'Edit as markdown',
        'Delete table',
      ])
      await close()
    })

    it('a right-click on a cell: Row ›, Column ›, Table ›, all by keyboard', async () => {
      await page.locator('.cm-tbl [data-row="1"][data-col="0"]').click({ button: 'right' })
      await page.waitForSelector('.tmenu')
      expect(await page.locator('.tmenu .tmenu__item').allTextContents()).toEqual(['Row', 'Column', 'Table'])
      // Open Row › from the keyboard, go to Move row down, run it.
      await page.locator('.tmenu .tmenu__item', { hasText: 'Row' }).focus()
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => page.locator('.tmenu').count()).toBe(2)
      await page.keyboard.press('ArrowDown') // Move row up (disabled for row 1, skipped) → Move row down
      await page.keyboard.press('Enter')
      await expect.poll(() => body(read()).map((r) => r[0])).toEqual(['A', '2', '1', '3'])
    })

    it('a header click opens its column menu and tints the column; a row grip selects its row', async () => {
      await page.locator('.cm-tbl th[data-row="0"][data-col="2"]').click()
      await page.waitForSelector('.tmenu')
      expect(await page.locator('.tmenu [aria-label="Align left"]').count()).toBe(1)
      expect(await page.locator('.cm-tbl-mark.is-target.is-col').count()).toBe(1)
      await close()
      await openGrip('row', 1)
      expect(await page.locator('.cm-tbl-mark.is-target.is-row').count()).toBe(1)
      await close()
    })

    it('typing in a cell is kept when a menu opens and closes without an action', async () => {
      await page.locator('.cm-tbl [data-row="3"][data-col="1"]').click()
      await page.keyboard.press('Meta+A')
      await page.keyboard.type('kept')
      await grip('row', 3).hover()
      await grip('row', 3).click()
      await page.waitForSelector('.tmenu')
      await close()
      await expect.poll(() => body(read())[3]![1]).toBe('kept')
    })

    it('a submenu without room on the right opens beside its menu, never on top of it', async () => {
      // Right-click far enough right that Row › cannot open to the right.
      const width = await page.evaluate(() => window.innerWidth)
      const cell = (await page.locator('.cm-tbl [data-row="1"][data-col="2"]').boundingBox())!
      await page.mouse.click(Math.min(cell.x + cell.width - 4, width - 330), cell.y + cell.height / 2, { button: 'right' })
      await page.waitForSelector('.tmenu')
      await page.locator('.tmenu .tmenu__item', { hasText: 'Row' }).hover()
      await expect.poll(() => page.locator('.tmenu').count()).toBe(2)
      await sleep(250) // past the open animation, which scales the menus
      const [parent, sub] = await page.evaluate(() =>
        [...document.querySelectorAll('.tmenu')].map((m) => m.getBoundingClientRect().toJSON()),
      )
      const overlap = Math.min(parent.right, sub.right) - Math.max(parent.left, sub.left)
      expect(overlap).toBeLessThanOrEqual(0)
      await close()

      // A narrow window: no room on the right at all - it opens on the left of the menu.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1000, 900))
      await sleep(400)
      const narrow = await page.evaluate(() => window.innerWidth)
      const c = (await page.locator('.cm-tbl [data-row="1"][data-col="2"]').boundingBox())!
      const x = c.x + c.width - 4
      // The menu fits at x, the submenu beside it does not.
      expect(x + 250 + 4 + 250).toBeGreaterThan(narrow)
      await page.mouse.click(x, c.y + c.height / 2, { button: 'right' })
      await page.waitForSelector('.tmenu')
      await page.locator('.tmenu .tmenu__item', { hasText: 'Row' }).hover()
      await expect.poll(() => page.locator('.tmenu').count()).toBe(2)
      await sleep(250)
      const [p2, s2] = await page.evaluate(() => [...document.querySelectorAll('.tmenu')].map((m) => m.getBoundingClientRect().toJSON()))
      expect(s2.right).toBeLessThanOrEqual(p2.left)
      await close()
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
      await sleep(400)
    })

    it('⌥↓ and ⌥→ move the row and the column of the cell being edited', async () => {
      await page.locator('.cm-tbl [data-row="1"][data-col="0"]').click()
      await page.keyboard.press('Alt+ArrowDown')
      await expect.poll(() => body(read()).map((r) => r[0])).toEqual(['A', '1', '2', '3'])
      await page.waitForSelector('.cm-tbl [data-row="2"][data-col="0"].is-editing')
      await page.keyboard.press('Alt+ArrowRight')
      await expect.poll(() => body(read())[0]).toEqual(['B', 'A', 'C'])
      await page.keyboard.press('Escape')
    })
  })
})
