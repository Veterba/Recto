import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * A vault from before boards were notes (boards.json, cards with board and
 * status) opened in this version: the board note is made in tasks/, then
 * moved into Recto/ with its cards; each step's notice says what changed and
 * where the backup is, and the board is there. Runs with `npm run test:e2e`.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')

describe.skipIf(!RUN)('the boards migration on first open', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-migrate-'))
    vault = path.join(base, 'vault')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    fs.rmSync(path.join(vault, 'Recto'), { recursive: true })
    fs.cpSync(path.join(ROOT, 'test/fixtures/boards-before-0.52'), vault, { recursive: true })
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

  it('says what it made and where the backup is, and the board opens with its cards', async () => {
    const notice = page.getByRole('alertdialog', { name: 'Boards are notes now' })
    await notice.waitFor({ timeout: 20_000 })
    // Made straight in its own folder in Recto/Boards, never in a tasks/ folder in the root.
    await notice.getByText('Recto/Boards/Launch/Launch.md').waitFor()
    await notice.getByText(/\.recto\/backup\/\d{4}-\d{2}-\d{2}/).waitFor()
    expect(fs.existsSync(path.join(vault, '.recto', 'boards.json'))).toBe(false)
    await notice.getByRole('button', { name: 'OK' }).click()
    await notice.waitFor({ state: 'detached' })

    // Then, in the same open, the old tasks/ folder moves into Recto/: the cards go beside their board.
    const layout = page.getByRole('alertdialog', { name: 'Boards and chats moved' })
    await layout.waitFor({ timeout: 20_000 })
    expect(fs.existsSync(path.join(vault, 'tasks'))).toBe(false)
    expect(fs.readFileSync(path.join(vault, 'Recto/Boards/Launch/Record the demo.md'), 'utf8')).not.toMatch(/^(board|status|order):/m)
    expect(fs.readFileSync(path.join(vault, 'Recto/Boards/Launch/Launch.md'), 'utf8')).toContain('"new-note-folder":"Recto/Boards/Launch"')
    await layout.getByRole('button', { name: 'OK' }).click()
    await layout.waitFor({ state: 'detached' })

    await page.keyboard.press('Meta+3')
    await page.locator('.boards__row', { hasText: 'Launch' }).click()
    await page.locator('.board-col[aria-label="Done"] .board-card', { hasText: 'Design the icon' }).waitFor()
  }, 40_000)
})
