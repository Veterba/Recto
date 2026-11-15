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
 * the edits it suggested under it - a note's changes and a canvas's edits,
 * each accepted or rejected on its own or all at once, the canvas showing
 * its edits as ghosts until then; a change whose lines were edited since is
 * out of date, the others still go in; the
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
  /** A suggestion card in the chat by its title's note: a note's text may name another. */
  const cardTitled = (name: string) => page.locator('.chat-topic .suggestion--chat').filter({ has: page.locator('.suggestion__title', { hasText: name }) })

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-edits-'))
    vault = path.join(base, 'vault')
    const profile = path.join(base, 'profile')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    const basil = read('Garden/Basil.md')
    const soil = read('Garden/Soil.md')
    const tomatoes = read('Garden/Tomatoes.md')
    // A canvas the chat suggested two edits to: a card, and an arrow to it.
    const canvas = JSON.stringify({ nodes: [{ id: 'aaaaaaaaaaaaaaaa', type: 'text', text: 'Soil', x: 0, y: 0, width: 220, height: 90 }], edges: [] })
    fs.mkdirSync(path.join(vault, 'Recto/Canvas'), { recursive: true })
    fs.writeFileSync(path.join(vault, 'Recto/Canvas/Beds.canvas'), canvas)
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
          // Two changes: a line edited, a section added.
          proposal(
            'p-basil',
            'recto-chat · Claude Code',
            'propose_edit',
            'Edit Basil',
            'Garden/Basil.md',
            basil,
            `${basil.replace('# Basil', '# Basil (Genovese)')}\n## Harvest\n\nPick in the morning.\n`,
            120_000,
          ),
          { ...proposal('p-rename', 'recto-chat · Claude Code', 'propose_rename', 'Rename Soil to Garden soil', 'Garden/Soil.md', null, '', 90_000), files: [], file: { kind: 'rename', from: 'Garden/Soil.md', to: 'Garden/Garden soil.md' } },
          { ...proposal('p-archive', 'recto-chat · Claude Code', 'propose_delete', 'Move Ideas to the archive', 'Ideas.md', null, '', 80_000), files: [], file: { kind: 'delete', from: 'Ideas.md', to: null } },
          proposal('p-tomatoes', 'recto-chat · Claude Code', 'propose_edit', 'Edit Tomatoes', 'Garden/Tomatoes.md', tomatoes, tomatoes.replace('six weeks', 'eight weeks'), 110_000),
          {
            ...proposal('p-canvas', 'recto-chat · Claude Code', 'canvas_propose_nodes', 'Two edits to Beds', 'Recto/Canvas/Beds.canvas', canvas, canvas, 100_000),
            canvas: {
              path: 'Recto/Canvas/Beds.canvas',
              ops: [
                { op: 'add-node', node: { ref: 'g1', type: 'text', text: 'Compost', x: 320, y: 0, width: 220, height: 90 } },
                { op: 'add-edge', from: 'aaaaaaaaaaaaaaaa', to: 'g1', label: 'feeds' },
              ],
              states: ['pending', 'pending'],
              refs: {},
            },
          },
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
        record: { read: ['Garden/Basil.md'], skimmed: [], proposals: ['p-basil', 'p-tomatoes', 'p-canvas', 'p-rename', 'p-archive'] },
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

  it('a chat answer shows its suggestions under it; a note’s changes are accepted or rejected one by one, and the card says what became of each', async () => {
    // The status bar counts only the two from outside: the chat's own wait in its chat.
    await expect.poll(() => page.locator('.edits__badge').textContent()).toBe('2')
    await page.keyboard.press('Meta+Shift+C')
    const card = cardTitled('Basil')
    await card.waitFor({ timeout: 15_000 })
    expect(await card.locator('.suggestion__title').textContent()).toMatch(/Edit\s*Basil/)
    expect(await card.locator('.suggestion__meta').textContent()).toMatch(/Chat · Claude Code/)
    expect(await card.locator('.suggestion__change').count()).toBe(2)
    // The second change only: the first stays as it was in the note.
    await card.getByRole('button', { name: 'Accept change 2' }).click()
    await expect.poll(() => read('Garden/Basil.md')).toContain('## Harvest')
    expect(read('Garden/Basil.md')).not.toContain('Genovese')
    await card.locator('.suggestion__change').nth(1).locator('.suggestion__state', { hasText: 'Applied' }).waitFor()
    await card.getByRole('button', { name: 'Reject change 1' }).click()
    await card.locator('.suggestion__settled', { hasText: 'Partly applied: 1 of 2' }).waitFor()
    expect(read('Garden/Basil.md')).not.toContain('Genovese')
  })

  it('a change whose lines were edited since is out of date: nothing written, and the card says so', async () => {
    const card = cardTitled('Tomatoes')
    fs.writeFileSync(path.join(vault, 'Garden/Tomatoes.md'), read('Garden/Tomatoes.md').replace('six weeks', 'seven weeks'))
    const typed = read('Garden/Tomatoes.md')
    await card.getByRole('button', { name: 'Accept', exact: true }).click()
    await card.locator('.suggestion__settled', { hasText: 'Out of date' }).waitFor()
    expect(read('Garden/Tomatoes.md')).toBe(typed)
  })

  it('a canvas’s edits: ghosts on the canvas, accepted and rejected in the chat; main writes the canvas and the ghosts follow', async () => {
    const card = cardTitled('Beds')
    expect(await card.locator('.suggestion__label').allTextContents()).toEqual([expect.stringMatching(/Card “Compost”/), expect.stringMatching(/Arrow “Soil” → “Compost”, “feeds”/)])
    // The canvas, open beside the chat: both edits as ghosts, reviewed in the chat.
    await card.locator('.suggestion__note').click()
    const ghosts = page.locator('.canvas-ghosts')
    await ghosts.waitFor({ timeout: 10_000 })
    expect(await ghosts.locator('.canvas-ghosts__bar').textContent()).toMatch(/Review in the chat/)
    expect(await ghosts.locator('.canvas-ghost').count()).toBe(1)
    await card.getByRole('button', { name: 'Accept change 1' }).click()
    await expect.poll(() => read('Recto/Canvas/Beds.canvas')).toContain('Compost')
    // On the canvas: the card is real now, its ghost gone; the arrow still a ghost.
    await expect.poll(() => page.locator('.react-flow__node', { hasText: 'Compost' }).count()).toBe(1)
    await expect.poll(() => ghosts.locator('.canvas-ghost').count()).toBe(0)
    expect(await ghosts.locator('.canvas-ghost__line').count()).toBe(1)
    // One edit left: the card's buttons say so.
    await card.getByRole('button', { name: 'Reject', exact: true }).click()
    await card.locator('.suggestion__settled', { hasText: 'Partly applied: 1 of 2' }).waitFor()
    await expect.poll(() => page.locator('.canvas-ghosts').count()).toBe(0)
    expect((JSON.parse(read('Recto/Canvas/Beds.canvas')) as { edges: unknown[] }).edges).toEqual([])
    await page.keyboard.press('Meta+Shift+C')
  })

  it('a rename suggested in the chat: accepted, the note is renamed and links follow; Undo puts it and them back. An archive, undone, is restored', async () => {
    await page.keyboard.press('Meta+Shift+C')
    const linksAsked = async (): Promise<void> => {
      const dialog = page.locator('[role=alertdialog][aria-label="Update links"]')
      await dialog.waitFor({ timeout: 10_000 })
      await dialog.getByRole('button', { name: 'Just once' }).click()
    }
    const card = cardTitled('Soil')
    expect(await card.locator('.suggestion__label').textContent()).toMatch(/“Soil” → “Garden soil”/)
    await card.getByRole('button', { name: 'Accept', exact: true }).click()
    await linksAsked()
    await expect.poll(() => fs.existsSync(path.join(vault, 'Garden/Garden soil.md'))).toBe(true)
    expect(fs.existsSync(path.join(vault, 'Garden/Soil.md'))).toBe(false)
    await expect.poll(() => read('Garden/Tomatoes.md')).toContain('[[Garden soil]]')
    await card.getByRole('button', { name: 'Undo' }).click()
    await linksAsked()
    await expect.poll(() => fs.existsSync(path.join(vault, 'Garden/Soil.md'))).toBe(true)
    await expect.poll(() => read('Garden/Tomatoes.md')).toContain('[[Soil]]')
    await card.locator('.suggestion__settled', { hasText: 'Undone' }).waitFor()

    const archive = cardTitled('Ideas')
    const ideas = read('Ideas.md')
    await archive.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect.poll(() => fs.existsSync(path.join(vault, 'Ideas.md'))).toBe(false)
    await archive.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => fs.existsSync(path.join(vault, 'Ideas.md'))).toBe(true)
    expect(read('Ideas.md')).toBe(ideas)
    await page.keyboard.press('Meta+Shift+C')
  })

  it('the count opens a glass panel, not a dialog over a backdrop; Accept all writes every waiting edit and each says so', async () => {
    await page.locator('.edits__badge', { hasText: '2' }).click()
    const panel = page.getByRole('dialog', { name: 'Suggested edits' })
    await panel.waitFor()
    expect(await panel.getAttribute('class')).toContain('glass-surface')
    expect(await page.locator('.dialog__backdrop').count()).toBe(0)
    expect(await panel.locator('.suggestion').count()).toBe(2)
    await panel.getByRole('button', { name: 'Accept all' }).click()
    await expect.poll(() => panel.locator('.suggestion__settled', { hasText: 'Applied' }).count()).toBe(2)
    expect(read('Garden/Watering.md')).toBe('# Watering\n\nAt the root.\n')
    expect(read('Garden/Soil.md')).toMatch(/Mix in grit\.\n$/)
    // Nothing waits now: the count is gone, the panel still says what became of them until it is closed.
    await expect.poll(() => page.locator('.edits__badge').count()).toBe(0)
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'detached' })
  })
})
