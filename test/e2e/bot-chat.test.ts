import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

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
    const folder = path.join(vault, 'Recto', 'Chats', 'recto')
    const files = fs.readdirSync(folder).filter((f) => f.endsWith('.md'))
    expect(files).toHaveLength(1)
    return (fs.readFileSync(path.join(folder, files[0]!), 'utf8').match(/^## Recto$/gm) ?? []).length
  }
  const openRecto = async (): Promise<void> => {
    // Chats live in the panel on the right (⌘⇧C), Recto's chat in it. It stays open
    // across a reload, so it is only opened when it is not.
    if ((await page.locator('.chats').count()) === 0) await page.keyboard.press('Meta+Shift+C')
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
    await quitApp(app)
    await server?.close()
    removeDir(base)
  }, 30_000)

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
      .readdirSync(path.join(vault, 'Recto', 'Chats', 'recto'))
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
    // The two can straddle a minute (the earlier tests take a while): then
    // their stamps differ and neither needs one.
    const sameMinute = files[0]!.slice(0, 16) === files[1]!.slice(0, 16)
    expect(files.map((f) => f.slice(17)).sort()).toEqual(
      sameMinute ? ['— Soil mix (2).md', '— Soil mix.md'] : ['— Soil mix.md', '— Soil mix.md'],
    )
    const newest = fs.readFileSync(
      path.join(vault, 'Recto', 'Chats', 'recto', sameMinute ? files.find((f) => f.includes('(2)'))! : [...files].sort().at(-1)!),
      'utf8',
    )
    expect(newest).toMatch(/^---\nbot: recto\ncreated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\ntitle: Soil mix\n---/)
    expect(newest).toContain('hei')
    expect(newest).not.toContain('How do I mix soil?')
    // A new topic is a clean page: only its own turns on screen.
    expect(await page.locator('.chat-topic').count()).toBe(1)
    expect(await page.locator('.chat-topic').innerText()).not.toContain('How do I mix soil?')
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
    expect(fs.readFileSync(path.join(vault, 'Recto', 'Chats', 'recto', renamed!), 'utf8')).toContain('title: Greetings\n')
  }, 60_000)

  it('delete takes a topic away, and Undo brings it back as it was', async () => {
    const before = topicFiles()
    const greetings = before.find((f) => f.endsWith(' — Greetings.md'))!
    const content = fs.readFileSync(path.join(vault, 'Recto', 'Chats', 'recto', greetings), 'utf8')
    const row = page.locator('.bot-history__row', { hasText: 'Greetings' })
    await row.hover()
    await row.getByRole('button', { name: /^Delete/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete topic' }).click()
    await page.waitForSelector('.bot-undo')
    expect(topicFiles()).toHaveLength(before.length - 1)
    await page.locator('.bot-undo').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(topicFiles).toEqual(before)
    // The toast is outside History, so the click closes it (a click elsewhere); open it again.
    if ((await page.locator('.bot-history__row').count()) === 0) await page.getByRole('button', { name: 'History' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.bot-history__row').length === 2)
    expect(fs.readFileSync(path.join(vault, 'Recto', 'Chats', 'recto', greetings), 'utf8')).toBe(content)
  }, 60_000)

  it('Clear all says how many topics go, and takes them all', async () => {
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByText('Clear all').click()
    await expect(page.getByRole('alertdialog').innerText()).resolves.toContain('All 2 topics')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete 2 topics' }).click()
    await expect.poll(topicFiles).toEqual([])
    await page.waitForSelector('.chat__welcome')
  }, 60_000)

  it('a pasted picture waits above the text with ✕, goes into the vault and the message, shows in the bubble; a model that cannot see it says so', async () => {
    // A pasted screenshot, as Chromium hands it over: a File named image.png on the paste's clipboard data
    // (made here, so the Mac's own clipboard is never touched).
    const paste = (): Promise<void> =>
      page.evaluate(async () => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 8
        const draw = canvas.getContext('2d')!
        draw.fillStyle = 'red'
        draw.fillRect(0, 0, 8, 8)
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
        const data = new DataTransfer()
        data.items.add(new File([blob], 'image.png', { type: 'image/png' }))
        document.querySelector('.bot-chat .composer__input')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      })
    {
      await page.locator('.bot-chat .composer__input').click()
      await paste()
      await page.waitForSelector('.bot-chat .composer__picture img')
      // Into the vault's attachments folder at once, as a note's pasted picture is.
      const attachments = (): string[] =>
        fs.existsSync(path.join(vault, 'attachments')) ? fs.readdirSync(path.join(vault, 'attachments')).filter((f) => /^pasted-.*\.png$/.test(f)) : []
      await expect.poll(() => attachments().length).toBe(1)
      // ✕ takes it off the message (the file stays: it is in the vault now).
      await page.locator('.bot-chat .composer__picture button').click()
      expect(await page.locator('.bot-chat .composer__picture').count()).toBe(0)
      await page.locator('.bot-chat .composer__input').click()
      await paste()
      await page.waitForSelector('.bot-chat .composer__picture img')
      await page.keyboard.type('What is this?')
      await page.keyboard.press('Enter')
      // In my bubble as a picture, and in the topic as Obsidian embeds it.
      await page.waitForSelector('.bot-chat .msg--mine .msg-mine__picture img')
      expect(await page.locator('.bot-chat .composer__picture').count()).toBe(0)
      const files = topicFiles()
      expect(files).toHaveLength(1)
      const topic = fs.readFileSync(path.join(vault, 'Recto', 'Chats', 'recto', files[0]!), 'utf8')
      expect(topic).toMatch(/What is this\?\n\n!\[\[pasted-[^\]]+\.png\]\]/)
      // The stand-in model is a local one that cannot look at pictures: said plainly, not answered blind.
      await page.waitForFunction(() => document.querySelector('.bot-chat')?.textContent?.includes('cannot look at pictures'))
    }
  }, 60_000)

  it('a picture dragged from Finder onto anywhere in the chat - the conversation, not only the box - is taken, with a hint while over it', async () => {
    const before = await page.locator('.bot-chat .composer__picture').count()
    // A drag from Finder, as Chromium hands it over: a File on the drag's data, dropped on the messages.
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 8
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
      const data = new DataTransfer()
      data.items.add(new File([blob], 'Screenshot 2026-11-16.png', { type: 'image/png' }))
      const target = document.querySelector('.bot-chat .msg--mine') ?? document.querySelector('.bot-chat')!
      for (const type of ['dragenter', 'dragover'])
        target.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }))
      ;(window as unknown as { hinted: boolean }).hinted = false
      await new Promise((r) => requestAnimationFrame(r))
      ;(window as unknown as { hinted: boolean }).hinted = document.querySelector('.bot-chat .picture-drop') !== null
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
    })
    expect(await page.evaluate(() => (window as unknown as { hinted: boolean }).hinted)).toBe(true)
    await expect.poll(() => page.locator('.bot-chat .composer__picture').count()).toBe(before + 1)
    expect(await page.locator('.bot-chat .picture-drop').count()).toBe(0)
    expect(fs.existsSync(path.join(vault, 'attachments', 'Screenshot 2026-11-16.png'))).toBe(true)
  }, 60_000)

  it('a video dropped on the chat waits as its first frame with ▶, goes into the vault and the message, and plays in the bubble', async () => {
    // Remove the pictures waiting from before: this message is the video alone.
    while ((await page.locator('.bot-chat .composer__picture button').count()) > 0) await page.locator('.bot-chat .composer__picture button').first().click()
    await page.evaluate(async () => {
      // A short WebM made here, as a screen recording would be.
      const c = document.createElement('canvas')
      c.width = 160
      c.height = 90
      const g = c.getContext('2d')!
      const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' })
      const parts: Blob[] = []
      rec.ondataavailable = (e) => parts.push(e.data)
      const stopped = new Promise((resolve) => (rec.onstop = resolve))
      rec.start()
      for (let i = 0; i < 8; i++) {
        g.fillStyle = `hsl(${i * 40} 70% 50%)`
        g.fillRect(0, 0, 160, 90)
        await new Promise((r) => setTimeout(r, 60))
      }
      rec.stop()
      await stopped
      const data = new DataTransfer()
      data.items.add(new File(parts, 'Screen recording.webm', { type: 'video/webm' }))
      const target = document.querySelector('.bot-chat')!
      for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }))
    })
    await page.waitForSelector('.bot-chat .composer__picture video')
    expect(await page.locator('.bot-chat .composer__picture-play').count()).toBe(1)
    expect(fs.existsSync(path.join(vault, 'attachments', 'Screen recording.webm'))).toBe(true)
    await page.locator('.bot-chat .composer__input').click()
    await page.keyboard.type('What happens here?')
    await page.keyboard.press('Enter')
    await page.waitForSelector('.bot-chat .msg--mine .msg-mine__picture video[controls]')
    const topic = fs.readFileSync(path.join(vault, 'Recto', 'Chats', 'recto', topicFiles()[0]!), 'utf8')
    expect(topic).toMatch(/What happens here\?\n\n!\[\[Screen recording\.webm\]\]/)
  }, 60_000)
})
