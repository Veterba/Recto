import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/** The graph draws its notes, not only their count. Runs with `npm run test:e2e`. */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')

describe.skipIf(!RUN)('the graph', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-graph-'))
    const vault = path.join(base, 'vault')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    fs.mkdirSync(path.join(base, 'profile'))
    fs.writeFileSync(path.join(base, 'profile', 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${path.join(base, 'profile')}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1' },
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it('draws its notes, not only their count', async () => {
    await page.locator('[role=treeitem]', { hasText: 'Handbook' }).first().click()
    await page.keyboard.press('Meta+g')
    await page.waitForSelector('.graph__canvas')
    await page.waitForFunction(() => !document.querySelector('.graph__stat')?.textContent?.includes('settling'), null, { timeout: 30_000 })
    // Pixels drawn on the canvas, read back: an empty panel over the right counts is what this guards.
    const lit = (): Promise<number> =>
      page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('.graph__canvas canvas, canvas.graph__canvas')!
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
        let n = 0
        for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) n++
        return n
      })
    await expect.poll(lit, { timeout: 10_000 }).toBeGreaterThan(1000)
    expect(await page.locator('.graph__stat').textContent()).toMatch(/^12 · 12/)
  }, 40_000)
})
