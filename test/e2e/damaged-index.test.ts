import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * A vault whose .recto/index.db is not a database (a crash, a sync conflict):
 * Recto sets it aside, builds a new index, and search works in the same
 * launch. Runs with `npm run test:e2e`.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')

describe.skipIf(!RUN)('a damaged index on open', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-damaged-index-'))
    vault = path.join(base, 'vault')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    fs.mkdirSync(path.join(vault, '.recto'), { recursive: true })
    fs.writeFileSync(path.join(vault, '.recto', 'index.db'), 'not a database '.repeat(500))
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

  it('sets the file aside and search finds notes', async () => {
    const search = (): Promise<string[]> =>
      page.evaluate(async () => ((await window.api.invoke('index:search', 'Handbook')) as { path: string }[]).map((h) => h.path))
    await expect.poll(search, { timeout: 30_000 }).toContain('Handbook.md')
    const aside = fs.readdirSync(path.join(vault, '.recto')).filter((f) => f.startsWith('index.db.corrupt-'))
    expect(aside.length).toBeGreaterThan(0)
  }, 40_000)
})
