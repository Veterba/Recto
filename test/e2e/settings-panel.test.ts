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
 * is off, and turns solid with translucency off; and over the see-through
 * sidebar too, what is behind it comes out blurred. Runs with `npm run test:e2e`.
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

  it('is frosted glass with translucency on - what is behind it blurred - and solid with it off', async () => {
    const look = (): Promise<{ filter: string; background: string; transform: string }> =>
      page.evaluate(() => {
        const style = getComputedStyle(document.querySelector('.settings-panel')!)
        return { filter: style.backdropFilter, background: style.backgroundColor, transform: style.transform }
      })
    /** How much the pixels of a region vary: hard black/yellow stripes are ~100, blurred ones a few. */
    const roughness = async (clip: Box): Promise<number> => {
      const png = (await page.screenshot({ clip })).toString('base64')
      return page.evaluate(async (data) => {
        const image = new Image()
        image.src = `data:image/png;base64,${data}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        const pixels = context.getImageData(0, 0, image.width, image.height).data
        const lum: number[] = []
        for (let i = 0; i < pixels.length; i += 4) lum.push(0.299 * pixels[i]! + 0.587 * pixels[i + 1]! + 0.114 * pixels[i + 2]!)
        const mean = lum.reduce((a, b) => a + b, 0) / lum.length
        return Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length)
      }, png)
    }
    await section('Appearance')
    const translucency = panel().getByRole('switch', { name: 'Translucency' })
    if ((await translucency.getAttribute('aria-checked')) !== 'true') await translucency.click()
    const glass = await look()
    expect(glass.filter).toMatch(/blur\(24px\) saturate/)
    // A tinted fill, not a clear one and not an opaque one.
    expect(glass.background).toMatch(/^(rgba\(\d+, \d+, \d+, 0\.\d+\)|color\(srgb [\d. ]+ \/ 0\.\d+\))$/)
    // The entrance animation leaves nothing behind on the panel at rest.
    expect(glass.transform).toBe('none')

    // Hard stripes behind the panel's header, and beside it as a control.
    const head = (await panel().locator('.settings-panel__head').boundingBox())!
    await page.evaluate((r) => {
      const stripes = document.createElement('div')
      stripes.id = 'e2e-stripes'
      stripes.style.cssText = `position:fixed;left:${r.x - 120}px;top:${r.y}px;width:${r.width + 240}px;height:${r.height}px;z-index:50;background:repeating-linear-gradient(90deg,#000 0 6px,#ff0 6px 12px)`
      document.body.append(stripes)
    }, head)
    await sleep(200)
    const behind = await roughness({ x: head.x + head.width / 2 - 60, y: head.y + 6, width: 120, height: head.height - 12 })
    const beside = await roughness({ x: head.x - 110, y: head.y + 6, width: 90, height: head.height - 12 })
    expect(beside).toBeGreaterThan(60)
    expect(behind).toBeLessThan(beside / 4)
    await page.evaluate(() => document.getElementById('e2e-stripes')?.remove())

    await translucency.click()
    await page.waitForFunction(() => document.documentElement.getAttribute('data-translucent') === 'off')
    const solid = await look()
    expect(solid.filter).toBe('none')
    // An opaque colour: no alpha channel in rgb(), or an alpha of 1.
    expect(solid.background).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
    await translucency.click()
  }, 30_000)

  it('blurs what is behind it over the see-through sidebar, not only over the page', async () => {
    const roughness = async (clip: Box): Promise<number> => {
      const png = (await page.screenshot({ clip })).toString('base64')
      return page.evaluate(async (data) => {
        const image = new Image()
        image.src = `data:image/png;base64,${data}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        const pixels = context.getImageData(0, 0, image.width, image.height).data
        const lum: number[] = []
        for (let i = 0; i < pixels.length; i += 4) lum.push(0.299 * pixels[i]! + 0.587 * pixels[i + 1]! + 0.114 * pixels[i + 2]!)
        const mean = lum.reduce((a, b) => a + b, 0) / lum.length
        return Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length)
      }, png)
    }
    if ((await panel().count()) === 0) await open()
    await section('Appearance')
    const translucency = panel().getByRole('switch', { name: 'Translucency' })
    if ((await translucency.getAttribute('aria-checked')) !== 'true') await translucency.click()
    expect(await panel().evaluate((el) => getComputedStyle(el).backdropFilter)).toContain('blur(')

    // The panel to the window's left edge, its header over the sidebar.
    const head = (await panel().locator('.settings-panel__head').boundingBox())!
    await drag({ x: head.x + head.width / 2, y: head.y + head.height / 2 }, -head.x, 0)
    await sleep(300)
    const at = (await panel().locator('.settings-panel__head').boundingBox())!
    const sidebar = (await page.locator('aside.sidebar').boundingBox())!
    expect(at.x).toBeLessThan(10)
    // Under the header's empty middle, still inside the sidebar: black bars with
    // clear gaps between them - the shape of the sidebar's own text, which has
    // nothing opaque under it but the desktop.
    const region = { x: at.x + 140, y: at.y + 6, width: Math.min(120, sidebar.x + sidebar.width - at.x - 160), height: at.height - 12 }
    expect(region.width).toBeGreaterThan(40)
    await page.evaluate((r) => {
      const bars = document.createElement('div')
      bars.id = 'e2e-bars'
      bars.style.cssText = `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;z-index:50;background:repeating-linear-gradient(90deg,#000 0 6px,transparent 6px 12px)`
      document.body.append(bars)
    }, region)
    await sleep(200)
    const behind = await roughness(region)
    await page.keyboard.press('Escape')
    await panel().waitFor({ state: 'detached' })
    await sleep(200)
    const bare = await roughness(region)
    await page.evaluate(() => document.getElementById('e2e-bars')?.remove())
    expect(bare).toBeGreaterThan(40)
    // Measured: about 1.6 blurred, about 11 with the sharp bars showing
    // through the tint - which is what a quarter would have let pass.
    expect(behind).toBeLessThan(bare / 20)
  }, 30_000)
})
