import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * Highlight colours as Obsidian writes them (==🔴text==): coloured in Live
 * Preview with the emoji hidden, the emoji still on disk; picked from the
 * toolbar's colour row; offered when typing ==; and the background starts
 * exactly where the text does, light and dark. Runs with `npm run test:e2e`.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const NOTE =
  '# Colours\n\nA ==plain== one, ==🔴red==, ==🟠orange==, ==🟡yellow==, ==🟢green==, ==🔵blue== and ==🟣purple==.\n\nEmpty line below.\n\nPick a word here.\n\nKeys: alpha ==🔴beta== gamma.\n'

describe.skipIf(!RUN)('highlight colours', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''
  const file = (): string => fs.readFileSync(path.join(vault, 'Colours.md'), 'utf8')

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-highlights-'))
    vault = path.join(base, 'vault')
    fs.mkdirSync(path.join(vault, '.recto'), { recursive: true })
    fs.writeFileSync(path.join(vault, '.recto', 'topics-settings.json'), JSON.stringify({ enabled: false }))
    fs.writeFileSync(path.join(vault, 'Colours.md'), NOTE)
    fs.mkdirSync(path.join(base, 'profile'))
    fs.writeFileSync(path.join(base, 'profile', 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${path.join(base, 'profile')}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1' },
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    await page.locator('[role=treeitem]', { hasText: 'Colours' }).first().click()
    await page.waitForSelector('.md .cm-content')
    // The caret away from the colours line, so it is drawn rendered.
    await page.locator('.cm-line', { hasText: 'Empty line below' }).click()
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it('each colour is drawn with the emoji hidden; the file keeps the emoji', async () => {
    for (const colour of ['red', 'orange', 'yellow', 'green', 'blue', 'purple']) {
      expect(await page.locator(`.cm-highlight--${colour}`).first().textContent()).toBe(colour)
    }
    expect(await page.locator('.cm-highlight:not([class*="--"])').first().textContent()).toBe('plain')
    const line = await page.locator('.cm-line', { hasText: 'A plain one' }).textContent()
    expect(line).not.toMatch(/[🔴🟠🟡🟢🔵🟣]|==/u)
    expect(file()).toBe(NOTE)
  }, 30_000)

  it('the background starts where the text starts, in light and in dark', async () => {
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
      await page.waitForTimeout(100)
      const gaps = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.cm-highlight')].map((mark) => {
          const text = [...mark.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent !== '')
          if (text === undefined) return 99
          const range = document.createRange()
          range.setStart(text, 0)
          range.setEnd(text, 1)
          const first = range.getBoundingClientRect()
          const box = mark.getBoundingClientRect()
          return Math.round(Math.abs(box.left - first.left) * 100) / 100
        }),
      )
      expect([theme, gaps.filter((g) => g >= 0.75)]).toEqual([theme, []])
    }
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
  }, 30_000)

  it('the toolbar colour row highlights a word, and recolours it by its emoji only', async () => {
    await page.locator('.cm-line', { hasText: 'Pick a word here' }).dblclick({ position: { x: 45, y: 6 } })
    const word = await page.evaluate(() => window.getSelection()?.toString())
    await page.locator('[aria-label="Highlight colour"]').click()
    await page.locator('[aria-label="Highlight blue"]').click()
    await expect.poll(file, { timeout: 5000 }).toContain(`==🔵${word}==`)
    // Caret still in it: green replaces the emoji, nothing else.
    await page.locator('[aria-label="Highlight colour"]').click()
    await page.locator('[aria-label="Highlight green"]').click()
    await expect.poll(file, { timeout: 5000 }).toContain(`==🟢${word}==`)
    expect(file().replace(`==🟢${word}==`, word ?? '')).toBe(NOTE)
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')
    await expect.poll(file, { timeout: 5000 }).toBe(NOTE)
  }, 30_000)

  it('the picker: ⌘⌥H then 3 makes the selection yellow, 0 makes a highlight default, Backspace removes it; ⌘⇧H toggles', async () => {
    const line = page.locator('.cm-line', { hasText: 'Keys:' })
    const select = async (word: string): Promise<void> => {
      // Select a word by its text, through the editor's own selection.
      await line.click()
      await page.evaluate((w) => {
        const node = [...document.querySelectorAll('.cm-line')].find((l) => l.textContent?.includes('Keys:'))!
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
        for (let t = walker.nextNode(); t !== null; t = walker.nextNode()) {
          const at = t.textContent!.indexOf(w)
          if (at === -1) continue
          const range = document.createRange()
          range.setStart(t, at)
          range.setEnd(t, at + w.length)
          const sel = window.getSelection()!
          sel.removeAllRanges()
          sel.addRange(range)
          return
        }
      }, word)
      await page.waitForTimeout(100)
    }
    const picker = page.getByRole('dialog', { name: 'Highlight colour' })

    await select('alpha')
    await page.keyboard.press('Meta+Alt+h')
    await picker.waitFor()
    // Above the selection.
    const box = (await picker.boundingBox())!
    const text = (await line.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(text.y + 2)
    await page.keyboard.press('3')
    await picker.waitFor({ state: 'detached' })
    await expect.poll(file, { timeout: 5000 }).toContain('Keys: ==🟡alpha== ==🔴beta== gamma.')
    // One undo step takes it all back.
    await page.keyboard.press('Meta+z')
    await expect.poll(file, { timeout: 5000 }).toContain('Keys: alpha ==🔴beta== gamma.')

    // The caret inside ==🔴beta==: the picker marks red, 0 makes it default.
    await select('beta')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Meta+Alt+h')
    await picker.waitFor()
    expect(await picker.locator('[aria-label="Highlight red"]').getAttribute('aria-pressed')).toBe('true')
    await page.keyboard.press('0')
    await expect.poll(file, { timeout: 5000 }).toContain('Keys: alpha ==beta== gamma.')

    // Backspace removes it.
    await page.keyboard.press('Meta+Alt+h')
    await picker.waitFor()
    await page.keyboard.press('Backspace')
    await expect.poll(file, { timeout: 5000 }).toContain('Keys: alpha beta gamma.')

    // ⌘⇧H: on, then off again.
    await select('gamma')
    await page.keyboard.press('Meta+Shift+h')
    await expect.poll(file, { timeout: 5000 }).toContain('Keys: alpha beta ==gamma==.')
    await page.keyboard.press('Meta+Shift+h')
    await expect.poll(file, { timeout: 5000 }).toContain('Keys: alpha beta gamma.')
    // Esc closes without a change.
    await page.keyboard.press('Meta+Alt+h')
    await picker.waitFor()
    await page.keyboard.press('Escape')
    await picker.waitFor({ state: 'detached' })
    expect(file()).toContain('Keys: alpha beta gamma.')
  }, 60_000)

  it('typing == offers the colours', async () => {
    await page.locator('.cm-line', { hasText: 'Empty line below' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' ==')
    const list = page.locator('.cm-tooltip-autocomplete')
    await list.waitFor({ timeout: 5000 })
    expect(await list.textContent()).toContain('Red')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.keyboard.type('new==')
    await expect.poll(file, { timeout: 5000 }).toContain('Empty line below. ==🟠new==')
  }, 30_000)
})
