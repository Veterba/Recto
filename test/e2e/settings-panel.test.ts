import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * The Settings panel on a copy of the fixture vault: it floats over the app
 * without a backdrop, takes focus and gives it back, moves and resizes within
 * the window, comes back where it was after a relaunch, searches across
 * sections with the real controls in the results, dims settings whose parent
 * is off, and turns solid with translucency off. Runs with `npm run test:e2e`.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

type Box = { x: number; y: number; width: number; height: number }

describe.skipIf(!RUN)('the settings panel', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''

  const launch = async (): Promise<void> => {
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${path.join(base, 'profile')}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1' },
    })
    page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
  }

  const panel = (): ReturnType<Page['locator']> => page.locator('.settings-panel')
  const box = async (): Promise<Box> => (await panel().boundingBox())!
  const open = async (): Promise<void> => {
    await page.keyboard.press('Meta+,')
    await panel().waitFor()
    await sleep(250) // its entrance scales it, which would skew every measurement
  }
  const section = async (name: string): Promise<void> => {
    await panel()
      .getByRole('tab', { name: new RegExp(`^${name}`) })
      .click()
  }
  const focusInPanel = (): Promise<boolean> =>
    page.evaluate(() => document.querySelector('.settings-panel')?.contains(document.activeElement) === true)
  /** A press and a move in steps, so pointer handlers see a real drag. */
  const drag = async (from: { x: number; y: number }, dx: number, dy: number): Promise<void> => {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 })
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 })
    await page.mouse.up()
  }

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-settings-'))
    vault = path.join(base, 'vault')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    fs.mkdirSync(path.join(base, 'profile'))
    fs.writeFileSync(path.join(base, 'profile', 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    await launch()
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it('opens without a backdrop, takes focus, keeps it on a second ⌘, and gives it back on Esc', async () => {
    const outside = page.locator('.status [aria-label="Command palette"]')
    await outside.focus()
    await open()
    expect(await page.locator('.dialog__backdrop').count()).toBe(0)
    expect(await focusInPanel()).toBe(true)

    // The app behind stays usable: a click there takes focus away, ⌘, brings it back.
    await outside.focus()
    expect(await focusInPanel()).toBe(false)
    await page.keyboard.press('Meta+,')
    await page.waitForFunction(() => document.querySelector('.settings-panel')?.contains(document.activeElement) === true)
    expect(await panel().count()).toBe(1)

    // Esc in a search field that has text empties it rather than closing.
    await panel().getByRole('textbox', { name: 'Search settings' }).fill('theme')
    await page.keyboard.press('Escape')
    expect(await panel().getByRole('textbox', { name: 'Search settings' }).inputValue()).toBe('')
    expect(await panel().count()).toBe(1)

    await section('Appearance')
    await page.keyboard.press('Escape')
    await panel().waitFor({ state: 'detached' })
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Command palette')

    await open()
    await panel().getByRole('button', { name: 'Close settings' }).click()
    await panel().waitFor({ state: 'detached' })
  }, 30_000)

  it('moves by its title bar, double-click centres it, resizes no smaller than 460×300', async () => {
    await open()
    const start = await box()
    await drag({ x: start.x + 120, y: start.y + 18 }, -150, -80)
    const moved = await box()
    expect(Math.round(moved.x)).toBe(Math.round(start.x - 150))
    expect(Math.round(moved.y)).toBe(Math.round(start.y - 80))

    await panel().locator('.settings-panel__title').dblclick()
    const centred = await box()
    const view = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    expect(Math.abs(centred.x + centred.width / 2 - view.width / 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(centred.y + centred.height / 2 - view.height / 2)).toBeLessThanOrEqual(1)

    const corner = await panel().locator('.settings-panel__edge--corner').boundingBox()
    await drag({ x: corner!.x + 8, y: corner!.y + 8 }, -1000, -1000)
    const small = await box()
    expect(Math.round(small.width)).toBe(460)
    expect(Math.round(small.height)).toBe(300)

    const left = await panel().locator('.settings-panel__edge--left').boundingBox()
    await drag({ x: left!.x + 3, y: left!.y + 40 }, -100, 0)
    const wider = await box()
    expect(Math.round(wider.width)).toBe(560)
    expect(Math.round(wider.x + wider.width)).toBe(Math.round(small.x + small.width))
  }, 30_000)

  it('comes back where it was after a relaunch, and inside a window that has shrunk', async () => {
    const before = await box()
    await page.keyboard.press('Escape')
    await sleep(600) // the appearance file is written a moment after the last change
    const saved = JSON.parse(fs.readFileSync(path.join(vault, '.recto', 'appearance.json'), 'utf8')) as { settingsPanel: Box }
    expect(saved.settingsPanel.width).toBe(Math.round(before.width))

    await quitApp(app)
    await launch()
    await open()
    const after = await box()
    expect(after).toEqual(before)

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(700, 500))
    await page.waitForFunction(() => window.innerWidth === 700)
    await sleep(200)
    const clamped = await box()
    expect(clamped.x).toBeGreaterThanOrEqual(0)
    expect(clamped.y).toBeGreaterThanOrEqual(0)
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(700)
    expect(clamped.y + clamped.height).toBeLessThanOrEqual(500)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    await page.waitForFunction(() => window.innerWidth === 1400)
  }, 120_000)

  it('search shows matching rows from every section, editable there; a section heading goes to it', async () => {
    const search = panel().getByRole('textbox', { name: 'Search settings' })
    await search.fill('vim')
    const results = panel().locator('.settings-results')
    await results.locator('.setting:visible', { hasText: 'Vim mode' }).waitFor()
    expect(await results.locator('.setting:visible').count()).toBe(1)
    expect(await results.locator('.setting:visible mark').first().textContent()).toBe('Vim')

    // Changed from the results: written to the appearance file like anywhere else.
    await results.locator('.setting:visible', { hasText: 'Vim mode' }).getByRole('switch').click()
    await sleep(600)
    expect((JSON.parse(fs.readFileSync(path.join(vault, '.recto', 'appearance.json'), 'utf8')) as { vimMode: boolean }).vimMode).toBe(true)
    await results.locator('.setting:visible', { hasText: 'Vim mode' }).getByRole('switch').click()

    // Rows from more than one section, each under its own heading.
    await search.fill('folder')
    const heads = await results.locator('.settings-results__section:visible .settings-results__head').allTextContents()
    expect(heads).toEqual(expect.arrayContaining(['Templates', 'Periodic notes']))
    await search.fill('zzzz nothing')
    await results.locator('.settings-results__empty:visible').waitFor()

    await search.fill('folder')
    await results.locator('.settings-results__head', { hasText: 'Templates' }).click()
    expect(await search.inputValue()).toBe('')
    expect(await panel().locator('.settings__tab.is-active').textContent()).toBe('Templates')
    expect(await panel().locator('.settings__title').textContent()).toBe('Templates')
  }, 30_000)

  it('settings whose parent is off stay visible, dim and disabled', async () => {
    await section('Periodic notes')
    const daily = panel().locator('.settings__group', { has: page.locator('.settings__grouphead', { hasText: 'Daily' }) })
    const template = daily.locator('.setting', { hasText: 'Template' })
    const toggle = daily.getByRole('switch', { name: 'Daily notes', exact: true })
    if ((await toggle.getAttribute('aria-checked')) === 'true') await toggle.click()
    await expect.poll(() => template.getAttribute('class')).toContain('is-disabled')
    expect(await template.locator('select').isDisabled()).toBe(true)
    await toggle.click()
    await expect.poll(() => template.getAttribute('class')).not.toContain('is-disabled')
    expect(await template.locator('select').isDisabled()).toBe(false)
    await toggle.click()
  }, 30_000)

  it('is glass with translucency on, and solid with it off', async () => {
    const look = (): Promise<{ filter: string; background: string }> =>
      page.evaluate(() => {
        const style = getComputedStyle(document.querySelector('.settings-panel')!)
        return { filter: style.backdropFilter, background: style.backgroundColor }
      })
    await section('Appearance')
    const translucency = panel().getByRole('switch', { name: 'Translucency' })
    if ((await translucency.getAttribute('aria-checked')) !== 'true') await translucency.click()
    expect((await look()).filter).toContain('blur')

    await translucency.click()
    await page.waitForFunction(() => document.documentElement.getAttribute('data-translucent') === 'off')
    const solid = await look()
    expect(solid.filter).toBe('none')
    // An opaque colour: no alpha channel in rgb(), or an alpha of 1.
    expect(solid.background).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
    await translucency.click()
  }, 30_000)
})
