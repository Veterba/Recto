import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * Links to a canvas, end to end: the [[ list offers the canvas with its icon,
 * Enter writes [[Name.canvas]], Live Preview shows the name without the
 * extension, and a click on the link opens the canvas - with or without an
 * alias. Runs with `npm run test:e2e`; the window is never shown.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')

describe.skipIf(!RUN)('canvas links', { timeout: 30_000 }, () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-canvas-links-'))
    vault = path.join(base, 'vault')
    fs.mkdirSync(path.join(vault, '.recto'), { recursive: true })
    fs.writeFileSync(path.join(vault, '.recto', 'topics-settings.json'), JSON.stringify({ enabled: false }))
    fs.mkdirSync(path.join(vault, 'Recto', 'Canvas'), { recursive: true })
    fs.writeFileSync(
      path.join(vault, 'Recto', 'Canvas', 'Garden map.canvas'),
      JSON.stringify({ nodes: [{ id: 'a1b2c3d4e5f60718', type: 'text', text: 'Beds', x: 0, y: 0, width: 260, height: 140 }], edges: [] }),
    )
    fs.writeFileSync(path.join(vault, 'Draft.md'), '# Draft\n\nPlain: [[Garden map.canvas]]\n\nAliased: [[Garden map.canvas|the map]]\n\nLinks: \n')
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

  const openDraft = async (): Promise<void> => {
    await page.locator('[role=treeitem]', { hasText: 'Draft' }).first().click()
    await page.waitForSelector('.md .cm-content')
    // The caret on the heading, so the link lines are rendered.
    await page.locator('.cm-line', { hasText: 'Draft' }).first().click()
  }
  const saved = (): string => fs.readFileSync(path.join(vault, 'Draft.md'), 'utf8')
  const canvasOpen = (): Promise<number> => page.locator('.react-flow__viewport').count()

  it('a plain canvas link shows its name without .canvas, with the canvas icon, and opens the canvas', async () => {
    await openDraft()
    const link = page.locator('.cm-line', { hasText: 'Plain:' }).locator('.cm-wikilink')
    await expect.poll(() => link.innerText()).toBe('Garden map')
    expect(await link.locator('.cm-link-icon--canvas').count()).toBe(1)
    await link.click()
    await expect.poll(canvasOpen, { timeout: 10_000 }).toBe(1)
  })

  it('an aliased canvas link opens the canvas too', async () => {
    await openDraft()
    const link = page.locator('.cm-line', { hasText: 'Aliased:' }).locator('.cm-wikilink')
    await expect.poll(() => link.innerText()).toBe('the map')
    await link.click()
    await expect.poll(canvasOpen, { timeout: 10_000 }).toBe(1)
  })

  it('the [[ list offers the canvas with its icon, and Enter writes [[Name.canvas]]', async () => {
    await openDraft()
    await page.locator('.cm-line', { hasText: 'Links:' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('[[Garden m')
    const row = page.locator('.cm-tooltip-autocomplete li').first()
    await row.waitFor()
    expect(await row.locator('.cm-completionLabel').innerText()).toBe('Garden map')
    expect(await row.locator('.cm-link-icon--canvas').count()).toBe(1)
    await page.keyboard.press('Enter')
    await expect.poll(saved, { timeout: 5000 }).toContain('Links: [[Garden map.canvas]]')
  })
})
