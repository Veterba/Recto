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

  const answersOnScreen = (): Promise<number> => page.evaluate(() => document.querySelectorAll('.bot-chat .chat__turn--assistant').length)
  const answersInFile = (): number => {
    const folder = path.join(vault, 'chats', 'recto')
    const files = fs.readdirSync(folder).filter((f) => f.endsWith('.md'))
    expect(files).toHaveLength(1)
    return (fs.readFileSync(path.join(folder, files[0]!), 'utf8').match(/^## Recto$/gm) ?? []).length
  }
  const openRecto = async (): Promise<void> => {
    await page.keyboard.press('Meta+2')
    await page.locator('.bot-row').first().click()
    await page.waitForSelector('.bot-chat .chat__input')
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
    await page.locator('.bot-chat .chat__input').click()
    await page.keyboard.type('How do I mix soil?')
    await page.keyboard.press('Enter')
    await page.waitForSelector('.bot-chat .chat__turn--assistant')
    // Long enough for a second copy, if there were one, to land and be saved.
    await page.waitForTimeout(1500)
    expect(await answersOnScreen()).toBe(1)
    expect(answersInFile()).toBe(1)
  }, 60_000)

  it('still one after a reload', async () => {
    await page.reload()
    await page.waitForSelector('.segmented__tab')
    await openRecto()
    await page.waitForSelector('.bot-chat .chat__turn--assistant')
    expect(await answersOnScreen()).toBe(1)
    expect(answersInFile()).toBe(1)
  }, 60_000)
})
