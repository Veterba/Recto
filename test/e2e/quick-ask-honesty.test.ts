import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * Quick ask says what really happened: an answer stopped before its end is
 * marked so and is not sent back as part of the conversation. The "cloud" is
 * the fake Codex CLI (test/fixtures/fake-cli) in its slow script: it logs the
 * prompt it got, then waits, so the test can stop it.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')

describe.skipIf(!RUN)('Quick ask, honest about a stopped answer', { timeout: 60_000 }, () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let log = ''
  let other = ''
  const prompt = (): string => (fs.existsSync(log) ? (JSON.parse(fs.readFileSync(log, 'utf8')) as { prompt: string }).prompt : '')
  const ask = async (question: string): Promise<void> => {
    await page.locator('.quick-ask__input').fill(question)
    await page.waitForSelector('.quick-ask__send:not([disabled])')
    await page.locator('.quick-ask__input').focus()
    await page.keyboard.press('Enter')
  }

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-quick-ask-'))
    const vault = path.join(base, 'vault')
    const profile = path.join(base, 'profile')
    const bin = path.join(base, 'bin')
    log = path.join(base, 'cloud-log.json')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    other = path.join(base, 'other')
    fs.mkdirSync(other)
    fs.writeFileSync(path.join(other, 'Only here.md'), '# Only here\n')
    fs.writeFileSync(path.join(vault, '.recto/ai-access.json'), JSON.stringify({ excluded: [], writeMode: 'propose', cloud: true }))
    fs.mkdirSync(bin)
    fs.copyFileSync(path.join(ROOT, 'test/fixtures/fake-cli/fake-agent.mjs'), path.join(bin, 'codex'))
    fs.chmodSync(path.join(bin, 'codex'), 0o755)
    fs.mkdirSync(profile)
    fs.writeFileSync(path.join(profile, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${profile}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1', RECTO_BOTS_MOCK: '1', RECTO_CLI_DIRS: bin, FAKE_LOG: log, FAKE_SCENARIO: 'slow' },
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    await page.evaluate(() => localStorage.setItem('recto.quickAskModel', 'codex'))
    await page.getByRole('treeitem', { name: /Handbook/ }).click()
    await page.waitForSelector('.cm-content')
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it('Stop marks the answer as stopped, and the next question goes without the stopped one', async () => {
    await page.locator('.cm-content').click()
    await page.keyboard.press('Meta+j')
    await page.waitForSelector('.quick-ask .composer__where.is-cloud')
    await ask('FIRST-QUESTION-7c1 what is in it?')
    await expect.poll(prompt, { timeout: 20_000 }).toContain('FIRST-QUESTION-7c1')
    await page.locator('.quick-ask').getByRole('button', { name: 'Stop' }).click()
    await page.locator('.quick-ask__aside', { hasText: 'Stopped' }).waitFor({ timeout: 10_000 })
    // Nothing was suggested, and nothing claims to have been.
    expect(await page.locator('.quick-ask__review').count()).toBe(0)
    expect(await page.locator('.quick-ask__aside', { hasText: 'No edit was created' }).count()).toBe(0)

    fs.rmSync(log)
    await ask('Second question?')
    await expect.poll(prompt, { timeout: 20_000 }).toContain('Second question?')
    // The stopped question had no answer: it is left out with it, not sent as if it had been answered.
    expect(prompt()).not.toContain('FIRST-QUESTION-7c1')
    await page.locator('.quick-ask').getByRole('button', { name: 'Stop' }).click()
    await expect.poll(() => page.locator('.quick-ask__aside', { hasText: 'Stopped' }).count()).toBe(2)
  })

  it('switching vaults mid-answer stops the answer, and the other vault opens as it should', async () => {
    fs.rmSync(log, { force: true })
    await ask('Still answering when the vault changes?')
    await expect.poll(prompt, { timeout: 20_000 }).toContain('Still answering')
    const switched = await page.evaluate(
      (dir) => (window as unknown as { api: { invoke: (c: string, ...a: unknown[]) => Promise<{ ok: boolean }> } }).api.invoke('vault:switch', dir),
      other,
    )
    expect(switched.ok).toBe(true)
    // Switched from here, not through the vault menu: the window asks main which vault is open now.
    await page.reload()
    await page.getByRole('treeitem', { name: /Only here/ }).waitFor({ timeout: 20_000 })
    // Its answer went with the vault it was asked in: no topic or note of it in the new one.
    expect(fs.readdirSync(other).sort()).toEqual(['.recto', 'Only here.md'].filter((n) => fs.existsSync(path.join(other, n))).sort())
  })
})
