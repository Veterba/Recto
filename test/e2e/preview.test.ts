import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * The note preview card's lifecycle, with the real setting (two seconds):
 * a link clicked, a hotkey that changes the view, a row that goes away, the
 * pointer leaving - each puts the card away, or stops one on its way. And a
 * board's card shows its columns and how far along it is. Runs with
 * `npm run test:e2e`.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!RUN)('the preview card', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''
  const card = (): ReturnType<Page['locator']> => page.locator('.note-peek')
  const link = (name: string): ReturnType<Page['locator']> => page.locator('.cm-wikilink', { hasText: name })

  /** Open the note of links, with the caret on its title so every link is drawn as one. */
  async function openLinks(): Promise<void> {
    await page.keyboard.press('Meta+1')
    await page.locator('[role=treeitem]', { hasText: 'Links' }).click()
    await page.locator('.cm-line', { hasText: 'Links' }).first().click()
    await link('Handbook').waitFor()
    await page.mouse.move(5, 500)
  }

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-preview-'))
    vault = path.join(base, 'vault')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    fs.writeFileSync(path.join(vault, 'Links.md'), '# Links\n\nRead [[Handbook]], then the [[Launch]] board and [[Ideas]].\n')
    fs.writeFileSync(path.join(vault, 'Doomed.md'), '# Doomed\n\nA note that goes away.\n')
    fs.mkdirSync(path.join(base, 'profile'))
    fs.writeFileSync(path.join(base, 'profile', 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${path.join(base, 'profile')}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1' },
    })
    page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000))
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    await openLinks()
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it('opens after the delay, and goes when the pointer leaves for somewhere else', async () => {
    await link('Handbook').hover()
    await sleep(1500)
    expect(await card().count()).toBe(0)
    await card().waitFor({ timeout: 3000 })
    await page.mouse.move(5, 500)
    await card().waitFor({ state: 'detached', timeout: 1000 })
  }, 20_000)

  it('a link clicked before the delay is over: the note opens, and no card comes after it', async () => {
    await link('Handbook').hover()
    await sleep(500)
    await link('Handbook').click()
    await page.locator('.cm-line', { hasText: 'Handbook' }).first().waitFor()
    await sleep(3000)
    expect(await card().count()).toBe(0)
    await openLinks()
  }, 20_000)

  it('a link clicked while its card is up: the card goes with the click', async () => {
    await link('Handbook').hover()
    await card().waitFor({ timeout: 3000 })
    await link('Handbook').click()
    expect(await card().count()).toBe(0)
    await sleep(3000)
    expect(await card().count()).toBe(0)
    await openLinks()
  }, 20_000)

  it('a hotkey that changes the view before the delay is over: nothing appears', async () => {
    await link('Handbook').hover()
    await sleep(500)
    await page.keyboard.press('Meta+3')
    await sleep(2500)
    expect(await card().count()).toBe(0)
    await openLinks()
  }, 20_000)

  it("a tree row's card goes when the row does", async () => {
    const row = page.locator('[role=treeitem]', { hasText: 'Doomed' })
    await row.hover()
    await card().waitFor({ timeout: 3000 })
    fs.rmSync(path.join(vault, 'Doomed.md'))
    await row.waitFor({ state: 'detached', timeout: 5000 })
    await card().waitFor({ state: 'detached', timeout: 1000 })
    await page.mouse.move(5, 500)
  }, 20_000)

  it("a board's card: its columns with their card counts, and how far along it is", async () => {
    await link('Launch').hover()
    await card().waitFor({ timeout: 3000 })
    expect(await card().locator('.note-peek__lanes li').allTextContents()).toEqual(['To do2', 'Doing1/1', 'Done2'])
    expect(await card().locator('.note-peek__tasks').textContent()).toContain('2/5 done')
    // Not the note's frontmatter, not its headings.
    expect(await card().locator('.note-peek__props, .note-peek__outline').count()).toBe(0)
    await page.mouse.move(5, 500)
    await card().waitFor({ state: 'detached', timeout: 1000 })
  }, 20_000)
})
