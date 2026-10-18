import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * The [[ link list, end to end: each row is a note's name with its folder
 * after it, Enter writes the whole link, and a name no note has yet gets a
 * last row that makes the note. Runs with `npm run test:e2e`; the window is
 * never shown.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')

describe.skipIf(!RUN)('link autocomplete', { timeout: 30_000 }, () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-links-'))
    vault = path.join(base, 'vault')
    fs.mkdirSync(path.join(vault, '.recto'), { recursive: true })
    fs.writeFileSync(path.join(vault, '.recto', 'topics-settings.json'), JSON.stringify({ enabled: false }))
    fs.mkdirSync(path.join(vault, 'Garden', 'Beds'), { recursive: true })
    fs.writeFileSync(path.join(vault, 'Garden', 'Beds', 'Raised beds.md'), '# Raised beds\n')
    fs.writeFileSync(path.join(vault, 'Draft.md'), '# Draft\n\nLinks: \n')
    fs.mkdirSync(path.join(base, 'profile'))
    fs.writeFileSync(path.join(base, 'profile', 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${path.join(base, 'profile')}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1' },
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    await page.locator('[role=treeitem]', { hasText: 'Draft' }).first().click()
    await page.waitForSelector('.md .cm-content')
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  const typeAtEnd = async (text: string): Promise<void> => {
    await page.locator('.cm-line', { hasText: 'Links:' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(text)
    await page.waitForSelector('.cm-tooltip-autocomplete li')
  }
  const saved = (): string => fs.readFileSync(path.join(vault, 'Draft.md'), 'utf8')

  it('shows the name with its folder, and Enter writes [[Note name]]', async () => {
    await typeAtEnd('[[rais')
    const row = page.locator('.cm-tooltip-autocomplete li').first()
    expect(await row.locator('.cm-completionLabel').innerText()).toBe('Raised beds')
    expect(await row.locator('.cm-completionPath').innerText()).toBe('Garden/Beds')
    // The glass layer, with no type icon.
    expect(await page.locator('.cm-tooltip-autocomplete.glass-surface').count()).toBe(1)
    expect(await page.locator('.cm-tooltip-autocomplete .cm-completionIcon').count()).toBe(0)
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator('.cm-line', { hasText: 'Links:' }).innerText()).toContain('[[Raised beds]]')
    await expect.poll(saved, { timeout: 5000 }).toContain('Links: [[Raised beds]]')
  })

  it('a name no note has gets a last row that makes the note', async () => {
    await typeAtEnd(' [[Compost')
    const last = page.locator('.cm-tooltip-autocomplete li').last()
    expect(await last.innerText()).toContain('Create “Compost”')
    await last.click()
    await expect.poll(saved, { timeout: 5000 }).toContain('[[Compost]]')
    await expect.poll(() => fs.existsSync(path.join(vault, 'Compost.md')), { timeout: 5000 }).toBe(true)
  })
})
