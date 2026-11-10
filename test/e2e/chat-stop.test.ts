import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * An answer can always be stopped: typing the next question while it comes
 * keeps a Stop beside Send, and Esc stops it too. The model is the mock,
 * slowed (RECTO_BOTS_MOCK_DELAY) so there is time to type.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')

describe.skipIf(!RUN)('stopping an answer while typing the next question', { timeout: 60_000 }, () => {
  let app: ElectronApplication
  let page: Page
  let base = ''

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-stop-'))
    const vault = path.join(base, 'vault')
    const profile = path.join(base, 'profile')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    fs.mkdirSync(profile)
    fs.writeFileSync(path.join(profile, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${profile}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1', RECTO_BOTS_MOCK: '1', RECTO_BOTS_MOCK_DELAY: '250', RECTO_CLI_DIRS: '/nonexistent' },
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it('a Stop stays beside Send while the next question is typed, and it stops the answer', async () => {
    await page.keyboard.press('Meta+Shift+C')
    const input = page.locator('.bot-chat .composer__input')
    await input.waitFor()
    await input.click()
    await page.keyboard.type('How do I mix soil?')
    await page.keyboard.press('Enter')
    await page.waitForSelector('.bot-chat .msg--bot')
    // The next question, typed while the answer is still coming.
    await page.keyboard.type('And for pots?')
    const stop = page.locator('.bot-chat .composer').getByRole('button', { name: 'Stop' })
    await stop.waitFor({ timeout: 5000 })
    expect(await page.locator('.bot-chat .composer').getByRole('button', { name: 'Send' }).count()).toBe(1)
    // The panel redraws with every word coming in, so Playwright never sees the button "stable" - and a click by
    // position can land on Send as the row shifts. The Stop button itself is clicked.
    await stop.evaluate((button) => (button as HTMLButtonElement).click())
    // Stopped: no Stop left, and the typed question still there to send.
    await expect.poll(() => stop.count(), { timeout: 10_000 }).toBe(0)
    expect(await input.inputValue()).toBe('And for pots?')
  })
})
