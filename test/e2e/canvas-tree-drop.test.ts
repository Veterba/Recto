import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * A canvas opened from the file tree opens in Data, the tree beside it, and a
 * note dragged from the tree onto it lands as a note card. Runs with
 * `npm run test:e2e`.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')

describe.skipIf(!RUN)('a note dragged from the tree onto a canvas', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''
  const canvas = (): { nodes: { type: string; file?: string }[] } => JSON.parse(fs.readFileSync(path.join(vault, 'Sketch.canvas'), 'utf8'))

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-tree-drop-'))
    vault = path.join(base, 'vault')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    fs.writeFileSync(path.join(vault, 'Sketch.canvas'), JSON.stringify({ nodes: [], edges: [] }))
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

  it('lands as a card for that note', async () => {
    const row = (name: string) => page.locator('[role=treeitem]', { has: page.locator('.tree__name', { hasText: new RegExp(`^${name}$`) }) })
    await row('Sketch\\.canvas').click()
    await page.waitForSelector('.canvas-view__plane')
    // Still in Data: the tree is beside the canvas.
    await expect.poll(() => row('Ideas').isVisible()).toBe(true)
    // The drag as the browser hands it over: the tree's dragstart fills the data, the canvas reads it on drop.
    const from = await row('Ideas').elementHandle()
    const to = await page.locator('.canvas-view__plane').elementHandle()
    await page.evaluate(
      ([source, target]) => {
        const data = new DataTransfer()
        source!.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }))
        const box = target!.getBoundingClientRect()
        const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }
        for (const type of ['dragenter', 'dragover', 'drop'])
          target!.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data, ...at }))
        source!.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }))
      },
      [from, to] as const,
    )
    await expect.poll(() => canvas().nodes.map((n) => n.file), { timeout: 10_000 }).toEqual(['Ideas.md'])
    await page.locator('.react-flow__node', { hasText: 'Ideas' }).waitFor()
  }, 40_000)
})
