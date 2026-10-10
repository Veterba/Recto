import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Bots are experimental and off in a new vault: then nothing of theirs runs.
 * Every request main makes to Ollama is logged (helpers/count-ollama.cjs);
 * over two minutes idle - long enough for the background loop to come round -
 * and while a note is being edited, there must be none. Runs with
 * `npm run test:e2e`; the window is never shown.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!RUN)('bots off', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''
  let ollamaLog = ''
  const requests = (): string[] => (fs.existsSync(ollamaLog) ? fs.readFileSync(ollamaLog, 'utf8').split('\n').filter(Boolean) : [])

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-botsoff-'))
    vault = path.join(base, 'New vault')
    fs.mkdirSync(path.join(vault, '.recto'), { recursive: true })
    fs.writeFileSync(path.join(vault, 'Plans.md'), '# Plans\n\nSoil, seeds, and a shed.\n')
    fs.writeFileSync(path.join(vault, 'Ideas.md'), '# Ideas\n\nA greenhouse by the wall.\n')
    fs.writeFileSync(path.join(vault, '.recto', 'topics-settings.json'), JSON.stringify({ enabled: false }))
    fs.mkdirSync(path.join(base, 'profile'))
    fs.writeFileSync(path.join(base, 'profile', 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    ollamaLog = path.join(base, 'ollama.log')
    app = await _electron.launch({
      args: [
        '-r',
        path.join(ROOT, 'scripts/snapshot-isolate.cjs'),
        '-r',
        path.join(ROOT, 'test/e2e/helpers/count-ollama.cjs'),
        ROOT,
        `--user-data-dir=${path.join(base, 'profile')}`,
      ],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1', RECTO_OLLAMA_LOG: ollamaLog },
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    fs.rmSync(base, { recursive: true, force: true })
  })

  it('a new vault starts with bots off, and the AI tab says so in one line', async () => {
    expect(JSON.parse(fs.readFileSync(path.join(vault, '.recto', 'bots-settings.json'), 'utf8'))).toEqual({ enabled: false })
    await page.locator('[role=tab]', { hasText: 'AI' }).first().click()
    await page.waitForSelector('.bots-off')
    expect((await page.locator('.bots-off').textContent())?.replace(/\s+/g, ' ').trim()).toBe('Bots are off · Turn on in Settings')
  })

  it('the request log does see a request to Ollama, so an empty one means none', async () => {
    await app.evaluate(async () => {
      await fetch('http://127.0.0.1:11434/api/tags').catch(() => undefined)
    })
    expect(requests()).toEqual(['http://127.0.0.1:11434/api/tags'])
    fs.writeFileSync(ollamaLog, '')
  })

  it('two minutes idle and editing notes: not one request to Ollama, no bot folders made', async () => {
    await page.locator('[role=tab]', { hasText: 'Data' }).first().click()
    await page.locator('[role=treeitem]', { hasText: 'Plans' }).click()
    await page.waitForSelector('.cm-content')
    const started = Date.now()
    while (Date.now() - started < 130_000) {
      await page.locator('.cm-line', { hasText: 'Soil' }).click()
      await page.keyboard.press('End')
      await page.keyboard.type(' More.')
      await sleep(20_000)
    }
    expect(fs.readFileSync(path.join(vault, 'Plans.md'), 'utf8')).toContain('More.')
    expect(requests()).toEqual([])
    expect(fs.existsSync(path.join(vault, '.recto', 'bots'))).toBe(false)
    const metrics = await app.evaluate(({ app: electron }) =>
      electron.getAppMetrics().map((m) => ({ type: m.type, kb: m.memory.workingSetSize })),
    )
    console.log(`[bots off] RAM after 2 min: ${Math.round(metrics.reduce((n, m) => n + m.kb, 0) / 1024)} MB`, metrics)
  }, 200_000)

  it('Settings shows the switch, marked Experimental', async () => {
    await page.locator('[role=tab]', { hasText: 'AI' }).first().click()
    await page.locator('.bots-off__link').click()
    await page.waitForSelector('.dialog--settings')
    expect(await page.locator('.dialog--settings .settings__tab.is-active').textContent()).toBe('Bots')
    expect(await page.locator('.dialog--settings').textContent()).toContain('Experimental')
  }, 15_000)
})
