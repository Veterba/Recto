import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FILES, RESOLVE_ROWS } from '../fixtures/obsidian-links-measured'
import { quitApp, removeDir } from './helpers/app'

/**
 * Obsidian's link rules through the running app, on the test vault's cases
 * (test/fixtures/obsidian-links-measured.ts): notes of one name in the vault's
 * top, A, B and A/sub, and links to them from five folders. Every link is
 * clicked and must open the file Obsidian opens; then a rename and a move ask
 * Obsidian's "Update links" (the vault has no settings, so it asks, as
 * Obsidian does by default), and each answer does what Obsidian's does.
 * Runs with `npm run test:e2e`; the window is never shown.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const ROWS = RESOLVE_ROWS.map(([source, link, opens]) => ({ source, link, opens }))
const SOURCES = [...new Set(ROWS.map((r) => r.source))]
/** A one-pixel PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const stem = (p: string): string => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, '')

describe.skipIf(!RUN)('links by Obsidian’s rules, in the app', { timeout: 60_000 }, () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''

  const read = (relative: string): string => fs.readFileSync(path.join(vault, relative), 'utf8')
  const write = (relative: string, text: string | Buffer): void => {
    fs.mkdirSync(path.dirname(path.join(vault, relative)), { recursive: true })
    fs.writeFileSync(path.join(vault, relative), text)
  }
  /** A source note: one line per link it has, each with its own mark. */
  const sourceText = (source: string): string =>
    `# ${stem(source)}\n\n${ROWS.filter((r) => r.source === source)
      .map((r, i) => `L${String(i).padStart(2, '0')} [[${r.link}]]`)
      .join('\n')}\n`

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-links-rules-'))
    vault = path.join(base, 'vault')
    fs.mkdirSync(path.join(vault, '.recto'), { recursive: true })
    fs.writeFileSync(path.join(vault, '.recto', 'topics-settings.json'), JSON.stringify({ enabled: false }))
    // Made one after another, in Obsidian's index order: the last tie-break is when each was made.
    for (const file of FILES) {
      if (file.path.endsWith('.png')) write(file.path, PNG)
      else if (SOURCES.includes(file.path)) write(file.path, sourceText(file.path))
      else write(file.path, `# ${stem(file.path)}\n\nThis is ${file.path}.\n\n## Heading\n`)
      await sleep(30)
    }
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

  /** Open a note with the quick switcher, as a person would. */
  const openNote = async (name: string): Promise<void> => {
    await page.keyboard.press('Meta+o')
    await page.keyboard.type(name)
    await sleep(150)
    await page.keyboard.press('Enter')
    await page.locator('.md .cm-content', { hasText: `# ${name}` }).first().waitFor()
  }
  /** What is open now: the note's own sentence, or the picture's file. */
  const opened = async (): Promise<string | null> => {
    const img = page.locator('.file-view img, img[alt$=".png"]').first()
    if ((await img.count()) > 0) return decodeURIComponent((await img.getAttribute('src')) ?? '')
    return page.locator('.md .cm-content').first().innerText()
  }
  const clickLink = async (source: string, mark: string): Promise<void> => {
    await openNote(stem(source))
    await page.locator('.cm-line', { hasText: mark }).locator('.cm-wikilink').first().click()
  }
  const opensFile = async (file: string): Promise<void> => {
    await expect
      .poll(async () => {
        const now = await opened()
        return now !== null && (file.endsWith('.png') ? now.endsWith(file) : now.includes(`This is ${file}.`))
      })
      .toBe(true)
  }

  it.each(SOURCES)('every link from %s opens the file Obsidian opens', async (source) => {
    const rows = ROWS.filter((r) => r.source === source)
    for (const [i, row] of rows.entries()) {
      if (row.opens === null) continue
      await clickLink(source, `L${String(i).padStart(2, '0')} `)
      await opensFile(row.opens)
    }
  })

  const answer = async (button: 'Always update' | 'Just once' | 'Do not update'): Promise<void> => {
    const dialog = page.locator('[role=alertdialog][aria-label="Update links"]')
    await dialog.waitFor()
    expect(await dialog.innerText()).toMatch(/This will affect \d+ links? in \d+ files?\./)
    await dialog.getByRole('button', { name: button }).click()
  }
  const relocate = (channel: 'fs:rename' | 'fs:move', from: string, to: string): Promise<unknown> =>
    page.evaluate(([c, f, t]) => (window as unknown as { api: { invoke: (...a: string[]) => Promise<unknown> } }).api.invoke(c!, f!, t!), [channel, from, to])

  it('a rename asks, and “Just once” makes every link to it follow, each from its own note', async () => {
    const done = relocate('fs:rename', 'B/Plan.md', 'Plan 2.md')
    await answer('Just once')
    await done
    expect(fs.existsSync(path.join(vault, 'B/Plan.md'))).toBe(false)
    // Every link that opened B/Plan opens it still, as B/Plan 2 (its text says where it was made).
    for (const source of SOURCES) {
      const rows = ROWS.filter((r) => r.source === source)
      for (const [i, row] of rows.entries()) {
        if (row.opens !== 'B/Plan.md') continue
        await clickLink(source, `L${String(i).padStart(2, '0')} `)
        await opensFile('B/Plan.md')
      }
    }
    // Not left asking: the vault's setting is still off.
    expect(fs.existsSync(path.join(vault, '.recto', 'link-settings.json'))).toBe(false)
  })

  it('a move answered “Do not update” leaves every note as it was', async () => {
    const before = SOURCES.map(read)
    const done = relocate('fs:move', 'A/Plan.md', 'C/deep')
    await answer('Do not update')
    await done
    expect(fs.existsSync(path.join(vault, 'C/deep/Plan.md'))).toBe(true)
    expect(SOURCES.map(read)).toEqual(before)
  })

  it('“Always update” turns the setting on: the next rename is not asked, and its links follow', async () => {
    const done = relocate('fs:rename', 'B/Idea.md', 'Idea B.md')
    await answer('Always update')
    await done
    expect(JSON.parse(read('.recto/link-settings.json'))).toEqual({ alwaysUpdateLinks: true })
    expect(read('Source root.md')).toContain('[[Idea B]]')
    await relocate('fs:rename', 'C/deep/Idea.md', 'Idea C.md')
    expect(await page.locator('[role=alertdialog][aria-label="Update links"]').count()).toBe(0)
    expect(read('C/Source C.md')).toContain('[[Idea C]]')
  })
})
