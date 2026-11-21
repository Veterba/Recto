import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * A bare web address in a note - a YouTube one, after other words - stays text
 * in Live Preview, drawn as a link: there to select and copy, as Obsidian keeps it. Runs with
 * `npm run test:e2e`.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const URL = 'https://www.youtube.com/watch?v=iwJZnWGUfcM'

describe.skipIf(!RUN)('a web address in a note', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-url-'))
    const vault = path.join(base, 'vault')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    fs.writeFileSync(path.join(vault, 'Films.md'), `# Films\n\nLink: ${URL}\n\n${URL}\n\nThe end.\n`)
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

  it('stays text that can be selected, after other words and on a line of its own', async () => {
    await page.locator('[role=treeitem]', { hasText: 'Films' }).first().click()
    await page.locator('.cm-line', { hasText: 'The end.' }).click()
    const shown = await page.locator('.md .cm-line').allTextContents()
    expect(shown).toContain(`Link: ${URL}`)
    expect(shown).toContain(URL)
    // Drawn as a link, its address in it.
    expect(await page.locator('.md .cm-mdlink', { hasText: URL }).count()).toBe(2)
    // Its letters are text in the page, so a selection over them reads them back - the empty block
    // it used to be had nothing to select. (Copying itself is the browser's; this window is never
    // focused, so ⌘C here would reach the app's own copy.)
    const selected = await page.evaluate((url) => {
      const link = [...document.querySelectorAll('.md .cm-mdlink')].find((el) => el.textContent === url)!
      const range = document.createRange()
      range.selectNodeContents(link)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      return selection.toString()
    }, URL)
    expect(selected).toBe(URL)
  }, 40_000)
})
