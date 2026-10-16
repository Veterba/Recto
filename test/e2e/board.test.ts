import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * The Tasks board on a copy of the fixture vault: drag and drop writes the
 * status (and `completed` in and out of Done), the WIP limit warns, cards are
 * added from a column's "+" or the palette, columns are added, the panel edits
 * frontmatter one key at a time and renames the note from its title, an
 * unknown status gets its own column, deleting a column moves its cards, the
 * calendar moves through weeks and months, and the widgets are placed,
 * reordered and remembered. Runs with `npm run test:e2e`.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const pad = (n: number): string => String(n).padStart(2, '0')
const day = (offset = 0): string => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > ms) throw new Error('Timed out waiting.')
    await sleep(100)
  }
}

describe.skipIf(!RUN)('the tasks board', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''
  const file = (name: string): string => fs.readFileSync(path.join(vault, 'tasks', `${name}.md`), 'utf8')
  const boards = (): { boards: { columns: { id: string; name: string }[]; widgets?: { shown: boolean; list: string[] } }[] } =>
    JSON.parse(fs.readFileSync(path.join(vault, '.recto', 'boards.json'), 'utf8'))
  const column = (name: string): ReturnType<Page['locator']> => page.locator(`.board-col[aria-label="${name}"]`)
  const card = (title: string): ReturnType<Page['locator']> => page.locator('.board-card', { hasText: title })

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-board-'))
    vault = path.join(base, 'vault')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    // A status no column has, and a card dated around today for the calendar.
    fs.writeFileSync(path.join(vault, 'tasks', 'Lost card.md'), '---\nboard: launch\nstatus: shipped-maybe\n---\n\n# Lost card\n')
    fs.writeFileSync(
      path.join(vault, 'tasks', 'This week.md'),
      `---\nboard: launch\nstatus: todo\norder: 3\npriority: low\nstart: ${day(-1)}\ndue: ${day()}\n---\n\n# This week\n`,
    )
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
    await card('Write the announcement').waitFor()
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it('shows a WIP limit that is reached, and a card whose status names no column', async () => {
    expect(await column('Doing').locator('.board-col__wip').textContent()).toBe('1/1')
    expect(await column('Doing').locator('.board-col__wip').getAttribute('class')).toContain('is-full')
    await column('Unknown status').locator('.board-card', { hasText: 'Lost card' }).waitFor()
    // It is not passed off as a card in the first column.
    expect(await column('To do').locator('.board-card', { hasText: 'Lost card' }).count()).toBe(0)
  }, 20_000)

  it('dragging to Done writes the status and completed; dragging back removes completed', async () => {
    const before = file('Record the demo')
    await card('Record the demo').dragTo(column('Done').locator('.board-col__cards'))
    await until(() => /status: done/.test(file('Record the demo')))
    const after = file('Record the demo')
    expect(after).toContain(`completed: ${day()}`)
    // Only status, order and completed changed: every other line is as it was.
    const untouched = (text: string): string[] => text.split('\n').filter((l) => !/^(status|order|completed):/.test(l))
    expect(untouched(after)).toEqual(untouched(before))
    await page.locator('[data-widget="done-week"] .board-done__big', { hasText: '1' }).waitFor()

    await card('Record the demo').dragTo(column('To do').locator('.board-col__cards'))
    await until(() => /status: todo/.test(file('Record the demo')))
    expect(file('Record the demo')).not.toContain('completed:')
  }, 30_000)

  it("a column's + opens one field: Enter adds and closes, ⌘Enter adds and stays, a taken name is refused", async () => {
    // The old field at the bottom of each column is gone.
    expect(await page.locator('.board-col__new').count()).toBe(0)
    const popover = page.getByRole('dialog', { name: 'New card' })
    const title = popover.getByRole('textbox', { name: 'Card title' })

    await column('To do').getByRole('button', { name: 'New card in To do' }).click()
    await popover.waitFor()
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Card title')
    const started = Date.now()
    await title.fill('Plan the release')
    await title.press('Enter')
    await card('Plan the release').waitFor()
    // On the board before the note is written, and well before the index has it.
    expect(Date.now() - started).toBeLessThan(1000)
    await popover.waitFor({ state: 'detached' })
    await until(() => fs.existsSync(path.join(vault, 'tasks', 'Plan the release.md')) && file('Plan the release') !== '')
    expect(file('Plan the release')).toMatch(/^---\nboard: launch\nstatus: todo\norder: [\d.]+\n---\n\n?$/)

    await column('To do').getByRole('button', { name: 'New card in To do' }).click()
    await title.fill('Draft notes')
    await title.press('Meta+Enter')
    await card('Draft notes').waitFor()
    expect(await title.inputValue()).toBe('')
    // Enter twice, quickly: one card.
    await title.fill('Only once')
    await title.press('Enter')
    await page.keyboard.press('Enter')
    await until(() => fs.existsSync(path.join(vault, 'tasks', 'Only once.md')))
    await sleep(600)
    expect(fs.readdirSync(path.join(vault, 'tasks')).filter((f) => f.startsWith('Only once'))).toEqual(['Only once.md'])
    expect(await card('Only once').count()).toBe(1)

    await column('To do').getByRole('button', { name: 'New card in To do' }).click()
    await title.fill('Handbook')
    await title.press('Enter')
    await popover.getByText('A note with that name exists').waitFor()
    expect(fs.existsSync(path.join(vault, 'tasks', 'Handbook.md'))).toBe(false)
    // Esc closes; an empty title makes nothing.
    await title.fill('')
    await title.press('Enter')
    await title.press('Escape')
    await popover.waitFor({ state: 'detached' })
  }, 30_000)

  it('"New card" in the palette opens the same field, with the column to choose', async () => {
    await page.keyboard.press('Meta+P')
    await page.keyboard.type('New card')
    await page.keyboard.press('Enter')
    const popover = page.getByRole('dialog', { name: 'New card' })
    await popover.waitFor()
    await popover.getByRole('combobox', { name: 'Column' }).selectOption('done')
    await popover.getByRole('textbox', { name: 'Card title' }).fill('From the palette')
    await popover.getByRole('textbox', { name: 'Card title' }).press('Enter')
    await column('Done').locator('.board-card', { hasText: 'From the palette' }).waitFor()
    await until(() => fs.existsSync(path.join(vault, 'tasks', 'From the palette.md')) && /status: done/.test(file('From the palette')))
  }, 20_000)

  it('a new column gets a unique name and is renamed in place', async () => {
    await page.getByRole('button', { name: 'Add column' }).click()
    const rename = page.getByRole('textbox', { name: 'Column name' })
    await rename.waitFor()
    expect(await rename.inputValue()).toBe('New column')
    await rename.fill('Review')
    await rename.press('Enter')
    await until(() => boards().boards[0]!.columns.some((c) => c.name === 'Review'))
    await column('Review').waitFor()
  }, 20_000)

  it('the panel edits one key at a time, refuses a start after the due date, and closes on Esc', async () => {
    await card('Write the announcement').click()
    const panel = page.locator('.card-panel')
    await panel.waitFor()

    await panel.locator('#card-priority').selectOption('low')
    await until(() => /priority: low/.test(file('Write the announcement')))

    await panel.locator('#card-tag').fill('docs')
    await panel.locator('#card-tag').press('Enter')
    await until(() => /tags: \[docs\]/.test(file('Write the announcement')))

    await panel.getByRole('checkbox', { name: 'First draft' }).check()
    await until(() => file('Write the announcement').includes('- [x] First draft'))

    const before = file('Write the announcement')
    await panel.getByLabel('Start').fill('2026-09-30')
    await panel.locator('.card-panel__error').waitFor()
    await sleep(400)
    expect(file('Write the announcement')).toBe(before)

    // Out of the date field (which keeps Esc for itself), then Esc closes the card.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'detached' })

    // A status change out of Done in the panel removes completed, as a drag does.
    expect(file('Design the icon')).toContain('completed: 2026-09-15')
    await card('Design the icon').click()
    await panel.locator('#card-status').selectOption('todo')
    await until(() => /status: todo/.test(file('Design the icon')))
    expect(file('Design the icon')).not.toContain('completed:')
    await page.locator('.card-panel [aria-label="Close card"]').click()
  }, 30_000)

  it("the panel's title is the file name, and renaming it renames the note", async () => {
    await card('Draft notes').click()
    const name = page.locator('.card-panel').getByRole('textbox', { name: 'Card title' })
    expect(await name.inputValue()).toBe('Draft notes')
    await name.fill('Draft the notes')
    await name.press('Enter')
    await card('Draft the notes').waitFor()
    await until(() => fs.existsSync(path.join(vault, 'tasks', 'Draft the notes.md')))
    expect(fs.existsSync(path.join(vault, 'tasks', 'Draft notes.md'))).toBe(false)
    // The panel follows the card.
    expect(await page.locator('.card-panel code').textContent()).toBe('tasks/Draft the notes.md')
    await page.locator('.card-panel [aria-label="Close card"]').click()
  }, 20_000)

  it('the calendar places a card on its days, and clicking the bar opens it', async () => {
    const bar = page.locator('[data-widget="calendar"] .board-cal__bar[data-path="tasks/This week.md"]')
    await bar.waitFor()
    // Its span is two days, unless the week started today - then only today is in this week.
    const columns = await bar.evaluate((el) => (el as HTMLElement).style.gridColumn)
    expect(columns).toMatch(/^\d \/ \d$/)
    expect(await bar.getAttribute('title')).toMatch(/^This week · /)
    await bar.click()
    await sleep(300)
    expect(await page.locator('.card-panel .card-panel__title').inputValue()).toBe('This week')
    await page.locator('.card-panel [aria-label="Close card"]').click()
  }, 20_000)

  it('the calendar steps by week and month, comes back with Today, and a long range says where it ends', async () => {
    const cal = page.locator('[data-widget="calendar"]')
    const title = (): Promise<string | null> => cal.locator('.board-cal__week').textContent()
    const now = await title()
    await cal.getByRole('button', { name: 'Next', exact: true }).click()
    expect(await title()).not.toBe(now)
    expect(await cal.getByRole('button', { name: 'Today', exact: true }).isDisabled()).toBe(false)
    await cal.getByRole('button', { name: 'Previous', exact: true }).click()
    await cal.getByRole('button', { name: 'Previous', exact: true }).click()
    await cal.getByRole('button', { name: 'Today', exact: true }).click()
    expect(await title()).toBe(now)
    expect(await cal.getByRole('button', { name: 'Today', exact: true }).isDisabled()).toBe(true)

    await cal.getByRole('button', { name: '2 weeks', exact: true }).click()
    expect(await cal.locator('.board-cal__day').count()).toBe(14)
    await cal.getByRole('button', { name: 'Month', exact: true }).click()
    expect(await cal.locator('.board-cal__day').count()).toBeGreaterThanOrEqual(28)
    expect(await title()).toMatch(/^[A-Z][a-z]+ \d{4}$/)
    await cal.getByRole('button', { name: 'Week', exact: true }).click()

    // A card running into next week: cut at Sunday, with its end date on the edge.
    fs.writeFileSync(
      path.join(vault, 'tasks', 'Long haul.md'),
      `---\nboard: launch\nstatus: todo\norder: 9\nstart: ${day()}\ndue: ${day(9)}\n---\n`,
    )
    const bar = cal.locator('.board-cal__bar[data-path="tasks/Long haul.md"]')
    await bar.waitFor({ timeout: 15_000 })
    expect(await bar.locator('.board-cal__end').textContent()).toMatch(/^→ \d+ [A-Z][a-z]{2}/)
    // The today line is drawn under the bars.
    const z = await cal.evaluate((el) => [
      getComputedStyle(el.querySelector('.board-cal__today')!).zIndex,
      getComputedStyle(el.querySelector('.board-cal__bar')!).zIndex,
    ])
    expect(Number(z[0])).toBeLessThan(Number(z[1]))
  }, 30_000)

  it('widgets are removed, added back and hidden, and the board remembers', async () => {
    await page.locator('[data-widget="due-soon"] [aria-label="Remove Due soon"]').click()
    await until(() => boards().boards[0]!.widgets?.list.includes('due-soon') === false)
    expect(await page.locator('[data-widget="due-soon"]').count()).toBe(0)

    await page.locator('.board-widget--add').click()
    await page.getByText('Due soon — Due today and the next three days').click()
    await until(() => boards().boards[0]!.widgets?.list.at(-1) === 'due-soon')
    await page.locator('[data-widget="due-soon"]').waitFor()

    // Every new widget can be added; with all of them on, "+ Widget" still offers them, to take off.
    for (const name of ['Today', 'Overdue', 'By priority', 'Recently done']) {
      await page.locator('.board-widget--add').click()
      await page.getByText(new RegExp(`^${name} — `)).click()
      await page.locator(`.board-widget[aria-label="${name}"]`).waitFor()
    }
    expect(await page.locator('.board-widget--add').isDisabled()).toBe(false)
    await page.locator('[data-widget="overdue"]').getByText('Record the demo').waitFor()
    await page.locator('[data-widget="recently-done"]').getByText('Choose a name').waitFor()
    // A priority row filters the board; again clears it.
    await page.locator('[data-widget="by-priority"]').getByRole('button', { name: /^High/ }).click()
    await sleep(300)
    expect(await page.locator('.board-card .board-pri--medium').count()).toBe(0)
    await page.locator('[data-widget="by-priority"]').getByRole('button', { name: /^High/ }).click()

    // Dragged by its header, a widget moves.
    const before = boards().boards[0]!.widgets!.list
    // Seven widgets overflow the strip: back to its start, where both are on screen.
    await page.locator('.board-widgets').evaluate((el) => el.scrollTo({ left: 0 }))
    await page.locator('[data-widget="done-week"] .board-widget__head').dragTo(page.locator('[data-widget="calendar"]'), {
      targetPosition: { x: 5, y: 40 },
    })
    await until(() => boards().boards[0]!.widgets!.list[0] === 'done-week')
    expect([...boards().boards[0]!.widgets!.list].sort()).toEqual([...before].sort())

    await page.getByRole('button', { name: 'Widgets' }).click()
    await until(() => boards().boards[0]!.widgets?.shown === false)
    expect(await page.locator('.board-widgets').count()).toBe(0)
    await page.getByRole('button', { name: 'Widgets' }).click()
    await page.locator('.board-widgets').waitFor()
  }, 20_000)

  it('deleting a column with cards asks where they go, moves them, and keeps every note', async () => {
    await column('Doing').getByRole('button', { name: 'Doing menu' }).click()
    await page.getByText('Delete column').click()
    const dialog = page.getByRole('dialog', { name: 'Delete Doing' })
    await dialog.waitFor()
    await dialog.getByLabel('Move cards to').selectOption('todo')
    await dialog.getByRole('button', { name: 'Move cards and delete' }).click()
    await until(() => /status: todo/.test(file('Fix the export bug')))
    await until(() => !boards().boards[0]!.columns.some((c) => c.id === 'doing'))
    expect(fs.existsSync(path.join(vault, 'tasks', 'Fix the export bug.md'))).toBe(true)
    await column('To do').locator('.board-card', { hasText: 'Fix the export bug' }).waitFor()
  }, 30_000)
})
