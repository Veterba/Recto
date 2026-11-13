import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendTurns, topicFile } from '../../src/shared/chat-topics'
import type { BotMessage } from '../../src/shared/bots'
import { quitApp, removeDir } from './helpers/app'

/**
 * Suggested edits where they were made and in one panel: a chat answer shows
 * the edits it suggested under it, to apply or discard right there; the
 * status bar's count opens a panel of everything waiting - glass over the
 * app, as Settings is, with no backdrop - where a settled suggestion stays
 * with what became of it. Suggestions are put in the vault's
 * `.recto/ai-proposals.json` before the app starts, as an AI client leaves them.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')

describe.skipIf(!RUN)('suggested edits', { timeout: 60_000 }, () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''
  const read = (rel: string): string => fs.readFileSync(path.join(vault, rel), 'utf8')

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-edits-'))
    vault = path.join(base, 'vault')
    const profile = path.join(base, 'profile')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    const basil = read('Garden/Basil.md')
    const soil = read('Garden/Soil.md')
    const now = Date.now()
    const proposal = (id: string, client: string, tool: string, summary: string, file: string, before: string | null, after: string, ago: number) => ({
      id,
      client,
      tool,
      summary,
      created: now - ago,
      status: 'pending',
      formatted: [],
      files: [{ path: file, before, after }],
    })
    fs.writeFileSync(
      path.join(vault, '.recto/ai-proposals.json'),
      JSON.stringify({
        proposals: [
          proposal('p-basil', 'recto-chat · Claude Code', 'propose_append', 'Append to Basil', 'Garden/Basil.md', basil, `${basil}\n## Harvest\n\nPick in the morning.\n`, 120_000),
          proposal('p-water', 'claude-code', 'propose_new_note', 'New note Watering', 'Garden/Watering.md', null, '# Watering\n\nAt the root.\n', 60_000),
          proposal('p-soil', 'codex', 'propose_append', 'Append to Soil', 'Garden/Soil.md', soil, `${soil}\nMix in grit.\n`, 30_000),
        ],
      }),
    )
    // A chat whose answer suggested the Basil edit: its record names it.
    const chats = path.join(vault, 'Recto/Chats/recto')
    fs.mkdirSync(chats, { recursive: true })
    const turns: BotMessage[] = [
      { role: 'user', content: 'Add a harvest section to Basil.', at: '2026-11-10T09:00:00' },
      {
        role: 'assistant',
        content: 'I suggested a Harvest section for [[Basil]]. It waits for you to apply it.',
        at: '2026-11-10T09:00:20',
        model: 'claude-code',
        record: { read: ['Garden/Basil.md'], skimmed: [], proposals: ['p-basil'] },
      },
    ]
    fs.writeFileSync(path.join(chats, '2026-11-10 09-00 Basil harvest.md'), topicFile({ bot: 'recto', created: '2026-11-10T09:00:00', title: 'Basil harvest' }, [], appendTurns('', turns, 'Recto')))
    fs.mkdirSync(profile)
    fs.writeFileSync(path.join(profile, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${profile}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1', RECTO_BOTS_MOCK: '1', RECTO_CLI_DIRS: '/nonexistent' },
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    await page.getByRole('treeitem', { name: /Handbook/ }).click()
    await page.waitForSelector('.cm-content')
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it("a chat answer shows the edit it suggested under it; Discard there leaves the note as it was", async () => {
    // The status bar counts only the two from outside: the chat's own waits in its chat.
    await expect.poll(() => page.locator('.edits__badge').textContent()).toBe('2')
    await page.keyboard.press('Meta+Shift+C')
    const card = page.locator('.chat-topic .suggestion--chat')
    await card.waitFor({ timeout: 15_000 })
    expect(await card.locator('.suggestion__head').textContent()).toMatch(/Adds to\s*Basil.*Chat · Claude Code/)
    expect(await card.locator('.suggestion__line--added').allTextContents()).toContain('## Harvest')
    const before = read('Garden/Basil.md')
    await card.getByRole('button', { name: 'Discard' }).click()
    await card.locator('.suggestion__settled', { hasText: 'Discarded' }).waitFor()
    expect(read('Garden/Basil.md')).toBe(before)
    await page.keyboard.press('Meta+Shift+C')
  })

  it('the count opens a glass panel, not a dialog over a backdrop; Apply all writes every waiting edit and each says so', async () => {
    await page.locator('.edits__badge', { hasText: '2' }).click()
    const panel = page.getByRole('dialog', { name: 'Suggested edits' })
    await panel.waitFor()
    expect(await panel.getAttribute('class')).toContain('glass-surface')
    expect(await page.locator('.dialog__backdrop').count()).toBe(0)
    expect(await panel.locator('.suggestion').count()).toBe(2)
    await panel.getByRole('button', { name: 'Apply all' }).click()
    await expect.poll(() => panel.locator('.suggestion__settled', { hasText: 'Applied' }).count()).toBe(2)
    expect(read('Garden/Watering.md')).toBe('# Watering\n\nAt the root.\n')
    expect(read('Garden/Soil.md')).toMatch(/Mix in grit\.\n$/)
    // Nothing waits now: the count is gone, the panel still says what became of them until it is closed.
    await expect.poll(() => page.locator('.edits__badge').count()).toBe(0)
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'detached' })
  })
})
