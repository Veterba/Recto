import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * Files that are not notes open in the code editor, are edited and saved like
 * notes, and a large one is read-only; HTML pasted into a note renders and
 * converts to a markdown table. Runs with `npm run test:e2e`; the window is
 * never shown.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const PASTED =
  '<table class="border-collapse w-full" style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody>' +
  '<tr><th dir="auto"><p>Problem</p></th><th dir="auto"><p>Solution</p></th></tr>' +
  '<tr><td><p>Lossy round-trip</p></td><td><p>CM6 — the buffer <em>is</em> the file.</p></td></tr>' +
  '<tr><td><p>Path escape via <code>startsWith</code></p></td><td><p><code>path.relative</code> <img src="https://example.invalid/x.png" onerror="window.__pwned=1"></p></td></tr>' +
  '</tbody></table>'

describe.skipIf(!RUN)('files that are not notes', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''

  const open = async (name: string): Promise<void> => {
    await page.locator('[role=treeitem]', { hasText: name }).first().click()
    await sleep(600)
  }

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-files-'))
    vault = path.join(base, 'Files vault')
    fs.mkdirSync(path.join(vault, '.recto'), { recursive: true })
    fs.writeFileSync(path.join(vault, 'data.json'), '{"name":"recto","tags":["a","b"]}')
    fs.writeFileSync(path.join(vault, 'tool.ts'), 'export const answer = 42\n')
    fs.writeFileSync(path.join(vault, 'big.log'), 'line of a big log\n'.repeat(400_000))
    fs.writeFileSync(path.join(vault, 'Pasted.md'), `# Pasted\n\n${PASTED}\n\nAfter the table.\n`)
    fs.writeFileSync(path.join(vault, '.recto', 'topics-settings.json'), JSON.stringify({ enabled: false }))
    fs.mkdirSync(path.join(base, 'profile'))
    fs.writeFileSync(path.join(base, 'profile', 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${path.join(base, 'profile')}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1' },
    })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it('opens a json file in the code editor: line numbers, no note panels', async () => {
    await open('data.json')
    await page.waitForSelector('.code-view .cm-lineNumbers')
    expect(await page.locator('.code-view .properties, .code-view .backlinks, .code-view .toolbar').count()).toBe(0)
    expect(await page.locator('.code-view .cm-content').textContent()).toContain('"recto"')
  })

  it('formats json on demand, as one undo step, and saves it', async () => {
    await page.locator('.code-view__format').click()
    await expect
      .poll(() => fs.readFileSync(path.join(vault, 'data.json'), 'utf8'), { timeout: 5000 })
      .toBe('{\n  "name": "recto",\n  "tags": [\n    "a",\n    "b"\n  ]\n}\n')
    await page.locator('.code-view .cm-content').click()
    await page.keyboard.press('Meta+Z')
    await expect
      .poll(() => fs.readFileSync(path.join(vault, 'data.json'), 'utf8'), { timeout: 5000 })
      .toBe('{"name":"recto","tags":["a","b"]}')
  })

  it('edits and saves a ts file, and ⌘F finds in it', async () => {
    await open('tool.ts')
    await page.waitForSelector('.code-view .cm-content')
    await page.locator('.code-view .cm-content').click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('export const more = 1\n')
    await expect
      .poll(() => fs.readFileSync(path.join(vault, 'tool.ts'), 'utf8'), { timeout: 5000 })
      .toBe('export const answer = 42\nexport const more = 1\n')
    await page.keyboard.press('Meta+F')
    await page.waitForSelector('.code-view .find')
    await page.keyboard.type('answer')
    await expect.poll(() => page.locator('.code-view .cm-searchMatch').count()).toBe(1)
    await page.keyboard.press('Escape')
  })

  it('opens a file over 5 MB read-only, with a notice', async () => {
    await open('big.log')
    await page.waitForSelector('.code-view .cm-content')
    expect(await page.locator('.code-view__notice').textContent()).toContain('Read-only')
    expect(await page.locator('.code-view .cm-content').getAttribute('contenteditable')).toBe('false')
  })

  it('renders a pasted HTML table in a note, sanitised', async () => {
    await open('Pasted')
    await page.waitForSelector('.cm-html-block table.cm-table')
    expect(await page.locator('.cm-html-block tr').count()).toBe(3)
    expect(await page.locator('.cm-html-block img').count()).toBe(0)
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
  })

  it('converts it to a markdown table from the command palette', async () => {
    await page.locator('.cm-html-block').click()
    await sleep(200)
    await page.keyboard.press('Meta+P')
    await page.keyboard.type('Convert HTML table')
    await sleep(200)
    await page.keyboard.press('Enter')
    await expect
      .poll(() => fs.readFileSync(path.join(vault, 'Pasted.md'), 'utf8'), { timeout: 8000 })
      .toBe(
        [
          '# Pasted',
          '',
          '| Problem                      | Solution                        |',
          '| ---------------------------- | ------------------------------- |',
          '| Lossy round-trip             | CM6 — the buffer *is* the file. |',
          '| Path escape via `startsWith` | `path.relative`                 |',
          '',
          'After the table.',
          '',
        ].join('\n'),
      )
  }, 15_000)
})
