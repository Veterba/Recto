import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * The vault overview (⌃⌘H), end to end, on a fresh vault: what has not been
 * counted says so once; the figures' pane scrolls as a whole, from over the
 * field too, and ends where it started; the pane, page and scroll it was left
 * on come back on the next opening and after a restart; and ⌃⌘H pressed again
 * lands back in the note, at the same scroll. Runs with `npm run test:e2e`;
 * the window is never shown.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const OVERVIEW = 'Control+Meta+H'
const W = 1200
const H = 700

describe.skipIf(!RUN)('vault overview', { timeout: 30_000 }, () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''
  /** The figures' scroll when a list was opened from them: what Back returns to. */
  let mainScroll = -1

  async function launch(): Promise<void> {
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${path.join(base, 'profile')}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1' },
    })
    page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setContentSize(size.w, size.h), { w: W, h: H })
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
  }

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-overview-'))
    vault = path.join(base, 'vault')
    fs.mkdirSync(path.join(vault, '.recto'), { recursive: true })
    fs.writeFileSync(path.join(vault, '.recto', 'topics-settings.json'), JSON.stringify({ enabled: false }))
    const long = Array.from({ length: 200 }, (_, i) => `Line ${i + 1} of a long note, to have something to scroll.`).join('\n\n')
    fs.writeFileSync(path.join(vault, 'Long.md'), `# Long\n\n${long}\n\nSee [[Nowhere]].\n`)
    fs.writeFileSync(path.join(vault, 'Alone.md'), '# Alone\n\nNo links.\n')
    fs.mkdirSync(path.join(base, 'profile'))
    fs.writeFileSync(path.join(base, 'profile', 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    await launch()
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  const card = (): ReturnType<Page['locator']> => page.locator('main.overview')
  const scroller = (): ReturnType<Page['locator']> => page.locator('.overview__scroller')
  const paneName = (): Promise<string | null> => page.locator('.home__live').textContent()
  const waitPane = (name: string): Promise<unknown> => page.waitForFunction((n) => document.querySelector('.home__live')?.textContent === n, name)
  const open = async (): Promise<void> => {
    await page.keyboard.press(OVERVIEW)
    // Shown is set a frame after its keys are listened for.
    await page.waitForSelector('.home.is-shown')
  }
  /** Open on the figures, with them in (not the placeholder). */
  const openStats = async (): Promise<void> => {
    if ((await page.locator('.home__live').count()) === 0) await open()
    if ((await paneName()) !== 'Statistics') await page.keyboard.press('ArrowRight')
    await waitPane('Statistics')
    await page.waitForSelector('.overview [aria-label="This week"], .overview__scroller:not([data-view="main"]) .overview__row')
    // The slide in, so positions are where they will stay.
    await page.waitForTimeout(700)
  }
  const close = async (): Promise<void> => {
    await page.keyboard.press(OVERVIEW)
    await page.locator('.home__live').waitFor({ state: 'detached' })
  }
  const scrollTop = (): Promise<number> => scroller().evaluate((el) => el.scrollTop)
  const cardBox = async (): Promise<{ y: number; bottom: number }> => {
    const box = (await card().boundingBox())!
    return { y: box.y, bottom: box.y + box.height }
  }

  it('opens on the welcome, and says once how far back the figures go, never with a dash', async () => {
    await open()
    expect(await paneName()).toBe('Recto')
    await openStats()
    const text = await card().innerText()
    expect(text).toContain('Stats counted from today')
    expect(text.match(/Counting/g)).toBeNull()
    expect(text).not.toMatch(/—/)
    expect(text).toContain('Broken links')
    expect(text).toContain('Notes with no links')
    expect(await page.locator('.overview__name').innerText()).toBe('vault')
  })

  it('scrolls as a whole from over the field, and ends as far from the bottom as it started from the top', async () => {
    const start = await cardBox()
    expect(start.y).toBeGreaterThan(H * 0.4)
    expect(start.y).toBeLessThan(H * 0.55)
    // Left of the card: only the field is under the pointer.
    await page.mouse.move(60, H / 2)
    await page.mouse.wheel(0, 240)
    await page.waitForFunction(() => (document.querySelector('.overview__scroller')?.scrollTop ?? 0) > 0)
    await page.waitForTimeout(300)
    const moved = await cardBox()
    expect(moved.y).toBeLessThan(start.y - 100)

    await scroller().evaluate((el) => el.scrollTo(0, el.scrollHeight))
    await page.waitForTimeout(200)
    const end = await cardBox()
    expect(Math.abs(H - end.bottom - start.y)).toBeLessThanOrEqual(2)
    await scroller().evaluate((el) => el.scrollTo(0, 0))
    await page.waitForTimeout(200)
    await close()
  })

  it('reopens on the pane and the scroll it was left on', async () => {
    await openStats()
    await scroller().evaluate((el) => el.scrollTo(0, 180))
    await page.waitForTimeout(400)
    await close()
    await open()
    expect(await paneName()).toBe('Statistics')
    await page.waitForTimeout(300)
    expect(await scrollTop()).toBe(180)

    await page.keyboard.press('ArrowLeft')
    await waitPane('Recto')
    await close()
    await open()
    expect(await paneName()).toBe('Recto')

    await openStats()
    const broken = page.locator('.overview__attn', { hasText: 'Broken links' })
    await broken.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    mainScroll = await scrollTop()
    await broken.click()
    await page.waitForSelector('.overview__scroller[data-view="broken"]')
    expect(await card().innerText()).toContain('[[Nowhere]]')
    await page.waitForTimeout(400)
    await close()
    await open()
    expect(await scroller().getAttribute('data-view')).toBe('broken')
    await close()
  })

  it('and after a restart', async () => {
    await quitApp(app)
    await launch()
    await open()
    expect(await paneName()).toBe('Statistics')
    expect(await scroller().getAttribute('data-view')).toBe('broken')
    await page.locator('.overview__corner', { hasText: 'Back' }).click()
    await page.waitForSelector('.overview__scroller[data-view="main"]')
    await page.waitForTimeout(300)
    expect(mainScroll).toBeGreaterThan(0)
    expect(await scrollTop()).toBe(mainScroll)
    await close()
  }, 120_000)

  it('⌃⌘H again goes back to the note, at the same scroll', async () => {
    await page.locator('[role=treeitem]', { hasText: 'Long' }).first().click()
    await page.waitForSelector('.md .cm-content')
    await page.locator('.cm-line', { hasText: 'Line 3 of' }).click()
    await page.locator('.cm-scroller').evaluate((el) => el.scrollTo(0, 600))
    await page.waitForTimeout(200)
    const before = await page.locator('.cm-scroller').evaluate((el) => el.scrollTop)
    expect(before).toBeGreaterThan(0)

    await open()
    await close()
    expect(await page.locator('.cm-scroller').evaluate((el) => el.scrollTop)).toBe(before)
    expect(await page.evaluate(() => document.activeElement?.closest('.cm-editor') !== null)).toBe(true)
  })
})
