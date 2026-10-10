import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * An answer belongs to main, not to the chat on screen: leaving the chat,
 * switching topics, clearing everything or reloading the window never loses
 * it or leaves the bot "already answering". Answers queue one at a time
 * across topics; a finished one out of sight gets a notification.
 *
 * The mock model writes one word every 150 ms (RECTO_BOTS_MOCK_DELAY), so an
 * answer takes ~2.5 s - long enough to leave mid-way. The window is never
 * shown (scripts/snapshot-isolate.cjs).
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/** The mock's whole answer. */
const ANSWER = 'Your notes keep the soil mix simple: compost, loam and grit, tested for pH before planting.'

describe.skipIf(!RUN)('answers survive leaving the chat; the queue', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''

  const folder = (): string => path.join(vault, 'chats', 'recto')
  const files = (): string[] => (fs.existsSync(folder()) ? fs.readdirSync(folder()).filter((f) => f.endsWith('.md')) : [])
  /** Finished answers in all topic files (an answer still streaming carries its job's id). */
  const answersInFiles = (): number =>
    files().reduce((n, f) => {
      const text = fs.readFileSync(path.join(folder(), f), 'utf8')
      return (
        n + (text.match(new RegExp(ANSWER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length - (text.match(/"job":/g) ?? []).length
      )
    }, 0)
  const openRecto = async (): Promise<void> => {
    await page.keyboard.press('Meta+2')
    await page.locator('.bot-row').first().click()
    await page.waitForSelector('.bot-chat .composer__input')
  }
  const type = async (question: string): Promise<void> => {
    await page.locator('.bot-chat .composer__input').click()
    await page.keyboard.type(question)
    await page.keyboard.press('Enter')
  }
  const notifications = (): Promise<number> => app.evaluate(() => (globalThis as { shown?: number }).shown ?? 0)

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-jobs-'))
    vault = path.join(base, 'Jobs vault')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    fs.mkdirSync(path.join(base, 'profile'))
    fs.writeFileSync(path.join(base, 'profile', 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${path.join(base, 'profile')}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1', RECTO_BOTS_MOCK: '1', RECTO_BOTS_MOCK_DELAY: '150' },
    })
    // Notifications counted, not shown.
    await app.evaluate(({ Notification }) => {
      Notification.prototype.show = function () {
        const g = globalThis as { shown?: number }
        g.shown = (g.shown ?? 0) + 1
      }
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    await openRecto()
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    fs.rmSync(base, { recursive: true, force: true })
  })

  it('send, switch to the Data tab, come back: the answer is still coming, then complete', async () => {
    await type('How do I mix soil?')
    await page.waitForSelector('.bot-chat .is-pending')
    await page.keyboard.press('Meta+1')
    await sleep(600)
    await openRecto()
    // Re-attached mid-answer: the partial answer and the working face are back.
    await page.waitForSelector('.bot-chat .is-pending .msg--bot')
    await expect.poll(answersInFiles, { timeout: 10_000 }).toBe(1)
    await page.waitForFunction(() => document.querySelector('.bot-chat .is-pending') === null)
    expect(await page.locator('.bot-chat .msg--bot').count()).toBe(1)
  }, 60_000)

  it('out of sight when it finished: one notification', async () => {
    expect(await notifications()).toBe(1)
  })

  it('send, switch to another topic, come back: complete', async () => {
    await type('And for pots?')
    await page.waitForSelector('.bot-chat .is-pending')
    await page.keyboard.press('Meta+n')
    await sleep(500)
    await page.getByRole('button', { name: 'History' }).click()
    await page.locator('.bot-history__open').first().click()
    await expect.poll(answersInFiles, { timeout: 10_000 }).toBe(2)
    await page.waitForFunction(() => document.querySelectorAll('.bot-chat .msg--bot').length === 2)
  }, 60_000)

  it('send, Clear all: the answer stops, and a new message is answered at once', async () => {
    await type('One more?')
    await page.waitForSelector('.bot-chat .is-pending')
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByText('Clear all').click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /^Delete/ })
      .click()
    await expect.poll(files).toEqual([])
    await sleep(800)
    // Nothing more is written into a deleted topic.
    expect(files()).toEqual([])
    await type('Fresh start')
    await expect.poll(answersInFiles, { timeout: 10_000 }).toBe(1)
    expect(await page.locator('.chat__error').count()).toBe(0)
  }, 60_000)

  it('send, reload the window: the partial answer is back, then the full one', async () => {
    await type('After a reload?')
    await page.waitForSelector('.bot-chat .is-pending .msg--bot')
    await page.reload()
    await page.waitForSelector('.segmented__tab')
    await openRecto()
    await page.waitForSelector('.bot-chat .is-pending .msg--bot')
    await expect.poll(answersInFiles, { timeout: 10_000 }).toBe(2)
    await page.waitForFunction(() => document.querySelector('.bot-chat .is-pending') === null)
  }, 60_000)

  it('two topics: the second waits ("Queued · 2nd"), then runs after the first', async () => {
    const before = answersInFiles()
    await type('First topic question')
    await page.waitForSelector('.bot-chat .is-pending')
    await page.keyboard.press('Meta+n')
    await type('Second topic question')
    await page.waitForFunction(() => document.querySelector('.composer__status')?.textContent?.includes('Queued · 2nd') === true)
    await expect.poll(answersInFiles, { timeout: 10_000 }).toBe(before + 1)
    // The second has not finished before the first.
    await expect.poll(answersInFiles, { timeout: 10_000 }).toBe(before + 2)
  }, 60_000)

  it('a queued answer can be cancelled', async () => {
    const before = answersInFiles()
    await type('Long one')
    await page.waitForSelector('.bot-chat .is-pending')
    await page.keyboard.press('Meta+n')
    await type('Never mind')
    await page.waitForFunction(() => document.querySelector('.composer__status')?.textContent?.includes('Queued') === true)
    await page.locator('.composer__status').getByRole('button', { name: 'Cancel' }).click()
    await expect.poll(answersInFiles, { timeout: 10_000 }).toBe(before + 1)
    await sleep(3000)
    expect(answersInFiles()).toBe(before + 1)
  }, 60_000)

  it('no notification while the chat is on screen and the window is in front', async () => {
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!
      w.isVisible = () => true
      w.isFocused = () => true
      w.isMinimized = () => false
    })
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    const before = await notifications()
    await type('Watching this one')
    await page.waitForSelector('.bot-chat .is-pending')
    await page.waitForFunction(() => document.querySelector('.bot-chat .is-pending') === null, null, { timeout: 15_000 })
    await sleep(300)
    expect(await notifications()).toBe(before)
  }, 60_000)

  it('quitting mid-answer saves what there is, marked interrupted (Retry)', async () => {
    await type('Quit while answering')
    await page.waitForSelector('.bot-chat .is-pending .msg--bot')
    // As ⌘Q does: the app holds the quit until the answer is saved.
    const exited = new Promise((r) => app.process().once('exit', r))
    await app.evaluate(({ app: electronApp }) => electronApp.quit())
    await exited
    const text = files()
      .map((f) => fs.readFileSync(path.join(folder(), f), 'utf8'))
      .find((t) => t.includes('Quit while answering'))!
    expect(text).toContain('"interrupted":true')
    expect(text).not.toContain('"job":')
  }, 60_000)
})
