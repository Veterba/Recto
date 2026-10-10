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
    await page.locator('.menu .menu__item', { hasText: label }).click()
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

    it('a 13-column table stays in the text column and scrolls inside its box, first column held', async () => {
      await page.locator('[role=treeitem]', { hasText: 'Wide' }).click()
      await page.waitForSelector('.cm-tbl [data-col="12"]')
      const m = await page.evaluate(() => {
        const content = document.querySelector('.cm-content')!.getBoundingClientRect()
        const line = document.querySelector('.cm-line')!.getBoundingClientRect()
        const scroll = document.querySelector('.cm-tbl .cm-table-scroll') as HTMLElement
        const first = () => document.querySelector('.cm-tbl td[data-col="0"]')!.getBoundingClientRect().left
        const fifth = () => document.querySelector('.cm-tbl td[data-col="4"]')!.getBoundingClientRect().left
        const before = { first: first(), fifth: fifth() }
        scroll.scrollLeft = 400
        const after = { first: first(), fifth: fifth() }
        return {
          lineLeft: line.left,
          contentRight: content.right,
          box: scroll.getBoundingClientRect(),
          scrolls: scroll.scrollWidth > scroll.clientWidth,
          pageScrolls: document.querySelector('.cm-scroller')!.scrollWidth > document.querySelector('.cm-scroller')!.clientWidth + 1,
          before,
          after,
        }
      })
      expect(m.scrolls).toBe(true)
      expect(m.pageScrolls).toBe(false)
      // The cells start at the text column; the box ends inside it.
      expect(Math.abs(m.before.first - m.lineLeft)).toBeLessThan(2)
      expect(m.box.right).toBeLessThanOrEqual(m.contentRight + 1)
      // Scrolled: the first column stays, the fifth moved.
      expect(m.after.first).toBe(m.before.first)
      expect(m.before.fifth - m.after.fifth).toBeGreaterThan(300)
    })
  })
})
