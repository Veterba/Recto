import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * A new card or board whose name a note has elsewhere is a choice, never a
 * guess: add that note to the board as it is, or choose another name. The
 * check reads the disk, so a note the index has not seen yet counts too, and
 * nothing is overwritten, reused or made twice. Runs with `npm run test:e2e`.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const BOARD = 'Recto/Boards/Launch/Launch.md'
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > ms) throw new Error('Timed out waiting.')
    await sleep(100)
  }
}

describe.skipIf(!RUN)('a name a note has already', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''
  const read = (rel: string): string => fs.readFileSync(path.join(vault, rel), 'utf8')
  const walk = (dir: string, rel = ''): string[] =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => (e.name.startsWith('.') ? [] : e.isDirectory() ? walk(path.join(dir, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`]))
  const popover = (): ReturnType<Page['locator']> => page.locator('.new-card')
  const title = (): ReturnType<Page['locator']> => page.locator('.new-card__title')

  async function typeCard(name: string): Promise<void> {
    if ((await popover().count()) === 0) await page.locator('.board-col').first().getByRole('button', { name: /^New card in/ }).click()
    await title().fill(name)
    await title().press('Enter')
  }

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-dup-'))
    vault = path.join(base, 'vault')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    fs.mkdirSync(path.join(base, 'profile'))
    fs.writeFileSync(path.join(base, 'profile', 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${path.join(base, 'profile')}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1' },
    })
    page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000))
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    await page.keyboard.press('Meta+3')
    await page.locator('.boards__row', { hasText: 'Launch' }).first().click()
    await page.locator('.board-card').first().waitFor()
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it('a card: the same choice whatever the case, and for a note the index has not seen yet', async () => {
    const before = walk(vault)
    const boardBefore = read(BOARD)
    for (const name of ['Basil', 'basil']) {
      await typeCard(name)
      await page.locator('.new-card__exists').waitFor()
      expect(await page.locator('.new-card__exists .new-card__taken').textContent()).toBe('A note “Basil” already exists in Garden/. Add it to this board?')
      await page.getByRole('button', { name: 'Choose another name' }).click()
    }
    // Written a moment ago, before the index could read it.
    fs.writeFileSync(path.join(vault, 'Garden', 'Fresh.md'), 'x\n')
    await typeCard('Fresh')
    await page.locator('.new-card__exists', { hasText: 'A note “Fresh” already exists in Garden/.' }).waitFor()
    await page.keyboard.press('Escape')
    // A name with "/" is refused, never made "Basil Soil".
    await typeCard('Basil/Soil')
    await page.locator('.new-card [role=alert]', { hasText: '“/” can\'t be used in a name' }).waitFor()
    await page.keyboard.press('Escape')
    expect(walk(vault).filter((f) => !before.includes(f))).toEqual(['Garden/Fresh.md'])
    expect(read(BOARD)).toBe(boardBefore)
  }, 40_000)

  it('“Add it to this board” adds [[X]] as a card and leaves the file where it is', async () => {
    await typeCard('Basil')
    await page.getByRole('button', { name: 'Add it to this board' }).click()
    await until(() => read(BOARD).includes('- [ ] [[Basil]]'))
    expect(read('Garden/Basil.md')).toBe(fs.readFileSync(path.join(ROOT, 'test/fixtures/snapshot-vault/Garden/Basil.md'), 'utf8'))
    expect(fs.existsSync(path.join(vault, 'Recto/Boards/Launch/Basil.md'))).toBe(false)
    await page.locator('.board-card', { hasText: 'Basil' }).waitFor()
    // A second time: it is on the board already, so it is said, not added twice.
    await typeCard('Basil')
    await page.getByRole('button', { name: 'Add it to this board' }).click()
    await page.locator('.new-card [role=alert]', { hasText: 'is on this board already' }).waitFor()
    await page.keyboard.press('Escape')
    expect(read(BOARD).match(/\[\[Basil\]\]/g)).toHaveLength(1)
  }, 30_000)

  it('a new board: the note that has the name is said, with “Choose another name”', async () => {
    await page.locator('.boards__add').click()
    const field = page.getByRole('textbox', { name: 'New board name' })
    await field.fill('Soil')
    await field.press('Enter')
    await page.locator('.boards__taken', { hasText: 'A note “Soil” already exists in Garden/.' }).waitFor()
    expect(fs.existsSync(path.join(vault, 'Recto/Boards/Soil'))).toBe(false)
    await page.getByRole('button', { name: 'Choose another name' }).click()
    await field.fill('Soil plan')
    await field.press('Enter')
    await until(() => fs.existsSync(path.join(vault, 'Recto/Boards/Soil plan/Soil plan.md')))
    expect(read('Garden/Soil.md')).toBe(fs.readFileSync(path.join(ROOT, 'test/fixtures/snapshot-vault/Garden/Soil.md'), 'utf8'))
  }, 30_000)
})
