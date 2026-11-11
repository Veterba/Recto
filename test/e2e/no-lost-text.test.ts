import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * What is typed is never lost: not to another app writing the note in the
 * moment before Recto saves it (sync, Obsidian), and not to leaving a canvas
 * card mid-word. Driven like a person would, on a copy of the fixture vault.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')

describe.skipIf(!RUN)('no typed text is lost', { timeout: 60_000 }, () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''
  const file = (rel: string): string => path.join(vault, rel)
  const read = (rel: string): string => fs.readFileSync(file(rel), 'utf8')
  /** Type at the very end of the open note. */
  const typeAtEnd = async (text: string): Promise<void> => {
    await page.locator('.cm-content').click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type(text)
  }

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-lost-'))
    vault = path.join(base, 'vault')
    const profile = path.join(base, 'profile')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    fs.writeFileSync(file('Merge.md'), '# Merge\n\nFirst line.\n\nSecond line.\n')
    fs.writeFileSync(file('Clash.md'), '# Clash\n\nOnly line\n')
    fs.mkdirSync(file('Recto/Canvas'), { recursive: true })
    fs.writeFileSync(
      file('Recto/Canvas/Draft.canvas'),
      JSON.stringify({ nodes: [{ id: 'a1b2c3d4e5f60001', type: 'text', text: 'Card', x: 0, y: 0, width: 260, height: 120 }], edges: [] }),
    )
    fs.mkdirSync(profile)
    fs.writeFileSync(path.join(profile, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${profile}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1', RECTO_BOTS_MOCK: '1', RECTO_CLI_DIRS: '/nonexistent' },
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it('another app writes a different line before Recto saves: both are kept', async () => {
    await page.getByRole('treeitem', { name: /^Merge/ }).click()
    await page.locator('.cm-line', { hasText: 'Second line.' }).waitFor()
    // The note ends with a newline: the caret at its end is on the empty last line.
    await typeAtEnd('Typed here.')
    // Inside the half second before the save: the phone's sync changes the first line.
    fs.writeFileSync(file('Merge.md'), '# Merge\n\nFirst line, from the phone.\n\nSecond line.\n')
    await expect.poll(() => read('Merge.md'), { timeout: 10_000 }).toBe('# Merge\n\nFirst line, from the phone.\n\nSecond line.\nTyped here.')
    await expect.poll(() => page.locator('.cm-line', { hasText: 'from the phone' }).count()).toBe(1)
  })

  it('both change the same line: the typing stays, and says the other version is in History', async () => {
    await page.getByRole('treeitem', { name: /^Clash/ }).click()
    const only = page.locator('.cm-line', { hasText: 'Only line' })
    await only.waitFor()
    // At the end of that very line - the one the other app changes too.
    await only.click()
    await page.keyboard.press('Meta+ArrowRight')
    await page.keyboard.type(' - mine')
    fs.writeFileSync(file('Clash.md'), '# Clash\n\nOnly line - theirs\n')
    await page.locator('.note-title__notice', { hasText: 'changed in another app' }).waitFor({ timeout: 10_000 })
    await expect.poll(() => read('Clash.md'), { timeout: 10_000 }).toBe('# Clash\n\nOnly line - mine\n')
  })

  it('a canvas card left mid-word, by closing its tab, keeps what was typed', async () => {
    await page.getByRole('tab', { name: 'Canvas' }).click()
    await page.locator('.boards__row', { hasText: 'Draft' }).click()
    const card = page.locator('.react-flow__node[data-id="a1b2c3d4e5f60001"]')
    await card.dblclick()
    // Typed into the card's own editor, once it is open - not wherever the focus was before.
    const editor = card.locator('.cm-content')
    await editor.waitFor()
    await editor.click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type(' typed before leaving')
    await expect.poll(() => card.innerText()).toContain('Card typed before leaving')
    // The tab closed at once: no Esc, no click on the canvas.
    await page.keyboard.press('Meta+w')
    await expect.poll(() => read('Recto/Canvas/Draft.canvas'), { timeout: 10_000 }).toContain('Card typed before leaving')
  })
})
