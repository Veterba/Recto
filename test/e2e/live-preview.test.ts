import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * How Live Preview lays things out, in the running app: what a jsdom test
 * cannot see, since it draws nothing.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')

const NOTE = [
  '# Layout',
  '',
  '1. First',
  '2. ![[Ideas]]',
  '',
  '$$e^{i\\pi} + 1 = 0$$',
  '',
  'End.',
  '',
  '| Column 1 | Column 2 |',
  '| --- | --- |',
  '| a | b |',
  '',
  'After the table.',
  '',
].join('\n')

describe.skipIf(!RUN)('Live Preview layout', { timeout: 40_000 }, () => {
  let app: ElectronApplication
  let page: Page
  let base = ''

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-layout-'))
    const vault = path.join(base, 'vault')
    const profile = path.join(base, 'profile')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    fs.writeFileSync(path.join(vault, 'Layout.md'), NOTE)
    fs.mkdirSync(profile)
    fs.writeFileSync(path.join(profile, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${profile}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1', RECTO_BOTS_MOCK: '1', RECTO_CLI_DIRS: '/nonexistent' },
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    await page.getByRole('treeitem', { name: /Layout/ }).click()
    await page.waitForSelector('.cm-embed')
    await page.waitForSelector('.cm-math-block')
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it('a note embed in a numbered list keeps its label inside its card, clear of the number', async () => {
    const boxes = await page.locator('.cm-embed').evaluate((card) => {
      const r = (el: Element | Range): { left: number; right: number } => {
        const b = el.getBoundingClientRect()
        return { left: b.left, right: b.right }
      }
      const marker = [...card.closest('.cm-line')!.querySelectorAll('span')].find((s) => s.textContent === '2.')!
      // The text as drawn, not its box: a hanging indent moved the glyphs and left the box where it was.
      const glyphs = document.createRange()
      glyphs.selectNodeContents(card.querySelector('.cm-embed__label')!)
      return { card: r(card), label: r(glyphs), marker: r(marker) }
    })
    expect(boxes.label.left).toBeGreaterThanOrEqual(boxes.card.left)
    expect(boxes.card.left).toBeGreaterThanOrEqual(boxes.marker.right)
  })

  it('a table starts at the text column - where text and a selection start - not out to its left', async () => {
    const edges = await page.evaluate(() => {
      const text = document.createRange()
      text.selectNodeContents([...document.querySelectorAll('.cm-line')].find((l) => l.textContent === 'After the table.')!)
      return { text: text.getBoundingClientRect().left, table: document.querySelector('.cm-tbl table')!.getBoundingClientRect().left }
    })
    expect(Math.abs(edges.table - edges.text)).toBeLessThan(1)
  })

  it('`$$…$$` alone on its line is centred in the column', async () => {
    const { formula, column } = await page.locator('.cm-math-block').evaluate((block) => {
      const f = block.querySelector('.katex')!.getBoundingClientRect()
      const c = block.closest('.cm-line')!.getBoundingClientRect()
      return { formula: (f.left + f.right) / 2, column: (c.left + c.right) / 2 }
    })
    expect(Math.abs(formula - column)).toBeLessThan(4)
  })
})
