import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * A wide table, like the eval reports' index: it grows past the text column
 * instead of breaking its words letter by letter, keeps `[[path|alias]]` in
 * one cell, and its links open their notes. The page never scrolls sideways.
 * Runs with `npm run test:e2e`; the window is never shown.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!RUN)('tables', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-tables-'))
    const vault = path.join(base, 'Table vault')
    fs.mkdirSync(path.join(vault, '.recto'), { recursive: true })
    fs.mkdirSync(path.join(vault, 'Evals', 'qwen3.5-9b'), { recursive: true })
    fs.writeFileSync(path.join(vault, 'Evals', 'qwen3.5-9b', 'Eval 2026-10-03 17-53 — B final.md'), '# B final\n\nThe report.\n')
    fs.cpSync(path.join(ROOT, 'test/fixtures/tables/Eval runs.md'), path.join(vault, 'Eval runs.md'))
    fs.appendFileSync(
      path.join(vault, 'Eval runs.md'),
      '\n| Date | Model | Report |\n|---|---|---|\n| 2026-10-03 17-53 | qwen3.5:9b | [[Evals/qwen3.5-9b/Eval 2026-10-03 17-53 — B final|B final report]] |\n',
    )
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
    await page.locator('[role=treeitem]', { hasText: 'Eval runs' }).click()
    await page.waitForSelector('.cm-table')
    await sleep(500)
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    fs.rmSync(base, { recursive: true, force: true })
  })

  it('grows past the text column, never breaks a short value, never scrolls the page sideways', async () => {
    const m = await page.evaluate(() => {
      const table = document.querySelector('.cm-table')!
      const column = document.querySelector('.cm-content')!.getBoundingClientRect()
      const scroller = document.querySelector('.cm-scroller')!
      const cells = [...table.querySelectorAll('td.cm-cell-nowrap')]
      // The lines a cell's text sits on: its text boxes' distinct tops.
      const lines = (cell: Element): number => {
        const range = document.createRange()
        range.selectNodeContents(cell)
        return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size
      }
      const broken = cells.filter((c) => lines(c) > 1).map((c) => c.textContent)
      return {
        tableWidth: table.getBoundingClientRect().width,
        columnWidth: column.width,
        pageScrollsSideways: scroller.scrollWidth > scroller.clientWidth + 1,
        broken,
        cells: table.querySelectorAll('tbody tr:first-child td').length,
      }
    })
    expect(m.tableWidth).toBeGreaterThan(m.columnWidth)
    expect(m.pageScrollsSideways).toBe(false)
    expect(m.broken).toEqual([])
    expect(m.cells).toBe(8)
  })

  it('keeps [[path|alias]] in one cell and opens its note', async () => {
    const tables = page.locator('.cm-table')
    const last = tables.nth((await tables.count()) - 1)
    await expect.poll(() => last.locator('tbody tr:first-child td').count()).toBe(3)
    const link = last.locator('.cm-wikilink', { hasText: 'B final report' })
    await link.click()
    await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('The report.') === true, null, {
      timeout: 10_000,
    })
  }, 30_000)
})
