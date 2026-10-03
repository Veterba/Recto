import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * One question to a bot gives exactly one answer: on screen, in the thread's
 * file, and again after a reload.
 *
 * Every answer used to land twice in `npm run dev`. Saving the answer ran
 * inside a React state updater, and development React calls an updater twice
 * when it has to apply it during a render - which it does when the stream's end
 * arrives before the last token has been drawn. So this runs the renderer
 * from Vite's dev server (development React, as `npm run dev` does), with the
 * mock model, whose whole reply arrives in one burst. Main is the built one.
 * The window is never shown (scripts/snapshot-isolate.cjs).
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')

describe.skipIf(!RUN)('a bot answer lands once', () => {
  let server: ViteDevServer
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''

  const answersOnScreen = (): Promise<number> => page.evaluate(() => document.querySelectorAll('.bot-chat .msg--bot').length)
  const answersInFile = (): number => {
    const folder = path.join(vault, 'chats', 'recto')
    const files = fs.readdirSync(folder).filter((f) => f.endsWith('.md'))
    expect(files).toHaveLength(1)
    return (fs.readFileSync(path.join(folder, files[0]!), 'utf8').match(/^## Recto$/gm) ?? []).length
  }
  const openRecto = async (): Promise<void> => {
    await page.keyboard.press('Meta+2')
    await page.locator('.bot-row').first().click()
    await page.waitForSelector('.bot-chat .composer__input')
  }

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-bot-'))
    vault = path.join(base, 'Bot vault')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    fs.mkdirSync(path.join(base, 'profile'))
    fs.writeFileSync(path.join(base, 'profile', 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    server = await createServer({
      configFile: false,
      root: path.join(ROOT, 'src/renderer'),
      logLevel: 'error',
      resolve: { alias: { '@renderer': path.join(ROOT, 'src/renderer'), '@shared': path.join(ROOT, 'src/shared') } },
      plugins: [react()],
      server: { port: 0 },
    })
    await server.listen()
    const address = server.httpServer?.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${path.join(base, 'profile')}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1', RECTO_BOTS_MOCK: '1', ELECTRON_RENDERER_URL: `http://localhost:${port}` },
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await server?.close()
    fs.rmSync(base, { recursive: true, force: true })
  })

  it('one question, one answer - on screen and in the file', async () => {
    await openRecto()
    await page.locator('.bot-chat .composer__input').click()
    await page.keyboard.type('How do I mix soil?')
    await page.keyboard.press('Enter')
    await page.waitForSelector('.bot-chat .msg--bot')
    // Long enough for a second copy, if there were one, to land and be saved.
    await page.waitForTimeout(1500)
    expect(await answersOnScreen()).toBe(1)
    expect(answersInFile()).toBe(1)
  }, 60_000)

  it('still one after a reload', async () => {
    await page.reload()
    await page.waitForSelector('.segmented__tab')
    await openRecto()
    await page.waitForSelector('.bot-chat .msg--bot')
    expect(await answersOnScreen()).toBe(1)
    expect(answersInFile()).toBe(1)
  }, 60_000)

  const topicFiles = (): string[] =>
    fs
      .readdirSync(path.join(vault, 'chats', 'recto'))
      .filter((f) => f.endsWith('.md'))
      .sort()
  const ask = async (question: string): Promise<void> => {
    const before = await answersOnScreen()
    await page.locator('.bot-chat .composer__input').click()
    await page.keyboard.type(question)
    await page.keyboard.press('Enter')
    await page.waitForFunction((n) => document.querySelectorAll('.bot-chat .msg--bot').length > n, before)
    // The title arrives after the answer, and renames the file.
    await page.waitForFunction(
      () => !document.querySelector('.chat-topic:last-of-type .chat-topic__divider')?.textContent?.includes('New topic · New topic'),
    )
  }

  it('⌘N starts a new topic: a file of its own, under its own divider, holding only its own turns', async () => {
    await page.locator('.bot-chat .composer__input').click()
    await page.keyboard.press('Meta+n')
    await ask('hei')
    const files = topicFiles()
    expect(files).toHaveLength(2)
    // Begun in the same minute on the same subject, the second gets a number.
    expect(files.map((f) => f.slice(17)).sort()).toEqual(['— Soil mix (2).md', '— Soil mix.md'])
    const newest = fs.readFileSync(
      path.join(
        vault,
        'chats',
        'recto',
        files.find((f) => f.includes('(2)'))!,
      ),
      'utf8',
    )
    expect(newest).toMatch(/^---\nbot: recto\ncreated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\ntitle: Soil mix\n---/)
    expect(newest).toContain('hei')
    expect(newest).not.toContain('How do I mix soil?')
    expect(await page.locator('.chat-topic').count()).toBe(2)
    expect(await page.locator('.chat-topic.is-past').count()).toBe(1)
  }, 60_000)

  it('History renames a topic: its file name and its title', async () => {
    await page.getByRole('button', { name: 'History' }).click()
    await page.waitForSelector('.bot-history__row')
    await page.locator('.bot-history__row').first().hover()
    await page
      .locator('.bot-history__row')
      .first()
      .getByRole('button', { name: /^Rename/ })
      .click()
    await page.keyboard.press('Meta+a')
    await page.keyboard.type('Greetings')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('.bot-history__title')?.textContent === 'Greetings')
    const renamed = topicFiles().find((f) => f.endsWith(' — Greetings.md'))
    expect(renamed).toBeDefined()
    expect(fs.readFileSync(path.join(vault, 'chats', 'recto', renamed!), 'utf8')).toContain('title: Greetings\n')
  }, 60_000)

  it('delete takes a topic away, and Undo brings it back as it was', async () => {
    const before = topicFiles()
    const greetings = before.find((f) => f.endsWith(' — Greetings.md'))!
    const content = fs.readFileSync(path.join(vault, 'chats', 'recto', greetings), 'utf8')
    const row = page.locator('.bot-history__row', { hasText: 'Greetings' })
    await row.hover()
    await row.getByRole('button', { name: /^Delete/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete topic' }).click()
    await page.waitForSelector('.bot-undo')
    expect(topicFiles()).toHaveLength(before.length - 1)
    await page.locator('.bot-undo').getByRole('button', { name: 'Undo' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.bot-history__row').length === 2)
    expect(topicFiles()).toEqual(before)
    expect(fs.readFileSync(path.join(vault, 'chats', 'recto', greetings), 'utf8')).toBe(content)
  }, 60_000)

  it('Clear all says how many topics go, and takes them all', async () => {
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByText('Clear all').click()
    await expect(page.getByRole('alertdialog').innerText()).resolves.toContain('All 2 topics')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete 2 topics' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.chat-topic').length === 1)
    expect(topicFiles()).toEqual([])
  }, 60_000)
})
