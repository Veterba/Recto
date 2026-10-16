import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pathTree, periodNotePath } from '../../src/shared/periodic'
import { DEFAULT_TEMPLATE_SETTINGS, type PeriodicSettings } from '../../src/shared/templates'
import { quitApp, removeDir } from './helpers/app'

/**
 * Periodic notes on a copy of the fixture vault, whose settings are still in
 * the old daily-note shape: switching Weekly and Monthly on makes this week's
 * and this month's notes in the right folders, the preview tree says exactly
 * that, and a name already taken elsewhere is refused and said. Then the
 * formatting toolbar: hidden, and focus mode still one click away in the
 * status bar. Runs with `npm run test:e2e`; the window is never shown.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > ms) throw new Error('Timed out waiting.')
    await sleep(100)
  }
}

describe.skipIf(!RUN)('periodic notes and the hideable toolbar', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''
  const now = new Date()
  const on = (periods: Partial<Record<'weekly' | 'monthly' | 'yearly', boolean>>): PeriodicSettings => {
    const off = DEFAULT_TEMPLATE_SETTINGS.periodic.daily
    return {
      ...DEFAULT_TEMPLATE_SETTINGS.periodic,
      folder: 'Daily',
      weekly: { ...off, enabled: periods.weekly === true },
      monthly: { ...off, enabled: periods.monthly === true },
      yearly: { ...off, enabled: periods.yearly === true },
    }
  }

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-periodic-'))
    vault = path.join(base, 'vault')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    // This year's name, taken by a note elsewhere: the yearly note must not be made.
    fs.mkdirSync(path.join(vault, 'Archive'))
    fs.writeFileSync(path.join(vault, 'Archive', `${now.getFullYear()}.md`), '# An older year note\n')
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

  const openTab = async (name: string): Promise<void> => {
    if ((await page.locator('.settings-panel').count()) === 0) {
      await page.keyboard.press('Meta+,')
      await page.waitForSelector('.settings-panel')
    }
    await page.locator('.settings-panel .settings__tab', { hasText: name }).click()
  }

  it('turning Weekly and Monthly on makes this week and this month, where the preview says', async () => {
    await openTab('Periodic notes')
    await page.locator('[aria-label="Weekly notes"]').click()
    await page.locator('[aria-label="Monthly notes"]').click()

    const settings = on({ weekly: true, monthly: true })
    const week = periodNotePath('weekly', now, settings)
    const month = periodNotePath('monthly', now, settings)
    // The preview, line by line, before anything is made: nothing is, while Settings is open.
    const lines = await page.locator('.periodic__line').allTextContents()
    expect(lines.map((l) => l.trim())).toEqual(pathTree([month.path, week.path]).map((l) => l.name))
    await sleep(1500)
    expect(fs.existsSync(path.join(vault, 'Daily'))).toBe(false)

    await page.keyboard.press('Escape')
    await until(() => fs.existsSync(path.join(vault, week.path)) && fs.existsSync(path.join(vault, month.path)))
    // Weekly and monthly together share a month folder; no week folder without daily notes.
    expect(path.dirname(week.path)).toBe(path.dirname(month.path))
    expect(week.path).toMatch(/^Daily\/\d{4}\/\d{2}\/\d{4}-W\d{2}\.md$/)
    expect(month.path).toMatch(/^Daily\/\d{4}\/\d{2}\/\d{4}-\d{2}\.md$/)
    expect(fs.readFileSync(path.join(vault, week.path), 'utf8')).toContain(`month: "[[`)
    expect(fs.readFileSync(path.join(vault, month.path), 'utf8')).toBe(`# ${month.key}\n\n`)
    // No daily note: it was off before and still is.
    expect(fs.readdirSync(path.join(vault, path.dirname(month.path))).sort()).toEqual([month.name, week.name].sort())

    const saved = JSON.parse(fs.readFileSync(path.join(vault, '.recto', 'templates.json'), 'utf8')) as { periodic: PeriodicSettings }
    expect(saved.periodic.folder).toBe('Daily')
    expect(saved.periodic.weekly.enabled).toBe(true)
  }, 30_000)

  it('a name already taken elsewhere is refused, and the status bar says where it is', async () => {
    await openTab('Periodic notes')
    // The notes just made are marked as there.
    expect(await page.locator('.periodic__exists').count()).toBe(2)
    await page.locator('[aria-label="Yearly notes"]').click()
    await page.keyboard.press('Escape')
    await page.locator('.status__notice', { hasText: 'Archive/' }).waitFor()
    const notice = await page.locator('.status__notice', { hasText: 'Archive/' }).textContent()
    expect(notice).toContain(`${now.getFullYear()} wasn't created`)
    expect(fs.existsSync(path.join(vault, periodNotePath('yearly', now, on({ weekly: true, monthly: true, yearly: true })).path))).toBe(
      false,
    )
  }, 20_000)

  it("Today's note opens this week with daily notes off, and with nothing on makes nothing", async () => {
    const week = periodNotePath('weekly', now, on({ weekly: true, monthly: true, yearly: true }))
    const before = fs.readdirSync(path.join(vault, path.dirname(week.path))).sort()
    await page.locator('.status [aria-label="Today\'s note"]').click()
    await page.locator('.status__item', { hasText: week.key }).waitFor()
    // Nothing new on disk: the week note was already there, and no day folder appears.
    expect(fs.readdirSync(path.join(vault, path.dirname(week.path))).sort()).toEqual(before)

    await openTab('Periodic notes')
    for (const name of ['Weekly notes', 'Monthly notes', 'Yearly notes']) await page.locator(`[aria-label="${name}"]`).click()
    await page.keyboard.press('Escape')
    const listing = (): string[] => fs.readdirSync(vault, { recursive: true }).map(String).sort()
    const vaultBefore = listing()
    await page.locator('.status [aria-label="Today\'s note"]').click()
    await page.locator('.status__notice', { hasText: 'No periodic notes are on' }).waitFor()
    await sleep(500)
    expect(listing()).toEqual(vaultBefore)
    await page.locator('.status__notice button', { hasText: 'Open settings' }).click()
    await page.locator('.settings-panel .settings__tab.is-active', { hasText: 'Periodic notes' }).waitFor()
    await page.keyboard.press('Escape')
  }, 30_000)

  it('with the toolbar hidden, focus mode works from the status bar', async () => {
    await openTab('Editor')
    await page.locator('[aria-label="Show formatting toolbar"]').click()
    await page.keyboard.press('Escape')
    await page.locator('[role=treeitem]', { hasText: 'Ideas' }).first().click()
    await page.waitForSelector('.md .cm-content')
    expect(await page.locator('.md > .formatbar').isHidden()).toBe(true)

    await page.locator('.status [aria-label="Focus mode"]').click()
    await page.waitForFunction(() => document.documentElement.getAttribute('data-focus') === 'on')
    await page.locator('.cm-content').first().click()
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.documentElement.getAttribute('data-focus') === null)
  }, 30_000)
})
