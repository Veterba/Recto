import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterEach, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * ⌘Q, or closing the window, in the half second after typing: the words are
 * in the file. A note saves half a second after the last key, and quitting
 * in that moment used to lose them. On a copy of the fixture vault.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')

describe.skipIf(!RUN)('typing right before the app goes', { timeout: 90_000 }, () => {
  let app: ElectronApplication | undefined
  let base = ''
  afterEach(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  async function open(): Promise<{ page: Page; note: string }> {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-quit-'))
    const vault = path.join(base, 'vault')
    const profile = path.join(base, 'profile')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    const note = path.join(vault, 'Quit.md')
    fs.writeFileSync(note, '# Quit\n\nStart.\n')
    fs.mkdirSync(profile)
    fs.writeFileSync(path.join(profile, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${profile}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1', RECTO_BOTS_MOCK: '1', RECTO_CLI_DIRS: '/nonexistent' },
    })
    const page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    await page.locator('[role=treeitem]', { hasText: 'Quit' }).first().click()
    await page.locator('.cm-content').click()
    await page.keyboard.press('Meta+ArrowDown')
    return { page, note }
  }

  it('quit at once: what was typed is saved', async () => {
    const { page, note } = await open()
    await page.keyboard.type(' Typed before quit.')
    const gone = new Promise((done) => app!.process().once('exit', done))
    await app!.evaluate(({ app: electronApp }) => electronApp.quit())
    await gone
    app = undefined
    expect(fs.readFileSync(note, 'utf8')).toContain('Typed before quit.')
  })

  it('the window closed at once: what was typed is saved', async () => {
    const { page, note } = await open()
    await page.keyboard.type(' Typed before close.')
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    await expect.poll(() => fs.readFileSync(note, 'utf8'), { timeout: 5000 }).toContain('Typed before close.')
  })
})
