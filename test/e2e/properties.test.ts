import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * Typing in the properties above a note, in the running app on a copy of the
 * fixture vault. A value used to be written on every key: the field lost focus
 * after the first one, the keys after it went nowhere, and spaces were trimmed
 * away as they were typed.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')

describe.skipIf(!RUN)('properties', { timeout: 40_000 }, () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''
  const handbook = (): string => fs.readFileSync(path.join(vault, 'Handbook.md'), 'utf8')

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-props-'))
    vault = path.join(base, 'vault')
    const profile = path.join(base, 'profile')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    fs.mkdirSync(profile)
    fs.writeFileSync(path.join(profile, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${profile}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1', RECTO_BOTS_MOCK: '1', RECTO_CLI_DIRS: '/nonexistent' },
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    await page.getByRole('treeitem', { name: /Handbook/ }).click()
    await page.waitForSelector('.props__head')
    await page.locator('.props__head').click()
    await page.waitForSelector('.prop__input')
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it('a text value keeps focus and every key while typed, spaces included, and is written on Enter', async () => {
    await page.locator('.prop__input').nth(2).click()
    await page.keyboard.press('End')
    // Pauses longer than the editor's save debounce: each key used to be a write.
    for (const key of ' in progress') {
      await page.keyboard.type(key)
      await page.waitForTimeout(150)
    }
    // End moves the caret, not the note: scrolled away, the properties left the screen with the field.
    expect(await page.locator('.cm-scroller').evaluate((e) => e.scrollTop)).toBe(0)
    expect(await page.evaluate(() => document.activeElement?.classList.contains('prop__input'))).toBe(true)
    // Nothing written while typing.
    expect(handbook()).toContain('status: draft\n')
    await page.keyboard.press('Enter')
    await expect.poll(handbook).toContain('status: draft in progress\n')
  })

  it('Escape drops what was typed', async () => {
    await page.locator('.prop__input').nth(2).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' and more')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    expect(handbook()).toContain('status: draft in progress\n')
    expect(await page.locator('.prop__input').nth(2).inputValue()).toBe('draft in progress')
  })

  it('a list value keeps a space inside an item and is written on blur', async () => {
    await page.locator('.prop__input').nth(1).click()
    await page.keyboard.press('End')
    await page.keyboard.type(', field notes')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await expect.poll(handbook).toContain('tags: [handbook, reference, field notes]\n')
  })

  it('the note does not jump while a property is changed', async () => {
    const top = await page.locator('.cm-scroller').evaluate((e) => e.scrollTop)
    await page.locator('.prop__input').nth(2).click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await page.keyboard.press('Enter')
    await expect.poll(handbook).toContain('status: draft in progress!\n')
    expect(await page.locator('.cm-scroller').evaluate((e) => e.scrollTop)).toBe(top)
  })

  it('a description under the title is the description property, written on Enter, and not a row', async () => {
    const description = page.getByRole('textbox', { name: 'Description' })
    // Empty, it takes no room: pointing at the title opens it.
    await page.locator('.note-title__input').hover()
    await description.click()
    await page.keyboard.type('Where the editor is put through its paces')
    await page.keyboard.press('Enter')
    await expect.poll(handbook).toContain('description: Where the editor is put through its paces\n')
    expect(await page.locator('.prop__keyname', { hasText: /^description$/ }).count()).toBe(0)
    // Emptied, the property goes.
    await description.click()
    await page.keyboard.press('Meta+a')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Enter')
    await expect.poll(handbook).not.toContain('description:')
  })

  it('a property is added by its type, then its name; a URL opens from its button; its type is the vault’s', async () => {
    await page.locator('.props__add').click()
    await page.getByRole('menu', { name: 'Property type' }).getByRole('menuitem', { name: 'URL' }).click()
    const name = page.getByRole('textbox', { name: 'Property name' })
    // The name starts as the type's, selected: typed over.
    await page.keyboard.type('Site')
    await page.keyboard.press('Enter')
    await expect.poll(handbook).toContain('\nSite:\n')
    expect(await name.count()).toBe(0)
    const row = page.locator('.prop', { has: page.locator('.prop__keyname', { hasText: /^Site$/ }) })
    await row.locator('input[type=url]').click()
    await page.keyboard.type('https://example.org/guide')
    await page.keyboard.press('Enter')
    await expect.poll(handbook).toContain('Site: https://example.org/guide\n')
    await row.getByRole('button', { name: 'Open the address' }).waitFor()
    const settings = (): unknown => JSON.parse(fs.readFileSync(path.join(vault, '.recto', 'properties.json'), 'utf8'))
    await expect.poll(settings).toEqual({ types: { Site: 'url' } })

    // From its icon, another type: the value kept where it can be.
    await row.getByRole('button', { name: 'Type of Site' }).click()
    await page.getByRole('menu', { name: 'Property type' }).getByRole('menuitem', { name: 'Text' }).click()
    await expect.poll(settings).toEqual({ types: { Site: 'text' } })
    expect(handbook()).toContain('Site: https://example.org/guide\n')
    expect(await row.getByRole('button', { name: 'Open the address' }).count()).toBe(0)
  })

  it('a card changed on its board shows in its open note, whose next save keeps it', async () => {
    const card = 'Recto/Boards/Launch/Write the announcement.md'
    const file = (): string => fs.readFileSync(path.join(vault, card), 'utf8')
    await page.keyboard.press('Meta+o')
    await page.keyboard.type('Write the announcement')
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    // A card opens on its board, in the card panel; from there, as a note.
    await page.getByText('Open as note').click()
    await page.waitForFunction(() => document.querySelector('.props__summary')?.textContent?.includes('priority high') === true)
    // What the board's card panel does: read the card, change a field, write it (use-board-cards editCard).
    await page.evaluate(
      async ([p, text]) => {
        const api = (window as unknown as { api: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }).api
        await api.invoke('fs:write', p, text)
      },
      [card, file().replace('priority: high', 'priority: low')] as const,
    )
    await page.waitForFunction(() => document.querySelector('.props__summary')?.textContent?.includes('priority low') === true, undefined, {
      timeout: 5000,
    })
    await page.locator('.cm-content').first().focus()
    await page.keyboard.press('Meta+End')
    await page.keyboard.type(' more')
    await expect.poll(file, { timeout: 5000 }).toContain(' more')
    expect(file()).toContain('priority: low')
  })
})
