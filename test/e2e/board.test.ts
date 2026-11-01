import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseKanban, rectoSettings } from '../../src/shared/kanban'
import { quitApp, removeDir } from './helpers/app'

/**
 * Boards as notes, on a copy of the fixture vault: the board note opens as a
 * board from Tasks and from Data, with its Markdown a click away; a drag
 * rewrites only the board's lines (and `completed` going in and out of Done);
 * "+" makes the note and its line; a line of text becomes a note; a board is
 * renamed like a note; a link's icon follows its card; the graph has Boards
 * and Tasks. Runs with `npm run test:e2e`.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const DIR = 'Recto/Boards/Launch'
const BOARD = `${DIR}/Launch.md`
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

describe.skipIf(!RUN)('boards as notes', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''
  let boardPath = BOARD
  const read = (rel: string): string => fs.readFileSync(path.join(vault, rel), 'utf8')
  const file = (name: string): string => read(`${DIR}/${name}.md`)
  const board = (): string => read(boardPath)
  const lanes = (): [string, string[]][] => parseKanban(board()).lanes.map((l) => [l.title, l.items.map((i) => i.text)])
  const recto = (): ReturnType<typeof rectoSettings> => rectoSettings(parseKanban(board()))
  const column = (name: string): ReturnType<Page['locator']> => page.locator(`.board-col[aria-label="${name}"]`)
  const card = (title: string): ReturnType<Page['locator']> => page.locator('.board-card', { hasText: title })

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-board-'))
    vault = path.join(base, 'vault')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    // A card dated around today for the calendar, and a line of text.
    fs.writeFileSync(path.join(vault, DIR, 'This week.md'), `---\npriority: low\nstart: ${day(-1)}\ndue: ${day()}\n---\n`)
    fs.writeFileSync(
      path.join(vault, BOARD),
      read(BOARD).replace('- [ ] [[Record the demo]]', '- [ ] [[Record the demo]]\n- [ ] [[This week]]\n- [ ] Buy stamps\n    at the post office'),
    )
    // A note that links a board and a card, for the icons.
    fs.writeFileSync(path.join(vault, 'Plans.md'), '# Plans\n\nThe [[Launch]] board; next up is [[Record the demo]].\n')
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

  it('draws the board note: lanes, a WIP limit that is reached, a line of text as a card', async () => {
    expect(await page.locator('.board-col').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(['To do', 'Doing', 'Done'])
    expect(await column('Doing').locator('.board-col__wip').textContent()).toBe('1/1')
    expect(await column('Doing').locator('.board-col__wip').getAttribute('class')).toContain('is-full')
    await column('To do').locator('.board-card--light', { hasText: 'Buy stamps' }).waitFor()
    // Nothing on the board was written by opening it.
    expect(board()).toContain('- [ ] Buy stamps\n    at the post office')
  }, 20_000)

  it('dragging to Done moves and ticks its line and writes completed; back unticks and removes it', async () => {
    const before = board()
    const note = file('Record the demo')
    await card('Record the demo').dragTo(column('Done').locator('.board-col__cards'))
    await until(() => board().includes('- [x] [[Record the demo]]'))
    await until(() => file('Record the demo').includes(`completed: ${day()}`))
    // The board: that one line gone from To do and in Done, ticked; every other line as it was.
    const lines = (text: string): string[] => text.split('\n').filter((l) => !l.includes('[[Record the demo]]'))
    expect(lines(board())).toEqual(lines(before))
    // The note: only completed added.
    expect(file('Record the demo').replace(`completed: ${day()}\n`, '')).toBe(note)
    await page.locator('[data-widget="done-week"] .board-done__big', { hasText: '1' }).waitFor()

    await card('Record the demo').dragTo(column('To do').locator('.board-col__cards'))
    await until(() => board().includes('- [ ] [[Record the demo]]'))
    await until(() => !file('Record the demo').includes('completed:'))
    expect(file('Record the demo')).toBe(note)
  }, 30_000)

  it("a column's +: Enter makes the note in the board’s folder and its line at the top, ⌘Enter stays, a taken name is a choice", async () => {
    const popover = page.getByRole('dialog', { name: 'New card' })
    const title = popover.getByRole('textbox', { name: 'Card title' })

    await column('To do').getByRole('button', { name: 'New card in To do' }).click()
    await popover.waitFor()
    await title.fill('Plan the release')
    await title.press('Enter')
    await card('Plan the release').waitFor()
    await popover.waitFor({ state: 'detached' })
    expect(file('Plan the release')).toBe('')
    expect(lanes()[0]![1][0]).toBe('[[Plan the release]]')

    await column('To do').getByRole('button', { name: 'New card in To do' }).click()
    await title.fill('Draft notes')
    await title.press('Meta+Enter')
    await card('Draft notes').waitFor()
    // The card shows before its line is written; the field empties once it is.
    await page.waitForFunction(() => (document.querySelector('.new-card__title') as HTMLInputElement | null)?.value === '')
    // Enter twice, quickly: one card.
    await title.fill('Only once')
    await title.press('Enter')
    await page.keyboard.press('Enter')
    await until(() => fs.existsSync(path.join(vault, DIR, 'Only once.md')))
    await sleep(600)
    expect(fs.readdirSync(path.join(vault, DIR)).filter((f) => f.startsWith('Only once'))).toEqual(['Only once.md'])
    expect(board().match(/\[\[Only once\]\]/g)).toHaveLength(1)

    await column('To do').getByRole('button', { name: 'New card in To do' }).click()
    await title.fill('Handbook')
    await title.press('Enter')
    await popover.getByText('A note “').waitFor()
    expect(await popover.locator('.new-card__taken').textContent()).toBe('A note “Handbook” already exists in the top of the vault. Add it to this board?')
    expect(fs.existsSync(path.join(vault, DIR, 'Handbook.md'))).toBe(false)
    expect(board()).not.toContain('[[Handbook]]')
    // Choose another name: the field is back, nothing made.
    await popover.getByRole('button', { name: 'Choose another name' }).click()
    expect(await popover.locator('.new-card__exists').count()).toBe(0)
    // Add it: the existing note goes on the board as a link, its file left where it is.
    await title.press('Enter')
    await popover.getByRole('button', { name: 'Add it to this board' }).click()
    await until(() => board().includes('- [ ] [[Handbook]]'))
    expect(fs.existsSync(path.join(vault, 'Handbook.md'))).toBe(true)
    expect(fs.existsSync(path.join(vault, DIR, 'Handbook.md'))).toBe(false)
    await card('Handbook').waitFor()
    await column('To do').getByRole('button', { name: 'New card in To do' }).click()
    await title.press('Escape')
    await popover.waitFor({ state: 'detached' })
  }, 30_000)

  it('"New card" in the palette asks for the column; into Done it goes ticked', async () => {
    await page.keyboard.press('Meta+P')
    await page.keyboard.type('New card')
    await page.keyboard.press('Enter')
    const popover = page.getByRole('dialog', { name: 'New card' })
    await popover.waitFor()
    await popover.getByRole('combobox', { name: 'Column' }).selectOption({ label: 'Done' })
    await popover.getByRole('textbox', { name: 'Card title' }).fill('From the palette')
    await popover.getByRole('textbox', { name: 'Card title' }).press('Enter')
    await column('Done').locator('.board-card', { hasText: 'From the palette' }).waitFor()
    await until(() => board().includes('- [ ] [[From the palette]]'))
  }, 20_000)

  it('a line of text becomes a note in the board’s folder, and its line a link to it', async () => {
    await card('Buy stamps').click()
    const panel = page.locator('.card-panel')
    await panel.getByRole('button', { name: 'Make it a note' }).click()
    await until(() => fs.existsSync(path.join(vault, DIR, 'Buy stamps.md')) && file('Buy stamps') !== '')
    expect(file('Buy stamps')).toBe('at the post office\n')
    await until(() => board().includes('- [ ] [[Buy stamps]]'))
    expect(board()).not.toContain('at the post office')
    // The panel is the note's now: its title is the file name.
    await panel.getByRole('textbox', { name: 'Card title' }).waitFor()
    await page.locator('.card-panel [aria-label="Close card"]').click()
  }, 20_000)

  it('a new column is a heading in the note, renamed in place', async () => {
    await page.getByRole('button', { name: 'Add column' }).click()
    const rename = page.getByRole('textbox', { name: 'Column name' })
    await rename.waitFor()
    expect(await rename.inputValue()).toBe('New column')
    await rename.fill('Review')
    await rename.press('Enter')
    await until(() => lanes().some(([t]) => t === 'Review'))
    expect(board()).toContain('## Review')
    await column('Review').waitFor()
  }, 20_000)

  it('the panel edits one key of the note at a time; a status change out of Done unticks and removes completed', async () => {
    await card('Write the announcement').click()
    const panel = page.locator('.card-panel')
    await panel.waitFor()
    await panel.locator('#card-priority').selectOption('low')
    await until(() => /priority: low/.test(file('Write the announcement')))
    await panel.locator('#card-tag').fill('docs')
    await panel.locator('#card-tag').press('Enter')
    await until(() => /tags: \[docs\]/.test(file('Write the announcement')))
    // The note's text is edited in the panel: a box ticked, a line typed - written once typing pauses.
    await panel.locator('.note-body .cm-line', { hasText: 'First draft' }).locator('.cm-task-checkbox').click()
    await until(() => file('Write the announcement').includes('- [x] First draft'))
    await panel.locator('.note-body .cm-line', { hasText: /^\s*Screenshot$/ }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('\n- [ ] Typed in the panel')
    await until(() => file('Write the announcement').includes('- [ ] Typed in the panel'))
    // [[ offers the vault's notes here too, and the list stays inside the panel.
    await page.keyboard.type(' see [[Record the d')
    const option = page.locator('.card-panel .cm-tooltip-autocomplete li', { hasText: 'Record the demo' })
    await option.waitFor()
    const [list, box] = await Promise.all([
      page.locator('.card-panel .cm-tooltip-autocomplete').boundingBox(),
      page.locator('.card-panel').boundingBox(),
    ])
    expect(list!.x + list!.width).toBeLessThanOrEqual(box!.x + box!.width)
    await option.click()
    await until(() => file('Write the announcement').includes('Typed in the panel see [[Record the demo]]'), 15_000)
    // Its frontmatter is the panel's fields', untouched by the typing.
    expect(file('Write the announcement')).toMatch(/^---\ndate: 2026-09-10\npriority: low\n/)
    // The note never learns where it is on the board.
    expect(file('Write the announcement')).not.toMatch(/^(board|status|order):/m)

    const before = file('Write the announcement')
    await panel.getByLabel('Start').fill('2026-09-30')
    await panel.locator('.card-panel__error').waitFor()
    await sleep(400)
    expect(file('Write the announcement')).toBe(before)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'detached' })

    expect(file('Design the icon')).toContain('completed: 2026-09-15')
    await card('Design the icon').click()
    await panel.locator('#card-status').selectOption({ label: 'To do' })
    await until(() => board().includes('- [ ] [[Design the icon]]'))
    await until(() => !file('Design the icon').includes('completed:'))
    await page.locator('.card-panel [aria-label="Close card"]').click()
  }, 30_000)

  it("the panel's title is the file name: renaming it renames the note, and the board's line follows", async () => {
    await card('Draft notes').click()
    const name = page.locator('.card-panel').getByRole('textbox', { name: 'Card title' })
    await name.fill('Draft the notes')
    await name.press('Enter')
    await until(() => fs.existsSync(path.join(vault, DIR, 'Draft the notes.md')))
    await until(() => board().includes('[[Draft the notes]]'))
    expect(board()).not.toContain('[[Draft notes]]')
    await card('Draft the notes').waitFor()
    await page.locator('.card-panel [aria-label="Close card"]').click()
  }, 20_000)

  it('the calendar places a card on its days, and clicking the bar opens it', async () => {
    const bar = page.locator('[data-widget="calendar"] .board-cal__bar[data-path="Recto/Boards/Launch/This week.md"]')
    await bar.waitFor()
    expect(await bar.getAttribute('title')).toMatch(/^This week · /)
    await bar.click()
    await sleep(300)
    expect(await page.locator('.card-panel .card-panel__title').inputValue()).toBe('This week')
    await page.locator('.card-panel [aria-label="Close card"]').click()
  }, 20_000)

  it("widgets are kept in the note's settings block, under recto", async () => {
    await page.locator('[data-widget="due-soon"] [aria-label="Remove Due soon"]').click()
    await until(() => recto().widgets?.list.includes('due-soon') === false)
    await page.locator('.board-widget--add').click()
    await page.getByText('Due soon — Due today and the next three days').click()
    await until(() => recto().widgets?.list.at(-1) === 'due-soon')
    await page.getByRole('button', { name: 'Widgets' }).click()
    await until(() => recto().widgets?.shown === false)
    await page.getByRole('button', { name: 'Widgets' }).click()
    await page.locator('.board-widgets').waitFor()
    // The plugin's own keys are still there.
    expect(parseKanban(board()).settings['kanban-plugin']).toBe('board')
  }, 20_000)

  it('deleting a column with cards moves them first, and keeps every note', async () => {
    await column('Review').getByRole('button', { name: 'Review menu' }).click()
    await page.getByText('Delete column').click()
    await until(() => !lanes().some(([t]) => t === 'Review'))
    await card('Fix the export bug').waitFor()
    await column('Doing').getByRole('button', { name: 'Doing menu' }).click()
    await page.getByText('Delete column').click()
    const dialog = page.getByRole('dialog', { name: 'Delete Doing' })
    await dialog.getByLabel('Move cards to').selectOption({ label: 'To do' })
    await dialog.getByRole('button', { name: 'Move cards and delete' }).click()
    await until(() => !lanes().some(([t]) => t === 'Doing'))
    expect(lanes()[0]![1]).toContain('[[Fix the export bug]]')
    expect(fs.existsSync(path.join(vault, DIR, 'Fix the export bug.md'))).toBe(true)
  }, 30_000)

  it("the board note's Markdown is a click away, with a word about what Obsidian removes", async () => {
    await page.getByRole('button', { name: 'Show Markdown' }).click()
    await page.locator('.board-raw__warn', { hasText: 'removed by Obsidian' }).waitFor()
    await page.locator('.board-raw .cm-content').getByText('kanban:settings').waitFor()
    await page.getByRole('button', { name: 'Show board' }).click()
    await card('Write the announcement').waitFor()
  }, 20_000)

  it("a link's icon says board, or where its card stands - and changes when the card moves", async () => {
    await page.keyboard.press('Meta+1')
    await page.locator('[role=treeitem]', { hasText: 'Plans' }).click()
    const link = (name: string) => page.locator('.cm-wikilink', { hasText: name })
    await link('Launch').locator('.cm-link-icon--board').waitFor()
    await link('Record the demo').locator('.cm-link-icon--open').waitFor()
    // Opened from Data, the board note is a board too.
    await page.keyboard.press('Meta+3')
    await card('Record the demo').dragTo(column('Done').locator('.board-col__cards'))
    await until(() => board().includes('- [x] [[Record the demo]]'))
    await page.keyboard.press('Meta+1')
    await link('Record the demo').locator('.cm-link-icon--done').waitFor({ timeout: 10_000 })
  }, 30_000)

  it("Recto/ - boards and cards - is not in the Data tree; a [[link]] to a board or a card opens it as the board, in the tab you are in", async () => {
    const names = await page.locator('[role=treeitem]').allTextContents()
    expect(names.some((n) => /^Recto$|Launch|Record the demo/.test(n.trim()))).toBe(false)
    // A card moved out of Recto/ stays out of the tree.
    fs.mkdirSync(path.join(vault, 'Garden', 'Moved'), { recursive: true })
    fs.renameSync(path.join(vault, DIR, 'This week.md'), path.join(vault, 'Garden', 'Moved', 'This week.md'))
    await sleep(1500)
    await page.locator('[role=treeitem]', { hasText: 'Garden' }).click()
    await page.locator('[role=treeitem]', { hasText: 'Moved' }).click()
    await sleep(300)
    expect(await page.locator('[role=treeitem]', { hasText: 'This week' }).count()).toBe(0)

    await page.locator('[role=treeitem]', { hasText: 'Plans' }).click()
    await page.locator('.cm-wikilink', { hasText: 'Launch' }).locator('.cm-link-icon').click()
    await page.locator('.board__name', { hasText: 'Launch' }).waitFor()
    // In place (since tabs keep their own history): ← goes back to Plans.
    await page.getByRole('button', { name: 'Back to Plans' }).waitFor()
    // A link to a card opens it beside its board - not its Markdown.
    await page.keyboard.press('Meta+1')
    await page.locator('[role=treeitem]', { hasText: 'Plans' }).click()
    await page.locator('.cm-wikilink', { hasText: 'Record the demo' }).click()
    await page.locator('.card-panel[aria-label="Card: Record the demo"]').waitFor()
    await page.locator('.board__name', { hasText: 'Launch' }).waitFor()
    await page.locator('.card-panel [aria-label="Close card"]').click()
  }, 30_000)

  it('"New board" in the Tasks list makes a board note in its own folder, with new-note-folder set', async () => {
    await page.keyboard.press('Meta+3')
    await page.locator('.boards__add').click()
    const field = page.getByRole('textbox', { name: 'New board name' })
    await field.fill('Side project')
    await field.press('Enter')
    const side = 'Recto/Boards/Side project/Side project.md'
    await until(() => fs.existsSync(path.join(vault, side)) && read(side) !== '')
    expect(read(side)).toMatch(/^---\n\nkanban-plugin: board\n\n---\n\n## To do\n/)
    expect(parseKanban(read(side)).settings['new-note-folder']).toBe('Recto/Boards/Side project')
    await page.locator('.board__name', { hasText: 'Side project' }).waitFor()
    await page.locator('.boards__row', { hasText: 'Launch' }).click()
  }, 20_000)

  it('the graph has Boards on and Tasks off; Tasks brings the cards in', async () => {
    await page.keyboard.press('Meta+G')
    const boards = page.getByRole('button', { name: 'Boards', exact: true })
    const tasks = page.getByRole('button', { name: 'Tasks', exact: true })
    await boards.waitFor()
    expect(await boards.getAttribute('aria-pressed')).toBe('true')
    expect(await tasks.getAttribute('aria-pressed')).toBe('false')
    const count = async (): Promise<number> => Number((await page.locator('.graph__stat').textContent())!.split('·')[0]!.trim())
    const without = await count()
    await tasks.click()
    await sleep(300)
    expect(await count()).toBeGreaterThan(without)
    await boards.click()
    await sleep(300)
    const noBoards = await count()
    await boards.click()
    await sleep(300)
    expect(await count()).toBeGreaterThan(noBoards)
    await tasks.click()
    await page.keyboard.press('Meta+G')
  }, 30_000)

  it('renaming a board renames its note and its folder, cards and new-note-folder with it; its tab follows', async () => {
    await page.keyboard.press('Meta+3')
    await page.locator('.boards__row', { hasText: 'Launch' }).click({ button: 'right' })
    await page.getByText('Rename', { exact: true }).click()
    const field = page.getByRole('textbox', { name: 'Board name' })
    await field.fill('Launch plan')
    await field.press('Enter')
    boardPath = 'Recto/Boards/Launch plan/Launch plan.md'
    // The board note moves first, its cards one by one after it, the old folder last.
    await until(() => fs.existsSync(path.join(vault, boardPath)) && !fs.existsSync(path.join(vault, DIR)))
    expect(fs.existsSync(path.join(vault, 'Recto/Boards/Launch plan/Record the demo.md'))).toBe(true)
    expect(parseKanban(board()).settings['new-note-folder']).toBe('Recto/Boards/Launch plan')
    await page.locator('.board__name', { hasText: 'Launch plan' }).waitFor()
    // The note that linked the board links it under its new name.
    await until(() => read('Plans.md').includes('[[Launch plan]]'))
  }, 30_000)
})
